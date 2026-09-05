import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDb, type Db } from '../../src/db/index.js';
import { getAgentFact, listTaskFacts } from '../../src/db/task-repo.js';
import { deriveStatus } from '../../src/domain/derive-status.js';
import { LaunchTask } from '../../src/domain/launch-task.js';
import type { HerdrClient } from '../../src/herdr/client.js';
import type { HerdrEventSubscriber } from '../../src/herdr/event-subscriber.js';

/**
 * §21 M1 — four tasks in parallel on one repo, no cross-talk.
 *
 * §9 rule 2 makes creation serialized by a repo-level lock with a double-check inside it,
 * because herdr has no cross-call lock and two concurrent `worktree.create` calls on one repo
 * race. That lock was written in M0 and never contended until now.
 *
 * Uses a fake herdr rather than the real one: the property under test is Osade's serialization
 * and fact isolation, and a real herdr would make the race timing-dependent and the failure
 * unreproducible.
 */

const NOW = 1_756_000_000_000;

let dir: string;
let repo: string;
let db: Db;

function sh(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
}

/**
 * A herdr that records call ordering and answers with distinct ids.
 *
 * `worktree.create` deliberately yields mid-call: if the repo lock is not held, a second
 * launch will interleave here and the overlap counter will see it.
 */
function fakeHerdr(): {
  client: HerdrClient;
  calls: string[];
  maxConcurrentCreates: number;
} {
  let workspaceSeq = 0;
  let paneSeq = 0;
  let inCreate = 0;
  const state = { calls: [] as string[], maxConcurrentCreates: 0 };

  const client = {
    socketPath: '/fake',
    async request(method: string): Promise<unknown> {
      state.calls.push(method);

      switch (method) {
        case 'worktree.create': {
          inCreate++;
          state.maxConcurrentCreates = Math.max(state.maxConcurrentCreates, inCreate);
          // Yield, so an unserialized caller has a real chance to overlap.
          await new Promise((r) => setTimeout(r, 20));
          inCreate--;
          workspaceSeq++;
          return {
            workspace: { workspace_id: `w${workspaceSeq}` },
            root_pane: { pane_id: `w${workspaceSeq}:p1` },
          };
        }
        case 'tab.create': {
          paneSeq++;
          return {
            tab: { tab_id: `w${workspaceSeq}:t2` },
            root_pane: { pane_id: `w${workspaceSeq}:p${paneSeq + 1}` },
          };
        }
        case 'agent.start':
          return { agent: {}, argv: [] };
        case 'agent.get':
          return { agent: { interactive_ready: true, launch_pending: false } };
        case 'pane.read':
          return { read: { text: '', revision: 1, truncated: false } };
        default:
          return {};
      }
    },
  } as unknown as HerdrClient;

  return { client, ...state, get maxConcurrentCreates() {
    return state.maxConcurrentCreates;
  } };
}

function fakeSubscriber(): { subscriber: HerdrEventSubscriber; watched: Map<string, string> } {
  const watched = new Map<string, string>();
  const subscriber = {
    watchPane(taskId: string, paneId: string) {
      watched.set(paneId, taskId);
      db.prepare('UPDATE agent_fact SET herdr_pane_id = ? WHERE task_id = ?').run(paneId, taskId);
    },
    unwatchPane(paneId: string) {
      watched.delete(paneId);
    },
  } as unknown as HerdrEventSubscriber;
  return { subscriber, watched };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'osade-par-'));
  process.env.OSADE_HOME = join(dir, 'home');
  repo = join(dir, 'repo');
  sh(dir, ['init', '-q', '-b', 'main', 'repo']);
  writeFileSync(join(repo, 'README.md'), '# x\n');
  sh(repo, ['add', '-A']);
  sh(repo, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init']);
  db = openDb(':memory:');
});

afterEach(() => {
  db.close();
  delete process.env.OSADE_HOME;
  // Windows can still hold a just-created worktree; cleanup must not fail a green run.
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // leave it for the OS temp sweeper
  }
});

describe('§21 M1 — four tasks in parallel on one repo', () => {
  it('serializes worktree creation on one repo — §9 rule 2', async () => {
    const herdr = fakeHerdr();
    const { subscriber } = fakeSubscriber();
    const launcher = new LaunchTask(db, herdr.client, subscriber, { now: () => NOW });

    const ids = await Promise.all(
      [1, 2, 3, 4].map((n) =>
        launcher.createTask({ repoPath: repo, title: `task ${n}`, intent: `do ${n}` }),
      ),
    );

    await Promise.all(ids.map((id) => launcher.launch(id)));

    // The whole point of the repo lock: herdr has no cross-call lock, so two concurrent
    // creates on one repo race on the same git index.
    expect(herdr.maxConcurrentCreates).toBe(1);
  });

  it('gives every task its own branch, worktree and workspace — no cross-talk', async () => {
    const herdr = fakeHerdr();
    const { subscriber } = fakeSubscriber();
    const launcher = new LaunchTask(db, herdr.client, subscriber, { now: () => NOW });

    const ids = await Promise.all(
      [1, 2, 3, 4].map((n) =>
        launcher.createTask({ repoPath: repo, title: `task ${n}`, intent: `do ${n}` }),
      ),
    );
    await Promise.all(ids.map((id) => launcher.launch(id)));

    const facts = listTaskFacts(db);
    expect(facts).toHaveLength(4);

    const unique = (xs: (string | null)[]) => new Set(xs).size;
    expect(unique(facts.map((f) => f.task.branch))).toBe(4);
    expect(unique(facts.map((f) => f.task.worktree_path))).toBe(4);
    expect(unique(facts.map((f) => f.task.herdr_workspace_id))).toBe(4);
    expect(unique(facts.map((f) => f.agent?.herdr_pane_id ?? null))).toBe(4);
  });

  it('all four share one repo row rather than registering it four times', async () => {
    const herdr = fakeHerdr();
    const { subscriber } = fakeSubscriber();
    const launcher = new LaunchTask(db, herdr.client, subscriber, { now: () => NOW });

    await Promise.all(
      [1, 2, 3, 4].map((n) =>
        launcher.createTask({ repoPath: repo, title: `task ${n}`, intent: `do ${n}` }),
      ),
    );

    const repos = db.prepare('SELECT COUNT(*) c FROM repo').get() as { c: number };
    expect(repos.c).toBe(1);
  });

  it('a fact written for one task never leaks into another', async () => {
    const herdr = fakeHerdr();
    const { subscriber } = fakeSubscriber();
    const launcher = new LaunchTask(db, herdr.client, subscriber, { now: () => NOW });

    const ids = await Promise.all(
      [1, 2, 3, 4].map((n) =>
        launcher.createTask({ repoPath: repo, title: `task ${n}`, intent: `do ${n}` }),
      ),
    );
    await Promise.all(ids.map((id) => launcher.launch(id)));

    // One task goes blocked; the other three must be unaffected.
    db.prepare(
      "UPDATE agent_fact SET herdr_state = 'blocked', pane_alive = 1, state_change_seq = 5 WHERE task_id = ?",
    ).run(ids[1]);

    for (const [i, id] of ids.entries()) {
      const fact = getAgentFact(db, id)!;
      expect(fact.herdr_state, `task ${i}`).toBe(i === 1 ? 'blocked' : null);
    }

    const statuses = listTaskFacts(db).map((f) => ({
      id: f.task.id,
      status: deriveStatus(f, NOW),
    }));
    expect(statuses.filter((s) => s.status === 'needs_input')).toHaveLength(1);
  });

  it('one failing launch does not take the others down', async () => {
    const herdr = fakeHerdr();
    const { subscriber } = fakeSubscriber();
    const launcher = new LaunchTask(db, herdr.client, subscriber, { now: () => NOW });

    const ids = await Promise.all(
      [1, 2, 3].map((n) =>
        launcher.createTask({ repoPath: repo, title: `task ${n}`, intent: `do ${n}` }),
      ),
    );
    // A task whose row was deleted underneath us — the launch must fail alone.
    const doomed = await launcher.createTask({ repoPath: repo, title: 'doomed', intent: 'x' });
    db.prepare('DELETE FROM task WHERE id = ?').run(doomed);

    const results = await Promise.allSettled([
      ...ids.map((id) => launcher.launch(id)),
      launcher.launch(doomed),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);

    // …and the repo lock is not left held, so a later launch still works.
    const later = await launcher.createTask({ repoPath: repo, title: 'later', intent: 'x' });
    await expect(launcher.launch(later)).resolves.toBeTruthy();
  });
});
