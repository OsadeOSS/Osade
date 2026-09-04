import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ServerMessage } from '@osade/contract';

import {
  CDC_TABLES,
  currentWatermark,
  migrate,
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
  });

  it('a raw UPDATE of a fact table re-derives status and pushes it', () => {
    seedTask();
    const broadcaster = new CdcBroadcaster(db, { now: () => NOW });
    const seen: ServerMessage[] = [];
    broadcaster.subscribe((m) => seen.push(m));

    // Deliberately raw SQL, bypassing every service: §5.4 says the database is the event
    // source, so a write nothing in the daemon knows about must still reach the UI.
    db.prepare(
      `INSERT INTO agent_fact (task_id, herdr_pane_id, herdr_state, pane_alive, state_change_seq)
       VALUES ('t1', 'w3:p2', 'working', 1, 5)`,
    ).run();
    expect(broadcaster.tick()).toBe(1);

    let push = seen.at(-1);
    if (push?.type !== 'task.upserted') throw new Error('expected upsert');
    expect(push.task.status).toBe('implementing');
    expect(push.task.needsYou).toBe(false);

    // …and a status change flows through the same path.
    db.prepare("UPDATE agent_fact SET herdr_state = 'blocked', state_change_seq = 6 WHERE task_id = 't1'").run();
    expect(broadcaster.tick()).toBe(1);

    push = seen.at(-1);
    if (push?.type !== 'task.upserted') throw new Error('expected upsert');
    expect(push.task.status).toBe('needs_input');
    expect(push.task.needsYou).toBe(true);
  });

  it('collapses several fact writes in one transaction into a single push', () => {
    seedTask();
    const broadcaster = new CdcBroadcaster(db, { now: () => NOW });
    const seen: ServerMessage[] = [];
    broadcaster.subscribe((m) => seen.push(m));
    const before = seen.length;

    db.transaction(() => {
      db.prepare(
        `INSERT INTO agent_fact (task_id, herdr_state, pane_alive, state_change_seq)
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
