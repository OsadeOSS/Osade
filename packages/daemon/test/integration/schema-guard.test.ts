import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  assertSchemaCurrent,
  migrate,
  MIGRATIONS,
  openDb,
  SchemaMismatchError,
  type Db,
} from '../../src/db/index.js';

const NOW = 1_756_000_000_000;

let db: Db;

beforeEach(() => {
  db = openDb(':memory:');
});

afterEach(() => {
  db.close();
});

describe('assertSchemaCurrent — the database must match this build', () => {
  it('accepts a freshly migrated database', () => {
    expect(() => assertSchemaCurrent(db)).not.toThrow();
    // The guard is a no-op on top of migrate, whether or not it is called twice.
    expect(() => {
      migrate(db);
      assertSchemaCurrent(db);
    }).not.toThrow();
  });

  it('rejects an applied migration id this build does not define', () => {
    // A newer/other build wrote rows this one has no migration for.
    db.prepare('INSERT INTO schema_migration (id, applied_at) VALUES (?, ?)').run(99, NOW);

    expect(() => assertSchemaCurrent(db)).toThrow(SchemaMismatchError);
    expect(() => assertSchemaCurrent(db)).toThrow(/different Osade build/);
    expect(() => assertSchemaCurrent(db)).toThrow(/99/);
  });

  it('rejects a recorded migration whose table was skipped — the observed crash', () => {
    // Every id is recorded yet `chat_context` is absent: exactly what a divergent build produced,
    // which used to surface as `SqliteError: no such table: chat_context` from the websocket.
    db.exec('DROP TABLE chat_context');

    expect(() => assertSchemaCurrent(db)).toThrow(SchemaMismatchError);
    expect(() => assertSchemaCurrent(db)).toThrow(/chat_context/);
  });

  it('fails boot with an actionable message instead of a late SqliteError', () => {
    const dir = mkdtempSync(join(tmpdir(), 'osade-schema-'));
    const path = join(dir, 'osade.db');
    try {
      const raw = new Database(path);
      raw.exec(
        'CREATE TABLE schema_migration (id INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)',
      );
      for (const migration of MIGRATIONS) {
        raw.exec(migration.sql);
        raw.prepare('INSERT INTO schema_migration (id, applied_at) VALUES (?, ?)').run(
          migration.id,
          NOW,
        );
      }
      // An id from a build this one is not.
      raw.prepare('INSERT INTO schema_migration (id, applied_at) VALUES (?, ?)').run(9001, NOW);
      raw.close();

      expect(() => openDb(path)).toThrow(SchemaMismatchError);
      expect(() => openDb(path)).toThrow(/different Osade build/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
