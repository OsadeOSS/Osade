import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import Database from 'better-sqlite3';

import { MIGRATIONS } from './migrations.js';

export type Db = Database.Database;

/**
 * Opens the Osade database and applies pending migrations.
 *
 * OSADE.md §2.2 — INVARIANT: everything Osade writes lives under `~/.osade/`. The caller
 * passes the path; nothing here reaches for a platform default.
 */
export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path);

  // WAL so the CDC poller can read while writers commit.
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // The daemon is the only writer; wait rather than throwing SQLITE_BUSY on a checkpoint.
  db.pragma('busy_timeout = 5000');

  migrate(db);
  return db;
}

export function migrate(db: Db): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migration (id INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');

  const applied = new Set(
    db
      .prepare('SELECT id FROM schema_migration')
      .all()
      .map((r) => (r as { id: number }).id),
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    // Forward-only and atomic: a half-applied migration is worse than a failed boot.
    const run = db.transaction(() => {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migration (id, applied_at) VALUES (?, ?)').run(
        migration.id,
        Date.now(),
      );
    });
    run();
  }
}

/** Current high-water mark in `change_log`. A fresh database is 0. */
export function currentWatermark(db: Db): number {
  const row = db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM change_log').get() as {
    seq: number;
  };
  return row.seq;
}

/**
 * §5.4 — retain the last 50k rows; prune on a timer.
 *
 * Returns the oldest surviving seq so the broadcaster can tell a client its watermark was
 * pruned and it needs a fresh snapshot, rather than silently skipping changes.
 */
export function pruneChangeLog(db: Db, retain = 50_000): number {
  db.prepare(
    `DELETE FROM change_log
      WHERE seq <= (SELECT COALESCE(MAX(seq), 0) - ? FROM change_log)`,
  ).run(retain);
  const row = db.prepare('SELECT COALESCE(MIN(seq), 0) AS seq FROM change_log').get() as {
    seq: number;
  };
  return row.seq;
}

export { MIGRATIONS, CDC_TABLES } from './migrations.js';
export type { Migration, CdcTable } from './migrations.js';
