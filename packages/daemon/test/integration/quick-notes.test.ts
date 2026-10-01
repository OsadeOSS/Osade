import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDb, type Db } from '../../src/db/index.js';
import {
  createNote,
  deleteNote,
  editNote,
  listNotes,
  listOpenNotes,
  MAX_NOTE_CHARS,
  NoteError,
  normalisePath,
  openNoteForFile,
  setNoteResolved,
} from '../../src/domain/quick-notes.js';

const NOW = 1_756_000_000_000;

let db: Db;

function seedRepo(id = 'r1'): void {
  db.prepare('INSERT INTO repo (id, path, default_branch, created_at) VALUES (?, ?, ?, ?)').run(
    id,
    `/repo-${id}`,
    'main',
    NOW,
  );
}

beforeEach(() => {
  db = openDb(':memory:');
  seedRepo();
});

afterEach(() => {
  db.close();
});

describe('quick notes — write time is where the rules live', () => {
  it('stores a note with the place it was taken', () => {
    const note = createNote(
      db,
      { repoId: 'r1', text: '  fix the auth redirect loop  ', file: 'src/login.ts', line: 42 },
      NOW,
    );
    expect(note.id).toMatch(/^qn_/);
    expect(note.text).toBe('fix the auth redirect loop');
    expect(note.resolvedAt).toBeNull();
    expect(listNotes(db, 'r1')).toHaveLength(1);
  });

  it('refuses an empty note', () => {
    for (const text of ['', '   ', '\n\t']) {
      expect(() => createNote(db, { repoId: 'r1', text }, NOW)).toThrow(NoteError);
    }
    expect(listNotes(db, 'r1')).toHaveLength(0);
  });

  it('refuses a note too long to sit in every prompt', () => {
    expect(() =>
      createNote(db, { repoId: 'r1', text: 'x'.repeat(MAX_NOTE_CHARS + 1) }, NOW),
    ).toThrow(/at most/);
    expect(() =>
      createNote(db, { repoId: 'r1', text: 'x'.repeat(MAX_NOTE_CHARS) }, NOW),
    ).not.toThrow();
  });

  it('refuses a line that is not a line', () => {
    expect(() => createNote(db, { repoId: 'r1', text: 'x', line: 0 }, NOW)).toThrow(/1-based/);
    expect(() => createNote(db, { repoId: 'r1', text: 'x', line: 1.5 }, NOW)).toThrow(/1-based/);
  });

  it('reports an unknown note rather than silently doing nothing', () => {
    expect(() => setNoteResolved(db, 'qn_nope', true, NOW)).toThrow(/unknown note/);
    expect(() => editNote(db, 'qn_nope', 'x')).toThrow(/unknown note/);
    expect(() => deleteNote(db, 'qn_nope')).toThrow(/unknown note/);
  });
});

describe('quick notes — §6: resolved is a timestamp, never a status', () => {
  it('resolving stamps the time and reopening clears it', () => {
    const note = createNote(db, { repoId: 'r1', text: 'swap the hardcoded url' }, NOW);
    setNoteResolved(db, note.id, true, NOW + 5_000);
    expect(listNotes(db, 'r1')[0]!.resolvedAt).toBe(NOW + 5_000);
    setNoteResolved(db, note.id, false, NOW + 9_000);
    expect(listNotes(db, 'r1')[0]!.resolvedAt).toBeNull();
  });

  it('has no status column to store one in', () => {
    // §6 is enforced by cdc.test.ts across every table; this is the same claim from the other
    // side, so that adding one fails here first with a name that says why.
    const columns = (db.prepare('PRAGMA table_info(quick_note)').all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(columns).not.toContain('status');
    expect(columns).toContain('resolved_at');
  });
});

describe('quick notes — what an agent is shown', () => {
  it('lists open notes oldest first and resolved ones last', () => {
    createNote(db, { repoId: 'r1', text: 'old' }, NOW);
    createNote(db, { repoId: 'r1', text: 'new' }, NOW + 1_000);
    const done = createNote(db, { repoId: 'r1', text: 'done' }, NOW + 2_000);
    setNoteResolved(db, done.id, true, NOW + 3_000);

    // `listNotes` is the panel's order — open first, newest first, resolved collapsed below.
    expect(listNotes(db, 'r1').map((n) => n.text)).toEqual(['new', 'old', 'done']);
    // `listOpenNotes` is the prompt's order — oldest first, so the stalest note reads last.
    expect(listOpenNotes(db, 'r1').map((n) => n.text)).toEqual(['old', 'new']);
  });

  it('keeps repositories apart', () => {
    seedRepo('r2');
    createNote(db, { repoId: 'r1', text: 'one' }, NOW);
    createNote(db, { repoId: 'r2', text: 'two' }, NOW);
    expect(listNotes(db, 'r1').map((n) => n.text)).toEqual(['one']);
    expect(listNotes(db, 'r2').map((n) => n.text)).toEqual(['two']);
  });
});

describe('quick notes — the file a note belongs to', () => {
  it('finds the open note for a file however the path was spelled', () => {
    createNote(db, { repoId: 'r1', text: 'loop', file: 'src/login.ts', line: 42 }, NOW);
    expect(openNoteForFile(db, 'r1', 'src/login.ts')?.text).toBe('loop');
    expect(openNoteForFile(db, 'r1', '.\\src\\login.ts')?.text).toBe('loop');
    expect(openNoteForFile(db, 'r1', 'src/other.ts')).toBeNull();
  });

  it('matches a path that differs only in case', () => {
    // git and the filesystem each report casing inconsistently, and a reminder that silently
    // does not fire looks like the product is broken rather than quiet.
    createNote(db, { repoId: 'r1', text: 'loop', file: 'SRC/Login.ts' }, NOW);
    expect(openNoteForFile(db, 'r1', 'src/login.ts')?.text).toBe('loop');
    expect(openNoteForFile(db, 'r1', 'Src/Login.TS')?.text).toBe('loop');
  });

  it('does not resurrect a resolved note as a reminder', () => {
    const note = createNote(db, { repoId: 'r1', text: 'loop', file: 'src/login.ts' }, NOW);
    setNoteResolved(db, note.id, true, NOW + 1_000);
    expect(openNoteForFile(db, 'r1', 'src/login.ts')).toBeNull();
  });

  it('normalises separators and a leading ./', () => {
    expect(normalisePath('apps\\desktop\\App.tsx')).toBe('apps/desktop/App.tsx');
    expect(normalisePath('./src/a.ts')).toBe('src/a.ts');
    expect(normalisePath('src/a.ts')).toBe('src/a.ts');
  });
});

describe('quick notes — editing', () => {
  it('replaces the text and trims it', () => {
    const note = createNote(db, { repoId: 'r1', text: 'first' }, NOW);
    editNote(db, note.id, '  second  ');
    expect(listNotes(db, 'r1')[0]!.text).toBe('second');
  });

  it('refuses to empty a note by editing it', () => {
    const note = createNote(db, { repoId: 'r1', text: 'first' }, NOW);
    expect(() => editNote(db, note.id, '   ')).toThrow(NoteError);
    expect(listNotes(db, 'r1')[0]!.text).toBe('first');
  });
});
