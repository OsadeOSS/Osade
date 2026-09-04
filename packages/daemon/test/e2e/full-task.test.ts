import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { openDb, type Db } from '../../src/db/index.js';
import { getAgentFact, getTaskFacts } from '../../src/db/task-repo.js';
import { deriveStatus } from '../../src/domain/derive-status.js';
import { LaunchTask } from '../../src/domain/launch-task.js';
import { HerdrClient } from '../../src/herdr/client.js';
import { assertNoDrift } from '../../src/herdr/drift-check.js';
import { HerdrEventSubscriber } from '../../src/herdr/event-subscriber.js';
import { herdrApiSocketPath, herdrSessionDir } from '../../src/herdr/socket-path.js';

/**
 * The M0 acceptance test — OSADE.md §21.
 *
 * Real herdr, real git repository, one full task. Runs against an **isolated `osade-e2e`
 * named session** so it never touches the user's own herdr (§2.2, §4.4 verified live).
 *
 * Skipped unless `OSADE_E2E=1`, because it spawns a herdr server, creates a git worktree, and
 * (when an agent binary is present) launches a real coding agent. `just`-style CI runs it;
 * the pre-commit gate does not.
 */

const E2E = process.env.OSADE_E2E === '1';
const SESSION = 'osade-e2e';
const HERDR_BIN = process.env.OSADE_HERDR_BIN ?? 'herdr';

let workdir: string;
let repoPath: string;
let baseSha: string;
let db: Db;
let herdr: HerdrClient;
let server: ChildProcess | null = null;
let subscriber: HerdrEventSubscriber;
let launcher: LaunchTask;

function sh(cwd: string, cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
}

async function waitFor(predicate: () => boolean | Promise<boolean>, ms: number, what: string) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timed out after ${ms}ms waiting for ${what}`);
}

beforeAll(async () => {
  if (!E2E) return;

  workdir = mkdtempSync(join(tmpdir(), 'osade-e2e-'));
  process.env.OSADE_HOME = join(workdir, 'osade-home');

  // A real git repository with one commit.
  repoPath = join(workdir, 'repo');
  sh(workdir, 'git', ['init', '-q', '-b', 'main', 'repo']);
  writeFileSync(join(repoPath, 'README.md'), '# fixture\n');
  sh(repoPath, 'git', ['add', '-A']);
  sh(repoPath, 'git', ['-c', 'user.email=e2e@osade', '-c', 'user.name=e2e', 'commit', '-qm', 'init']);
  baseSha = sh(repoPath, 'git', ['rev-parse', 'HEAD']);

  // §4.1.1 — the drift check runs before anything else, exactly as the daemon does at boot.
  await assertNoDrift(HERDR_BIN);

  // §18.1 — an isolated named session, spawned detached with HERDR_STARTUP_CWD cleared so
  // herdr does not create a stray workspace we did not ask for.
  const env: NodeJS.ProcessEnv = { ...process.env, HERDR_SESSION: SESSION };
  delete env.HERDR_STARTUP_CWD;
  server = spawn(HERDR_BIN, ['server'], { env, stdio: 'ignore', detached: false });

  herdr = new HerdrClient({ session: SESSION });
  await waitFor(() => herdr.isRunning(1_000), 20_000, 'herdr server to accept connections');

  db = openDb(join(workdir, 'osade.db'));
  subscriber = new HerdrEventSubscriber(db, herdr);
  launcher = new LaunchTask(db, herdr, subscriber, { defaultAgent: 'claude' });
  await subscriber.start();
}, 60_000);

afterAll(async () => {
  if (!E2E) return;
  subscriber?.stop();
  try {
    await new HerdrClient({ session: SESSION }).request('server.stop', {}, 5_000);
  } catch {
    // already gone
  }
  server?.kill();
  db?.close();
  // Best-effort: on Windows a just-exited PTY can still hold its cwd for a moment, and a
  // noisy teardown must not fail an otherwise-green run.
  for (const dir of [herdrSessionDir(SESSION), workdir]) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // leave it for the OS temp sweeper
    }
  }
  delete process.env.OSADE_HOME;
}, 30_000);

describe.skipIf(!E2E)('M0 acceptance — one task end to end', () => {
  let taskId: string;

  it('runs headless: a herdr server with zero clients attached', async () => {
    const pong = await herdr.ping();
    expect(pong.protocol).toBe(20);
    // Isolation: our socket is the named session's, not the user's default.
    expect(herdr.socketPath).toBe(herdrApiSocketPath(SESSION));
  });

  it('creates a task with a pinned base commit', async () => {
    taskId = await launcher.createTask({
      repoPath,
      title: 'e2e smoke',
      intent: 'Reply with exactly PONG and nothing else. Do not use any tools.',
    });

    const facts = getTaskFacts(db, taskId)!;
    expect(facts.task.base_sha).toBe(baseSha);
    // §6 row 13 — nothing has been launched yet.
    expect(deriveStatus(facts, Date.now())).toBe('queued');
  });

  it('launches: prune → worktree → mirror → lane with env → subscribe → agent.start', async () => {
    const result = await launcher.launch(taskId);

    expect(result.workspaceId).toMatch(/^w\d+$/);
    expect(result.paneId).toMatch(/^w\d+:p\d+$/);
    expect(existsSync(result.worktreePath)).toBe(true);

    // §9 rule 4 — the worktree is on the new branch at exactly the pinned base.
    expect(sh(result.worktreePath, 'git', ['rev-parse', 'HEAD'])).toBe(baseSha);
    expect(sh(result.worktreePath, 'git', ['rev-parse', '--abbrev-ref', 'HEAD'])).toMatch(
      /^osade\//,
    );

    // §8.2 step 5 — the launch context is rendered into the worktree.
    expect(existsSync(result.contextPath)).toBe(true);

    const transcript = await launcher.readTranscript(taskId, 200);
    expect(typeof transcript?.text).toBe('string');

    // The agent is actually usable, not merely started: this is what the trust-prompt path
    // must guarantee before launch reports success.
    const info = await herdr.request<'agent.get', { agent: { interactive_ready?: boolean } }>(
      'agent.get',
      { target: result.paneId },
    );
    expect(info.agent.interactive_ready).toBe(true);
  }, 180_000);

  it('drives the row through herdr-detected status, with nothing polled', async () => {
    // §6 rows 11/10 — the agent works, then finishes. Facts come from the pane subscription.
    await launcher.prompt(taskId, 'Reply with exactly PONG and nothing else. No tools.', true);

    await waitFor(
      () => {
        const fact = getAgentFact(db, taskId);
        return fact?.last_event === 'to_review';
      },
      120_000,
      'the agent to reach to_review',
    );

    const facts = getTaskFacts(db, taskId)!;
    expect(facts.agent?.herdr_state).toBe('done');
    // The acceptance criterion: awaiting_review, derived, never stored.
    expect(deriveStatus(facts, Date.now())).toBe('awaiting_review');

    // …and no status column exists to have stored it in.
    const columns = db.prepare('PRAGMA table_info(task)').all() as { name: string }[];
    expect(columns.map((c) => c.name)).not.toContain('status');
  }, 180_000);

  it('tears down through herdr: panes first, then the worktree', async () => {
    const before = getTaskFacts(db, taskId)!.task;
    expect(before.herdr_workspace_id).not.toBe(null);

    // §9 rule 6 — panes must go first. A live shell holds its cwd, and on Windows that makes
    // the directory undeletable even with force.
    await launcher.teardown(taskId, { force: true });

    expect(existsSync(before.worktree_path)).toBe(false);
    const after = getTaskFacts(db, taskId)!;
    expect(after.task.herdr_workspace_id).toBe(null);
    expect(after.agent?.pane_alive).toBe(false);
    // §5.2 — tearing a workspace down is not a death certificate.
    expect(after.agent?.terminated).toBe(false);
  }, 90_000);
});
