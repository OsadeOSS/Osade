import { randomUUID } from 'node:crypto';

import type { QuickNoteView } from '@osade/contract';

import type { Db } from '../db/index.js';

/**
 * Quick notes — issue #19. "Noticed, not fixing yet."
 *
 * Free functions taking `db` first, like `chat-turns.ts`, rather than a service on
 * `DaemonContext` like `Conventions`. Nothing here is optional and nothing is injected but the
 * clock, so a class and a context field would be two more things to wire for no behaviour.
 *
 * The rules this module enforces, all at write time rather than on read:
 *
 *   - **A note is not empty.** Whitespace is not a thought. A stored blank note is a row the
 *     user has to look at and delete, and it will sit in their context forever.
 *   - **A note is a note, not a paste.** `MAX_NOTE_CHARS` because the whole payload is
 *     re-sent to an agent on every message; an unbounded field here is a prompt-injection
 *     surface and a token bill.
 *   - **`file` is repository-relative.** See the contract for why.
 */

export const MAX_NOTE_CHARS = 2_000;

/** Raised for input a person can fix by typing something else. */
export class NoteError extends Error {}

const COLS = 'id, repo_id, text, created_at, resolved_at, file, line';

const INSERT = `INSERT INTO quick_note (${COLS}) VALUES (?, ?, ?, ?, ?, ?, ?)`;

export interface NoteInput {
  repoId: string;
  text: string;
  file?: string | null;
  line?: number | null;
}

export function listNotes(db: Db, repoId: string): QuickNoteView[] {
  const rows = db
    .prepare(
      `SELECT ${COLS} FROM quick_note WHERE repo_id = ?
        ORDER BY resolved_at IS NOT NULL, created_at DESC`,
    )
    .all(repoId) as Record<string, unknown>[];
  return rows.map(rowToNote);
}

/**
 * Open notes, oldest first — the order they will be listed to an agent.
 *
 * Oldest first because the note most likely to be stale is the one worth mentioning, and a
 * prompt that ends on the newest note is a prompt that ends on the note the user just typed.
 */
export function listOpenNotes(db: Db, repoId: string): QuickNoteView[] {
  const rows = db
    .prepare(
      `SELECT ${COLS} FROM quick_note WHERE repo_id = ? AND resolved_at IS NULL
        ORDER BY created_at ASC`,
    )
    .all(repoId) as Record<string, unknown>[];
  return rows.map(rowToNote);
}

export function createNote(db: Db, input: NoteInput, now: number): QuickNoteView {
  const text = requireText(input.text);
  if (input.file != null && input.file.trim() === '') {
    throw new NoteError('a note cannot be filed against an empty path');
  }
  if (input.line != null && (!Number.isInteger(input.line) || input.line < 1)) {
    throw new NoteError('a note line is 1-based');
  }

  const note: QuickNoteView = {
    id: `qn_${randomUUID().slice(0, 8)}`,
    repoId: input.repoId,
    text,
    createdAt: now,
    resolvedAt: null,
    file: input.file == null ? null : normalisePath(input.file),
    line: input.line ?? null,
  };
  db.prepare(INSERT).run(
    note.id,
    note.repoId,
    note.text,
    note.createdAt,
    null,
    note.file,
    note.line,
  );
  return note;
}

/** Resolve or reopen. Passing the clock in keeps "when" a fact of the write, not of the read. */
export function setNoteResolved(db: Db, id: string, resolved: boolean, now: number): void {
  const result = db
    .prepare('UPDATE quick_note SET resolved_at = ? WHERE id = ?')
    .run(resolved ? now : null, id);
  if (result.changes === 0) throw new NoteError('unknown note');
}

export function editNote(db: Db, id: string, text: string): void {
  const next = requireText(text);
  const result = db.prepare('UPDATE quick_note SET text = ? WHERE id = ?').run(next, id);
  if (result.changes === 0) throw new NoteError('unknown note');
}

export function deleteNote(db: Db, id: string): void {
  const result = db.prepare('DELETE FROM quick_note WHERE id = ?').run(id);
  if (result.changes === 0) throw new NoteError('unknown note');
}

/**
 * The open note filed against one file, if any. `useFileOpenReminder`'s lookup.
 *
 * `COLLATE NOCASE` is not a nicety. A note's `file` is whatever the Files lane reported when it
 * was taken, and what the Files lane reports for the same file can differ only in case — `git`
 * and the filesystem are both inconsistent about it, and the two do not always agree. An exact
 * `=` here means a reminder that silently does not fire on a file that genuinely has a note on
 * it, which is the one failure this whole feature cannot have: it looks like the product is
 * broken rather than like it is quiet.
 */
export function openNoteForFile(db: Db, repoId: string, file: string): QuickNoteView | null {
  const target = normalisePath(file);
  const row = db
    .prepare(
      `SELECT ${COLS} FROM quick_note
        WHERE repo_id = ? AND resolved_at IS NULL AND file = ? COLLATE NOCASE
        ORDER BY created_at ASC LIMIT 1`,
    )
    .get(repoId, target) as Record<string, unknown> | undefined;
  return row == null ? null : rowToNote(row);
}

function requireText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) throw new NoteError('a note cannot be empty');
  if (trimmed.length > MAX_NOTE_CHARS) {
    throw new NoteError(`a note is at most ${MAX_NOTE_CHARS} characters`);
  }
  return trimmed;
}

/**
 * Windows separators, one spelling.
 *
 * A path is compared against a note by string equality on a repo-relative path, and
 * `apps\desktop\App.tsx` and `apps/desktop/App.tsx` are the same file. The Files lane already
 * emits forward slashes, but a note typed by hand or arriving from a diff may not.
 */
export function normalisePath(path: string): string {
  return path.replace(/\\/gu, '/').replace(/^\.\//u, '');
}

function rowToNote(r: Record<string, unknown>): QuickNoteView {
  return {
    id: r.id as string,
    repoId: r.repo_id as string,
    text: r.text as string,
    createdAt: r.created_at as number,
    resolvedAt: (r.resolved_at as number | null) ?? null,
    file: (r.file as string | null) ?? null,
    line: (r.line as number | null) ?? null,
  };
}
