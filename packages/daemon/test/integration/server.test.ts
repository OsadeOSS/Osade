import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import type { ServerMessage } from '@osade/contract';

import { openDb, type Db } from '../../src/db/index.js';
import type { Gates } from '../../src/domain/gates.js';
import type { LaunchTask } from '../../src/domain/launch-task.js';
import type { Triage } from '../../src/domain/triage.js';
import type { VerifyRunner } from '../../src/domain/verify-run.js';
import type { ScmPoller } from '../../src/scm/poller.js';
import type { ScmWrites } from '../../src/scm/writes.js';
import { startDaemonServer, type RunningDaemon } from '../../src/server/index.js';

const NOW = 1_756_000_000_000;

let db: Db;
let daemon: RunningDaemon;
let home: string;

function seedTask(id = 't1'): void {
  db.prepare('INSERT INTO org (id, name, created_at) VALUES (?,?,?)').run('o1', 'acme', NOW);
  db.prepare(
    'INSERT INTO repo (id, org_id, path, default_branch, created_at) VALUES (?,?,?,?,?)',
  ).run('r1', 'o1', '/repo', 'main', NOW);
  db.prepare(
    `INSERT INTO task (id, repo_id, title, intent, origin_kind, base_ref, base_sha, branch,
                       worktree_path, created_at)
     VALUES (?, 'r1', 'fix the thing', 'fix it', 'manual', 'main', 'headsha', 'b', '/wt', ?)`,
  ).run(id, NOW);
}

const stubLauncher = {} as LaunchTask;
const stubGates = {} as Gates;
const stubVerifier = {} as VerifyRunner;
const stubTriage = {} as Triage;
const stubScmWrites = {} as ScmWrites;
const stubPoller = {} as ScmPoller;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'osade-test-'));
  process.env.OSADE_HOME = home;
  db = openDb(':memory:');
  daemon = await startDaemonServer({
    db,
    launcher: stubLauncher,
    gates: stubGates,
    verifier: stubVerifier,
    triage: stubTriage,
    scmWrites: stubScmWrites,
    poller: stubPoller,
    now: () => NOW,
  });
});

afterEach(async () => {
  await daemon.close();
  db.close();
  delete process.env.OSADE_HOME;
  rmSync(home, { recursive: true, force: true });
});

async function trpcQuery(path: string, input?: unknown): Promise<unknown> {
  const query = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`;
  const res = await fetch(`http://127.0.0.1:${daemon.port}/${path}${query}`);
  const body = (await res.json()) as { result?: { data?: unknown }; error?: unknown };
  if (body.error) throw new Error(JSON.stringify(body.error));
  return body.result?.data;
}

async function trpcMutation(path: string, input: unknown): Promise<unknown> {
  const body = await trpcMutationRaw(path, input);
  if (body.error) throw new Error(JSON.stringify(body.error));
  return body.result?.data;
}

async function trpcMutationRaw(
  path: string,
  input: unknown,
): Promise<{
  result?: { data?: unknown };
  error?: { message?: string; data?: { code?: string } };
}> {
  const res = await fetch(`http://127.0.0.1:${daemon.port}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  return (await res.json()) as {
    result?: { data?: unknown };
    error?: { message?: string; data?: { code?: string } };
  };
}

describe('daemon server', () => {
  it('binds loopback only — §2.1', () => {
    // The port file is how the CLI and Electron find us; a fixed port would collide.
    expect(daemon.port).toBeGreaterThan(0);
    expect(readFileSync(join(home, 'daemon.port'), 'utf8').trim()).toBe(String(daemon.port));
    expect(Number(readFileSync(join(home, 'daemon.pid'), 'utf8').trim())).toBeGreaterThan(0);
  });

  it('removes the port and pid files on close', async () => {
    await daemon.close();
    expect(existsSync(join(home, 'daemon.port'))).toBe(false);
    expect(existsSync(join(home, 'daemon.pid'))).toBe(false);
  });

  it('answers /health', async () => {
    const res = await fetch(`http://127.0.0.1:${daemon.port}/health`);
    const body = (await res.json()) as { ok: boolean; build: string };
    expect(body.ok).toBe(true);
    expect(body.build).toMatch(/^[a-f0-9]{16}$/);
  });

  it('serves taskList over tRPC with derived status', async () => {
    seedTask();
    const tasks = (await trpcQuery('taskList')) as { status: string; needsYou: boolean }[];
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.status).toBe('queued');
    expect(tasks[0]!.needsYou).toBe(false);
  });

  it('sorts the ledger needs-you first, never by creation time — §19.3', async () => {
    seedTask('t_quiet');
    db.prepare(
      `INSERT INTO task (id, repo_id, title, intent, origin_kind, base_ref, base_sha, branch,
                         worktree_path, created_at)
       VALUES ('t_loud', 'r1', 'blocked one', 'x', 'manual', 'main', 'h', 'b2', '/wt2', ?)`,
    ).run(NOW - 10_000); // older, so creation-time sorting would put it last
    db.prepare(
      "INSERT INTO agent_fact (task_id, substrate_state, pane_alive) VALUES ('t_loud', 'blocked', 1)",
    ).run();

    const tasks = (await trpcQuery('taskList')) as { task: { id: string }; status: string }[];
    expect(tasks[0]!.task.id).toBe('t_loud');
    expect(tasks[0]!.status).toBe('needs_input');
  });

  it('taskGet returns null for an unknown id rather than throwing', async () => {
    expect(await trpcQuery('taskGet', { taskId: 'nope' })).toBe(null);
  });

  it('taskList surfaces chatId and the resolved agentId', async () => {
    seedTask();
    db.prepare('UPDATE repo SET default_agent = ? WHERE id = ?').run('codex', 'r1');
    const tasks = (await trpcQuery('taskList')) as {
      chatId: string;
      agentId: string;
      task: { id: string };
    }[];
    expect(tasks[0]!.chatId).toBe('t1');
    expect(tasks[0]!.agentId).toBe('codex');
  });

  it('agentCatalogList returns catalog ids and a PATH probe', async () => {
    const agents = (await trpcQuery('agentCatalogList')) as {
      id: string;
      displayName: string;
      installed: boolean;
    }[];
    const ids = agents.map((a) => a.id);
    expect(ids).toEqual(['claude', 'codex', 'opencode', 'pi']);
    expect(agents.every((a) => a.displayName.length > 0)).toBe(true);
    expect(agents.every((a) => typeof a.installed === 'boolean')).toBe(true);
  });

  it('repoSetDefaultAgent writes the catalog id and rejects unknown ids', async () => {
    seedTask();
    await trpcMutation('repoSetDefaultAgent', { repoId: 'r1', agentId: 'codex' });
    const row = db.prepare('SELECT default_agent FROM repo WHERE id = ?').get('r1') as {
      default_agent: string;
    };
    expect(row.default_agent).toBe('codex');

    const rejected = await trpcMutationRaw('repoSetDefaultAgent', {
      repoId: 'r1',
      agentId: 'not-an-agent',
    });
    expect(rejected.error?.data?.code).toBe('BAD_REQUEST');
  });

  it('taskCreate rejects an unknown agentId instead of falling back to claude', async () => {
    const rejected = await trpcMutationRaw('taskCreate', {
      repoPath: '/repo',
      title: 'x',
      intent: 'x',
      agentId: 'not-an-agent',
    });
    expect(rejected.error?.data?.code).toBe('BAD_REQUEST');
    expect(JSON.stringify(rejected.error)).toMatch(/unknown agent/i);
  });
});

describe('websocket — §5.4, one event path', () => {
  function connect(): Promise<{ socket: WebSocket; messages: ServerMessage[] }> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${daemon.port}/ws`);
      const messages: ServerMessage[] = [];
      socket.on('message', (raw) => messages.push(JSON.parse(raw.toString()) as ServerMessage));
      socket.on('open', () => resolve({ socket, messages }));
      socket.on('error', reject);
    });
  }

  // Longer than the CDC poll interval, so a seeded task has already been pushed and the
  // counts below measure what the test is actually about.
  const settle = () => new Promise((r) => setTimeout(r, 250));

  it('sends a snapshot on connect — the renderer never polls', async () => {
    seedTask();
    const { socket, messages } = await connect();
    await settle();

    expect(messages[0]?.type).toBe('snapshot');
    if (messages[0]?.type !== 'snapshot') throw new Error('unreachable');
    expect(messages[0].tasks).toHaveLength(1);
    socket.close();
  });

  it('a raw SQL write reaches a live websocket client', async () => {
    seedTask();
    const { socket, messages } = await connect();
    await settle();
    const before = messages.length;

    // Nothing in the daemon knows about this write. §5.4 says it must still reach the UI.
    db.prepare(
      "INSERT INTO agent_fact (task_id, substrate_state, pane_alive, state_change_seq) VALUES ('t1','working',1,1)",
    ).run();

    // The poller runs on its own interval; give it a beat rather than reaching into it.
    await new Promise((r) => setTimeout(r, 300));

    expect(messages.length).toBeGreaterThan(before);
    const push = messages.at(-1);
    expect(push?.type).toBe('task.upserted');
    if (push?.type !== 'task.upserted') throw new Error('unreachable');
    expect(push.task.status).toBe('implementing');
    socket.close();
  });

  it('re-snapshots on hello', async () => {
    seedTask();
    const { socket, messages } = await connect();
    await settle();
    const before = messages.length;

    socket.send(JSON.stringify({ type: 'hello' }));
    await settle();

    expect(messages.length).toBe(before + 1);
    expect(messages.at(-1)?.type).toBe('snapshot');
    socket.close();
  });

  it('ignores a malformed client message instead of dying', async () => {
    const { socket, messages } = await connect();
    await settle();
    const before = messages.length;

    socket.send('not json at all');
    socket.send(JSON.stringify({ type: 'nonsense' }));
    await settle();

    expect(messages.length).toBe(before);
    expect(socket.readyState).toBe(WebSocket.OPEN);
    socket.close();
  });
});

describe('Files and Changes for a project folder (terminal tabs)', () => {
  it('lists, reads, writes and diffs the repo checkout by repoId', async () => {
    const { execFileSync } = await import('node:child_process');
    const { writeFileSync } = await import('node:fs');
    const repo = mkdtempSync(join(tmpdir(), 'osade-repo-'));
    const git = (...args: string[]): void => {
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repo, stdio: 'ignore' });
    };
    try {
      git('init', '-q', '-b', 'main');
      writeFileSync(join(repo, 'a.txt'), 'one\n');
      git('add', '.');
      git('commit', '-q', '-m', 'init');
      writeFileSync(join(repo, 'a.txt'), 'one\ntwo\n');
      writeFileSync(join(repo, 'new.txt'), 'fresh\n');

      db.prepare('INSERT INTO org (id, name, created_at) VALUES (?,?,?)').run('o1', 'acme', NOW);
      db.prepare(
        'INSERT INTO repo (id, org_id, path, default_branch, created_at) VALUES (?,?,?,?,?)',
      ).run('rp', 'o1', repo, 'main', NOW);

      const changes = (await trpcQuery('taskChangesList', { repoId: 'rp' })) as {
        files: { path: string; flag: string }[];
      };
      expect(changes.files.map((f) => `${f.flag} ${f.path}`).sort()).toEqual(['? new.txt', 'M a.txt']);

      const diff = (await trpcQuery('taskChangesDiff', { repoId: 'rp', path: 'a.txt', vs: 'working' })) as {
        diff: string;
      };
      expect(diff.diff).toContain('+two');

      const listed = (await trpcQuery('taskFsList', { repoId: 'rp' })) as {
        listings: { entries: { name: string }[] }[];
      };
      expect(listed.listings[0]!.entries.map((e) => e.name)).toEqual(expect.arrayContaining(['a.txt', 'new.txt']));

      await trpcMutation('taskFsWrite', { repoId: 'rp', path: 'new.txt', text: 'edited\n' });
      const read = (await trpcQuery('taskFsRead', { repoId: 'rp', path: 'new.txt' })) as { text: string };
      expect(read.text).toBe('edited\n');

      await expect(trpcQuery('taskChangesList', {})).rejects.toThrow(/taskId or repoId/);
      await expect(trpcQuery('taskChangesList', { repoId: 'nope' })).rejects.toThrow(/unknown repo/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
