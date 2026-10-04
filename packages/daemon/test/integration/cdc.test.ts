import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ServerMessage } from '@osade/contract';

import {
  CDC_TABLES,
  currentWatermark,
  migrate,
  MIGRATIONS,
  openDb,
  pruneChangeLog,
  type Db,
} from '../../src/db/index.js';
import { CdcBroadcaster } from '../../src/server/cdc-broadcaster.js';

const NOW = 1_756_000_000_000;

let db: Db;

function seedTask(id = 't1'): void {
  db.prepare('INSERT INTO org (id, name, created_at) VALUES (?, ?, ?)').run('o1', 'acme', NOW);
  db.prepare(
    'INSERT INTO repo (id, org_id, path, default_branch, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run('r1', 'o1', '/repo', 'main', NOW);
  db.prepare(
    `INSERT INTO task (id, repo_id, title, intent, origin_kind, base_ref, base_sha, branch,
                       worktree_path, created_at)
     VALUES (?, 'r1', 'fix', 'fix it', 'manual', 'main', 'headsha', 'osade/fix', '/wt', ?)`,
  ).run(id, NOW);
}

beforeEach(() => {
  db = openDb(':memory:');
});

afterEach(() => {
  db.close();
});

describe('schema', () => {
  it('has no status column in any table — §6, enforced mechanically', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];

    expect(tables.length).toBeGreaterThan(5);

    for (const { name } of tables) {
      const columns = db.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[];
      const offenders = columns.filter((c) => c.name.toLowerCase() === 'status');
      expect(offenders, `table ${name} must not have a status column`).toEqual([]);
    }
  });

  it('every fact table has all three CDC triggers — §5.4', () => {
    const triggers = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all() as {
        name: string;
      }[]).map((t) => t.name),
    );
    for (const table of CDC_TABLES) {
      for (const op of ['insert', 'update', 'delete']) {
        expect(triggers.has(`${table}_cdc_${op}`), `${table}_cdc_${op} missing`).toBe(true);
      }
    }
  });

  it('migrations are idempotent', () => {
    const before = db.prepare('SELECT COUNT(*) c FROM schema_migration').get() as { c: number };
    // openDb → migrate ran once; running it again must be a no-op, not an error.
    migrate(db);
    const after = db.prepare('SELECT COUNT(*) c FROM schema_migration').get() as { c: number };
    expect(after.c).toBe(before.c);
  });

  it('backfills chat_id from the task id so old rows are one-lane chats', () => {
    const raw = new Database(':memory:');
    raw.pragma('foreign_keys = ON');
    raw.exec(
      'CREATE TABLE schema_migration (id INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)',
    );
    for (const migration of MIGRATIONS) {
      if (migration.id >= 6) break;
      raw.exec(migration.sql);
      raw.prepare('INSERT INTO schema_migration (id, applied_at) VALUES (?, ?)').run(
        migration.id,
        NOW,
      );
    }
    raw.prepare('INSERT INTO org (id, name, created_at) VALUES (?, ?, ?)').run('o1', 'acme', NOW);
    raw
      .prepare(
        'INSERT INTO repo (id, org_id, path, default_branch, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run('r1', 'o1', '/repo', 'main', NOW);
    raw
      .prepare(
        `INSERT INTO task (id, repo_id, title, intent, origin_kind, base_ref, base_sha, branch,
                           worktree_path, created_at)
         VALUES ('t_old', 'r1', 'fix', 'fix it', 'manual', 'main', 'h', 'b', '/wt', ?)`,
      )
      .run(NOW);

    const next = MIGRATIONS.find((m) => m.id === 6);
    expect(next, 'migration 6 must exist').toBeDefined();
    raw.exec(next!.sql);

    const row = raw.prepare('SELECT chat_id FROM task WHERE id = ?').get('t_old') as {
      chat_id: string;
    };
    expect(row.chat_id).toBe('t_old');
    raw.close();
  });

  it('M7 keeps existing worktree paths and makes the column nullable', () => {
    const raw = new Database(':memory:');
    raw.pragma('foreign_keys = ON');
    raw.exec(
      'CREATE TABLE schema_migration (id INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)',
    );
    for (const migration of MIGRATIONS) {
      if (migration.id >= 7) break;
      raw.exec(migration.sql);
      raw.prepare('INSERT INTO schema_migration (id, applied_at) VALUES (?, ?)').run(
        migration.id,
        NOW,
      );
    }
    raw.prepare('INSERT INTO org (id, name, created_at) VALUES (?, ?, ?)').run('o1', 'acme', NOW);
    raw
      .prepare(
        'INSERT INTO repo (id, org_id, path, default_branch, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run('r1', 'o1', '/repo', 'main', NOW);
    raw
      .prepare(
        `INSERT INTO task (id, repo_id, title, intent, origin_kind, base_ref, base_sha, branch,
                           worktree_path, chat_id, created_at)
         VALUES ('t_old', 'r1', 'fix', 'fix it', 'manual', 'main', 'h', 'b', '/wt', 't_old', ?)`,
      )
      .run(NOW);
    raw.prepare('INSERT INTO agent_fact (task_id) VALUES (?)').run('t_old');

    const next = MIGRATIONS.find((m) => m.id === 7);
    expect(next, 'migration 7 must exist').toBeDefined();
    raw.exec(next!.sql);

    const row = raw.prepare('SELECT worktree_path FROM task WHERE id = ?').get('t_old') as {
      worktree_path: string | null;
    };
    expect(row.worktree_path).toBe('/wt');
    const info = raw.prepare('PRAGMA table_info(task)').all() as { name: string; notnull: number }[];
    expect(info.find((c) => c.name === 'worktree_path')?.notnull).toBe(0);
    const cols = raw.prepare('PRAGMA table_info(agent_fact)').all() as { name: string }[];
    expect(cols.some((c) => c.name === 'external_block')).toBe(true);
    raw.close();
  });
});

describe('CDC — a raw SQL write reaches a subscriber', () => {
  it('an INSERT produces a task.upserted push', () => {
    const broadcaster = new CdcBroadcaster(db, { now: () => NOW });
    const seen: ServerMessage[] = [];
    broadcaster.subscribe((m) => seen.push(m));

    expect(seen[0]?.type).toBe('snapshot');

    seedTask();
    broadcaster.tick();

    const push = seen.at(-1);
    expect(push?.type).toBe('task.upserted');
    if (push?.type !== 'task.upserted') throw new Error('unreachable');
    expect(push.task.task.id).toBe('t1');
    // No agent yet → §6 row 13.
    expect(push.task.status).toBe('queued');
    expect(push.task.chatId).toBe('t1');
    expect(push.task.agentId).toBe('claude');
  });

  it('a raw UPDATE of a fact table re-derives status and pushes it', () => {
    seedTask();
    const broadcaster = new CdcBroadcaster(db, { now: () => NOW });
    const seen: ServerMessage[] = [];
    broadcaster.subscribe((m) => seen.push(m));

    // Deliberately raw SQL, bypassing every service: §5.4 says the database is the event
    // source, so a write nothing in the daemon knows about must still reach the UI.
    db.prepare(
      `INSERT INTO agent_fact (task_id, substrate_pane_id, substrate_state, pane_alive, state_change_seq)
       VALUES ('t1', 'w3:p2', 'working', 1, 5)`,
    ).run();
    expect(broadcaster.tick()).toBe(1);

    let push = seen.at(-1);
    if (push?.type !== 'task.upserted') throw new Error('expected upsert');
    expect(push.task.status).toBe('implementing');
    expect(push.task.needsYou).toBe(false);

    // …and a status change flows through the same path.
    db.prepare("UPDATE agent_fact SET substrate_state = 'blocked', state_change_seq = 6 WHERE task_id = 't1'").run();
    expect(broadcaster.tick()).toBe(1);

    push = seen.at(-1);
    if (push?.type !== 'task.upserted') throw new Error('expected upsert');
    expect(push.task.status).toBe('needs_input');
    expect(push.task.needsYou).toBe(true);
  });

  it('a chat_turn insert reaches the snapshot as durable turns', () => {
    seedTask();
    const broadcaster = new CdcBroadcaster(db, { now: () => NOW });
    const seen: ServerMessage[] = [];
    broadcaster.subscribe((m) => seen.push(m));

    db.prepare(
      `INSERT INTO chat_turn (id, task_id, seq, role, origin, text, delivery, created_at)
       VALUES ('ct_1', 't1', 1, 'user', 'human', 'hello', 'accepted', ?)`,
    ).run(NOW);
    expect(broadcaster.tick()).toBe(1);

    const push = seen.at(-1);
    if (push?.type !== 'task.upserted') throw new Error('expected upsert');
    expect(push.task.turns).toEqual([
      {
        id: 'ct_1',
        task_id: 't1',
        seq: 1,
        role: 'user',
        origin: 'human',
        text: 'hello',
        delivery: 'accepted',
        created_at: NOW,
        error: null,
      },
    ]);
  });

  it('collapses several fact writes in one transaction into a single push', () => {
    seedTask();
    const broadcaster = new CdcBroadcaster(db, { now: () => NOW });
    const seen: ServerMessage[] = [];
    broadcaster.subscribe((m) => seen.push(m));
    const before = seen.length;

    db.transaction(() => {
      db.prepare(
        `INSERT INTO agent_fact (task_id, substrate_state, pane_alive, state_change_seq)
         VALUES ('t1', 'done', 1, 2)`,
      ).run();
      db.prepare("UPDATE agent_fact SET last_event = 'to_review' WHERE task_id = 't1'").run();
      db.prepare(
        `INSERT INTO scm_fact (task_id, unresolved_threads, fetched_at) VALUES ('t1', 0, ?)`,
      ).run(NOW);
    })();

    expect(broadcaster.tick()).toBe(1);
    expect(seen.length).toBe(before + 1);
    const push = seen.at(-1);
    if (push?.type !== 'task.upserted') throw new Error('expected upsert');
    expect(push.task.status).toBe('awaiting_review');
  });

  it('a DELETE produces task.removed', () => {
    seedTask();
    const broadcaster = new CdcBroadcaster(db, { now: () => NOW });
    const seen: ServerMessage[] = [];
    broadcaster.subscribe((m) => seen.push(m));

    db.prepare("DELETE FROM task WHERE id = 't1'").run();
    broadcaster.tick();

    const push = seen.at(-1);
    expect(push?.type).toBe('task.removed');
  });

  it('does not re-emit rows already consumed', () => {
    seedTask();
    const broadcaster = new CdcBroadcaster(db, { now: () => NOW });
    broadcaster.subscribe(() => {});
    db.prepare("UPDATE task SET title = 'renamed' WHERE id = 't1'").run();
    expect(broadcaster.tick()).toBe(1);
    expect(broadcaster.tick()).toBe(0);
  });

  it('the watermark advances monotonically with change_log', () => {
    seedTask();
    const broadcaster = new CdcBroadcaster(db, { now: () => NOW });
    broadcaster.subscribe(() => {});
    const start = broadcaster.watermark;
    db.prepare("UPDATE task SET title = 'a' WHERE id = 't1'").run();
    broadcaster.tick();
    expect(broadcaster.watermark).toBeGreaterThan(start);
    expect(broadcaster.watermark).toBe(currentWatermark(db));
  });
});

describe('change_log retention', () => {
  it('prunes to the retention window and reports the oldest surviving seq', () => {
    seedTask();
    for (let i = 0; i < 50; i++) {
      db.prepare('UPDATE task SET title = ? WHERE id = ?').run(`t${i}`, 't1');
    }
    const oldest = pruneChangeLog(db, 10);
    const count = db.prepare('SELECT COUNT(*) c FROM change_log').get() as { c: number };
    expect(count.c).toBeLessThanOrEqual(11);
    expect(oldest).toBeGreaterThan(0);
  });
});

describe('CDC — an unreadable task does not take the daemon down', () => {
  it('reports the failure, keeps serving, and does not drop the task', () => {
    seedTask();
    const warnings: string[] = [];
    const broadcaster = new CdcBroadcaster(db, {
      now: () => NOW,
      onWarning: (message) => warnings.push(message),
    });
    const seen: ServerMessage[] = [];

    // An incompatible database: an auxiliary table `toTaskView` reads is missing. The observed
    // crash was `no such table: chat_context` thrown from the websocket connection handler.
    db.exec('DROP TABLE chat_context');

    expect(() => broadcaster.subscribe((message) => seen.push(message))).not.toThrow();
    const snapshot = seen[0];
    if (snapshot?.type !== 'snapshot') throw new Error('expected a snapshot');
    // The unreadable task is omitted from the snapshot rather than crashing it.
    expect(snapshot.tasks).toEqual([]);

    // A later change still cannot be turned into a view, so no push is sent…
    db.prepare("UPDATE task SET title = 'renamed' WHERE id = 't1'").run();
    expect(broadcaster.tick()).toBe(0);
    // …and crucially no `task.removed`: we could not read the task, which is not the same as it
    // being gone, so the client keeps whatever it was showing.
    expect(seen.some((message) => message.type === 'task.removed')).toBe(false);
    expect(warnings.join('\n')).toContain('chat_context');
  });
});
