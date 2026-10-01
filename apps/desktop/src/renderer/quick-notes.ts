import type { QuickNoteView } from '@osade/contract';

/**
 * Quick notes in the renderer — issue #19.
 *
 * The one thing here that matters is `notesPrompt`. A note is worth nothing if it only lives in
 * a panel: the point of the feature is that the agent *knows* about it. So every message the
 * composer sends carries the open notes, and this is where that text is built.
 *
 * It is a pure function for the same reason every other helper in this directory is: the
 * interesting question — does a resolved note ever reach an agent, does a hundred-note backlog
 * get truncated or silently truncated, is the block stripped from the chat bubble — is a
 * question about strings, and should be answerable without a browser.
 */

/**
 * How many open notes ride along with one message.
 *
 * A cap, and an honest one. Every message in every lane pays for this block, so a backlog of
 * two hundred notes would quietly turn every turn into a wall of the user's own to-do list —
 * pushing the actual message out of the agent's attention and growing the bill. Twenty is
 * enough for the notes someone actually intends to act on, and the rest are counted out loud
 * rather than dropped in silence, because "I have 180 more" is a thing a person can act on and
 * a truncated list is not.
 */
export const MAX_PROMPT_NOTES = 20;

/**
 * The note block that goes in front of a message.
 *
 * Wrapped in `<osade_notes>` for the same reason `<osade_lanes>` exists: `visibleUserText`
 * strips it back out of the chat bubble, so the transcript shows what the person said rather
 * than the scaffolding the app wrapped around it.
 *
 * No timestamps and no ids. The agent needs to know what is outstanding, not when it was typed;
 * both cost tokens and neither changes what the agent should do.
 */
export function notesPrompt(notes: readonly QuickNoteView[], message: string): string {
  const open = notes.filter((n) => n.resolvedAt == null);
  if (open.length === 0) return message;

  // Oldest first, so the stalest note — the one most likely to still be true and still be a
  // problem — reads last and is the one most likely to be attended to.
  const shown = open.slice(-MAX_PROMPT_NOTES);
  const hidden = open.length - shown.length;

  const lines = shown.map((note, i) => `${i + 1}. ${noteLine(note)}`);
  if (hidden > 0) lines.push(`…and ${hidden} more.`);

  const block = [
    '<osade_notes>',
    'Open — things I noticed and told you to remember for later:',
    ...lines,
    'If this turn touches one of these, say so. If I ask what is outstanding, this is the list.',
    '</osade_notes>',
  ].join('\n');

  return message.trim().length === 0 ? block : `${block}\n\n${message}`;
}

/** One note as the agent reads it: the thought, then where it was noticed. */
export function noteLine(note: QuickNoteView): string {
  if (note.file == null) return note.text;
  return `${note.text}  (noted at ${note.file}${note.line == null ? '' : `:${note.line}`})`;
}

/** Strip the block back out of a transcript line. Mirrors `visibleUserText`'s lane handling. */
export function stripNotesPrompt(text: string): string {
  return text.replace(/<osade_notes>[\s\S]*?<\/osade_notes>\s*/gu, '').trim();
}

/** Open first for the panel, resolved after — the order the daemon already returns them in. */
export function partitionNotes(notes: readonly QuickNoteView[]): {
  open: QuickNoteView[];
  resolved: QuickNoteView[];
} {
  return {
    open: notes.filter((n) => n.resolvedAt == null),
    resolved: notes.filter((n) => n.resolvedAt != null),
  };
}
