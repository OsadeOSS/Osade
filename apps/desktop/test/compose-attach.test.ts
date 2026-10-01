import { describe, expect, it } from 'vitest';

import {
  checksAttach,
  fileAttach,
  hunkAttach,
  lineRangeFromOffsets,
  lineSpan,
  lineToOffset,
  prependAttach,
  rulesAttach,
} from '../src/renderer/compose-attach.js';

describe('lineToOffset', () => {
  const text = 'one\ntwo\nthree\nfour';

  it('maps a 1-based line to its first character', () => {
    expect(lineToOffset(text, 1)).toBe(0);
    expect(lineToOffset(text, 2)).toBe(4);
    expect(lineToOffset(text, 3)).toBe(8);
  });

  it('clamps past the end rather than throwing', () => {
    // A note can outlive the file it is about; landing at the end beats an exception while
    // someone is trying to read the file.
    expect(lineToOffset(text, 99)).toBe(text.length);
    expect(lineToOffset('', 3)).toBe(0);
  });

  it('refuses a line that is not a line', () => {
    expect(lineToOffset(text, 0)).toBe(0);
    expect(lineToOffset(text, -5)).toBe(0);
    expect(lineToOffset(text, Number.NaN)).toBe(0);
  });

  it('round-trips with lineRangeFromOffsets', () => {
    const span = lineSpan(text, 3);
    expect(span).toEqual({ from: 8, to: 13 });
    expect(lineRangeFromOffsets(text, span.from, span.to)).toEqual({ from: 3, to: 3 });
  });

  it('gives the last line a span that stops at the end of the text', () => {
    expect(lineSpan(text, 4)).toEqual({ from: 14, to: 18 });
    // Past the end, the span collapses to the end of the text rather than failing.
    expect(lineSpan('one\ntwo', 9)).toEqual({ from: 7, to: 7 });
  });
});

describe('prependAttach', () => {
  it('puts the fence before the message so parseMentions sees it as shared preamble', () => {
    const attach = fileAttach('src/a.ts', 'x', null);
    expect(prependAttach('@claude fix this', attach)).toBe(`${attach.fence}\n\n@claude fix this`);
  });

  it('is a no-op without attach', () => {
    expect(prependAttach('hello', null)).toBe('hello');
  });
});

describe('lineRangeFromOffsets', () => {
  it('is null when there is no selection', () => {
    expect(lineRangeFromOffsets('a\nb', 1, 1)).toBeNull();
  });

  it('maps a selection onto 1-based line numbers', () => {
    expect(lineRangeFromOffsets('a\nb\nc', 0, 3)).toEqual({ from: 1, to: 2 });
  });
});

describe('fileAttach', () => {
  it('names the path when there is no selection', () => {
    const attach = fileAttach('src/foo.ts', 'hello\nworld', null);
    expect(attach.label).toBe('src/foo.ts');
    expect(attach.fence).toContain('src/foo.ts');
    expect(attach.fence).not.toContain('hello');
  });

  it('includes the selected lines', () => {
    const attach = fileAttach('src/foo.ts', 'hello\nworld\nbye', { from: 2, to: 3 });
    expect(attach.label).toBe('src/foo.ts L2–3');
    expect(attach.fence).toContain('world\nbye');
  });
});

describe('hunkAttach', () => {
  it('takes the hunk the cursor sits in', () => {
    const lines = [
      { kind: 'meta', text: 'diff --git a/a b/a' },
      { kind: 'hunk', text: '@@ -1,2 +1,2 @@' },
      { kind: 'ctx', text: ' one' },
      { kind: 'hunk', text: '@@ -10,1 +10,1 @@' },
      { kind: 'add', text: '+two' },
    ];
    const attach = hunkAttach('a.ts', lines, 4);
    expect(attach?.fence).toContain('@@ -10,1 +10,1 @@');
    expect(attach?.fence).not.toContain(' one');
  });
});

describe('checksAttach / rulesAttach', () => {
  it('names the step and includes the log tail', () => {
    expect(checksAttach('lint', 'error at 3').fence).toContain('lint');
    expect(checksAttach('lint', 'error at 3').fence).toContain('error at 3');
  });

  it('cites the rule id and text', () => {
    const attach = rulesAttach('c_1', 'Prefer early return.');
    expect(attach.label).toBe('c_1');
    expect(attach.fence).toContain('Prefer early return.');
  });
});
