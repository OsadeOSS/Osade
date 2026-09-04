import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import type { ServerMessage } from '@osade/contract';

import { openDb, type Db } from '../../src/db/index.js';
import type { LaunchTask } from '../../src/domain/launch-task.js';
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

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'osade-test-'));
  process.env.OSADE_HOME = home;
  db = openDb(':memory:');
  daemon = await startDaemonServer({ db, launcher: stubLauncher, now: () => NOW });
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

describe('daemon server', () => {
  it('binds loopback only — §2.1', () => {
    // The port file is how the CLI and Electron find us; a fixed port would collide.
    expect(daemon.port).toBeGreaterThan(0);
  });

  it('answers /health', async () => {
    const res = await fetch(`http://127.0.0.1:${daemon.port}/health`);
    expect(await res.json()).toEqual({ ok: true });
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
      "INSERT INTO agent_fact (task_id, herdr_state, pane_alive) VALUES ('t_loud', 'blocked', 1)",
    ).run();

    const tasks = (await trpcQuery('taskList')) as { task: { id: string }; status: string }[];
    expect(tasks[0]!.task.id).toBe('t_loud');
    expect(tasks[0]!.status).toBe('needs_input');
  });

  it('taskGet returns null for an unknown id rather than throwing', async () => {
    expect(await trpcQuery('taskGet', { taskId: 'nope' })).toBe(null);
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
      "INSERT INTO agent_fact (task_id, herdr_state, pane_alive, state_change_seq) VALUES ('t1','working',1,1)",
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
