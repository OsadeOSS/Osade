import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

import { MIGRATIONS, type Migration } from './migrations.js';

export type Db = Database.Database;

/**
 * Opens the Osade database and applies pending migrations.
 *
 * OSADE.md §2.2 — INVARIANT: everything Osade writes lives under `~/.osade/`. The caller
 * passes the path; nothing here reaches for a platform default.
 */
export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });

  const nativeBinding = sqliteAddon();
  const db = nativeBinding ? new Database(path, { nativeBinding }) : new Database(path);

  // WAL so the CDC poller can read while writers commit.
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  // Wait out a checkpoint or a briefly overlapping writer. Still SQLITE_BUSY after this
  // means another process is holding osade.db — callers must not treat that as fatal.
  db.pragma('busy_timeout = 10000');

  migrate(db);
  // §5 — refuse to serve a database this build's migrations do not describe. A divergent build
  // records ids this one never wrote, or records an id whose table it never created; both used
  // to surface much later as an obscure crash. Fatal *here*, with the remedy in the message.
  try {
    assertSchemaCurrent(db);
  } catch (err) {
    // Do not hand back — or leave open — a database this build cannot describe.
    db.close();
    throw err;
  }
  return db;
}

/**
 * Where better-sqlite3's native addon is, when it cannot find it itself.
 *
 * Left alone, better-sqlite3 resolves through the `bindings` package, which walks upward looking
 * for a `node_modules/better-sqlite3/build`. That works in a checkout running from source and
 * fails for a *bundle*, which is one file with no such layout above it — packaged beside its
 * addon, or built to `dist/` beside the package's own node_modules.
 *
 * Checked in order, and null when none exists, because letting `bindings` try is the right
 * answer for the unbundled case rather than an error.
 */
function sqliteAddon(): string | undefined {
  const explicit = process.env.OSADE_SQLITE_BINDING;
  if (explicit && existsSync(explicit)) return explicit;

  let here: string;
  try {
    here = dirname(fileURLToPath(import.meta.url));
  } catch {
    return undefined;
  }

  const candidates = [
    // Packaged: the addon ships beside the bundle.
    join(here, 'better_sqlite3.node'),
    // Built to dist/: the package's own node_modules is one level up.
    join(here, '..', 'node_modules/better-sqlite3/build/Release/better_sqlite3.node'),
  ];
  return candidates.find((candidate) => existsSync(candidate));
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

/**
 * Raised when the database on disk does not match this build's migrations.
 *
 * Fatal at boot by design: a half-working daemon serving a schema it does not understand is
 * worse than a loud refusal that names the fix.
 */
export class SchemaMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaMismatchError';
  }
}

/**
 * OSADE.md §5 — boot-time guard: the database must match this build.
 *
 * Migration ids are dense integers and are never reused, so a database written by a *different*
 * Osade build can collide with this one's ids: `migrate` sees id 13 already recorded and skips
 * `M013`, and the omission only surfaces later, deep in a read. Observed in the wild as
 * `SqliteError: no such table: chat_context`, thrown from the websocket snapshot on the first
 * connect.
 *
 * Two shapes are a mismatch, and both are fatal:
 *   - an applied id this build does not define (a newer or other build wrote it), and
 *   - an applied migration whose `probe` table is absent (its id collided and it was skipped).
 *
 * The remedy is total and cheap by design — §2.2: `~/.osade` is resettable.
 */
export function assertSchemaCurrent(db: Db, migrations: readonly Migration[] = MIGRATIONS): void {
  const applied = new Set(
    db
      .prepare('SELECT id FROM schema_migration')
      .all()
      .map((row) => (row as { id: number }).id),
  );
  const known = new Set(migrations.map((migration) => migration.id));

  const unknown = [...applied].filter((id) => !known.has(id)).sort((a, b) => a - b);
  if (unknown.length > 0) {
    throw new SchemaMismatchError(
      `this database was written by a different Osade build: migration(s) ${unknown.join(', ')} ` +
        `are recorded but unknown here. Migration ids are dense and never reused, so a divergent ` +
        `build skips this one's silently. Reset state: delete the Osade database file ` +
        `(~/.osade/osade.db by default; see OSADE.md §2.2).`,
    );
  }

  const skipped: string[] = [];
  for (const migration of migrations) {
    if (!migration.probe || !applied.has(migration.id)) continue;
    if (!tableExists(db, migration.probe)) {
      skipped.push(
        `table "${migration.probe}" (from migration ${migration.id}: ${migration.name})`,
      );
    }
  }
  if (skipped.length > 0) {
    throw new SchemaMismatchError(
      `this database is out of step with this build: recorded migrations whose tables are ` +
        `missing:\n  - ${skipped.join(
          '\n  - ',
        )}\nMigration ids are dense and never reused, so a divergent build can skip one silently. ` +
        `Reset state: delete the Osade database file (~/.osade/osade.db by default; see OSADE.md §2.2).`,
    );
  }
}

function tableExists(db: Db, name: string): boolean {
  const row = db
    .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
  return row !== undefined;
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
