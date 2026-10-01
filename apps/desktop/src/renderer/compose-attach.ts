/** Lane context prepended to a composer send — docs/agent_handler.md §1. */

export interface ComposerAttach {
  label: string;
  fence: string;
}

export function prependAttach(message: string, attach: ComposerAttach | null): string {
  if (attach == null || attach.fence.trim().length === 0) return message;
  return `${attach.fence.trim()}\n\n${message}`;
}

export function lineRangeFromOffsets(
  text: string,
  start: number,
  end: number,
): { from: number; to: number } | null {
  if (start === end) return null;
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  const from = 1 + (text.slice(0, lo).match(/\n/g)?.length ?? 0);
  const to = 1 + (text.slice(0, hi).match(/\n/g)?.length ?? 0);
  return { from, to };
}

/**
 * The inverse: the character offset a 1-based line starts at.
 *
 * The other half of `lineRangeFromOffsets`, and the one a quick note needs. A note records a
 * line, and "open `src/login.ts:42`" has to mean the character position of line 42 in whatever
 * worktree is open now — the note is repo-relative and deliberately survives being read from a
 * different checkout, so this is recomputed on the text in front of you rather than stored.
 *
 * Past the end of the text is clamped, not an error: a note can outlive the file it is about,
 * and landing at the end of the file beats throwing while someone is trying to read it.
 */
export function lineToOffset(text: string, line: number): number {
  const want = Math.max(1, Math.floor(Number.isFinite(line) ? line : 1));
  let offset = 0;
  let current = 1;
  while (current < want) {
    const next = text.indexOf('\n', offset);
    if (next < 0) return text.length;
    offset = next + 1;
    current += 1;
  }
  return Math.min(offset, text.length);
}

/** The span a 1-based line occupies, for selecting it in the editor. */
export function lineSpan(text: string, line: number): { from: number; to: number } {
  const from = lineToOffset(text, line);
  const nextBreak = text.indexOf('\n', from);
  const to = nextBreak < 0 ? text.length : nextBreak;
  return { from, to };
}

export function fileAttach(
  path: string,
  text: string,
  range: { from: number; to: number } | null,
): ComposerAttach {
  const lines = text.split('\n');
  if (range == null) {
    return { label: path, fence: `\`\`\`file\n${path}\n\`\`\`` };
  }
  const slice = lines.slice(range.from - 1, range.to).join('\n');
  const span = range.from === range.to ? `L${range.from}` : `L${range.from}–${range.to}`;
  return {
    label: `${path} ${span}`,
    fence: `\`\`\`file\n${path} ${span}\n${slice}\n\`\`\``,
  };
}

export function hunkAttach(
  path: string,
  lines: readonly { kind: string; text: string }[],
  cursor: number,
): ComposerAttach | null {
  if (lines.length === 0) return path.length > 0 ? { label: path, fence: `\`\`\`diff\n${path}\n\`\`\`` } : null;
  let start = Math.min(Math.max(cursor, 0), lines.length - 1);
  while (start > 0 && lines[start]!.kind !== 'hunk') start -= 1;
  if (lines[start]!.kind !== 'hunk') {
    start = lines.findIndex((line) => line.kind === 'hunk');
    if (start < 0) start = 0;
  }
  let end = start + 1;
  while (end < lines.length && lines[end]!.kind !== 'hunk') end += 1;
  const body = lines
    .slice(start, end)
    .map((line) => line.text)
    .join('\n');
  const header = lines[start]?.text ?? path;
  return {
    label: `${path} ${header}`,
    fence: `\`\`\`diff\n${path}\n${body}\n\`\`\``,
  };
}

export function checksAttach(stepName: string, logTail: string): ComposerAttach {
  const tail = logTail.trim();
  const body = tail.length > 0 ? `${stepName}\n${tail}` : stepName;
  return {
    label: stepName,
    fence: `\`\`\`checks\n${body}\n\`\`\``,
  };
}

export function rulesAttach(id: string, ruleText: string): ComposerAttach {
  return {
    label: id,
    fence: `\`\`\`rules\n${id}\n${ruleText}\n\`\`\``,
  };
}
