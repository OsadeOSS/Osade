import { z } from 'zod';

import { Timestamp } from './primitives.js';

/**
 * Quick notes, as they cross the boundary — issue #19.
 *
 * "Things I noticed and am deliberately not fixing yet", scoped to a repository. The shape is
 * a notepad on purpose: text, and the place it was noticed. There is no priority, no due date
 * and no lifecycle beyond "resolved", because a note that grows those fields has become a task
 * tracker and will be ignored within a fortnight.
 *
 * **`resolvedAt`, not `status`** — §6, and the reason is mechanical rather than aesthetic:
 * `test/integration/cdc.test.ts` asserts that no table in this database has a column called
 * `status`, and §20.1 extends the ban to this file. A resolved note is a fact about when, not a
 * state the row is in, so the timestamp is the honest encoding and the empty one is a fact too.
 *
 * The snake_case fact that mirrors the row lives in the daemon, next to the SQL, the way
 * `Convention` does — only the view crosses the boundary.
 */
export const QuickNoteView = z.object({
  id: z.string(),
  repoId: z.string(),
  text: z.string(),
  createdAt: Timestamp,
  /** `null` while the note is still open. See the note on §6 above. */
  resolvedAt: Timestamp.nullable(),
  /**
   * Where the note was taken, relative to the repository root.
   *
   * Repository-relative rather than absolute on purpose: a note is worth most when you are in a
   * different worktree than when you wrote it, and a worktree's root is the same tree.
   */
  file: z.string().nullable(),
  /** 1-based, matching `lineRangeFromOffsets`. */
  line: z.number().int().nullable(),
});
export type QuickNoteView = z.infer<typeof QuickNoteView>;
