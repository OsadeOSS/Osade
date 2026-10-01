import { describe, expect, it } from 'vitest';

import { visibleUserText } from '../src/renderer/chat.js';
import {
  MAX_PROMPT_NOTES,
  noteLine,
  notesPrompt,
  partitionNotes,
  stripNotesPrompt,
} from '../src/renderer/quick-notes.js';
import type { QuickNoteView } from '@osade/contract';

function note(over: Partial<QuickNoteView> = {}): QuickNoteView {
  return {
    id: 'qn_1',
    repoId: 'r1',
    text: 'fix the auth redirect loop',
    createdAt: 1_756_000_000_000,
    resolvedAt: null,
    file: null,
    line: null,
    ...over,
  };
}

describe('notesPrompt', () => {
  it('leaves the message alone when there is nothing open', () => {
    expect(notesPrompt([], 'ship it')).toBe('ship it');
    expect(notesPrompt([note({ resolvedAt: 1 })], 'ship it')).toBe('ship it');
  });

  it('lists the open notes ahead of what was typed', () => {
    const text = notesPrompt([note({ text: 'swap the hardcoded url' })], 'and ship it');
    expect(text).toContain('<osade_notes>');
    expect(text).toContain('1. swap the hardcoded url');
    expect(text.endsWith('and ship it')).toBe(true);
  });

  it('says where a note was noticed, with a line when there is one', () => {
    expect(noteLine(note({ file: 'src/login.ts', line: 42 }))).toBe(
      'fix the auth redirect loop  (noted at src/login.ts:42)',
    );
    expect(noteLine(note({ file: 'src/login.ts' }))).toBe(
      'fix the auth redirect loop  (noted at src/login.ts)',
    );
  });

  it('carries no timestamps and no ids', () => {
    const text = notesPrompt([note({ id: 'qn_secret' })], 'go');
    expect(text).not.toContain('qn_secret');
    expect(text).not.toContain('2026');
  });

  it('shows the newest notes, oldest-first within them, and counts the rest out loud', () => {
    const many = Array.from({ length: MAX_PROMPT_NOTES + 7 }, (_, i) =>
      note({ id: `qn_${i}`, text: `note ${i}`, createdAt: 1_756_000_000_000 + i }),
    );
    const text = notesPrompt(many, 'go');
    expect(text).toContain('…and 7 more.');
    // 27 notes, newest 20 kept — so note 7 is the first shown and note 26 the last, still in
    // age order. Note 0 is the stalest and is the one left out, which is the deliberate trade.
    expect(text).toContain('1. note 7');
    expect(text).toContain(`20. note ${MAX_PROMPT_NOTES + 6}`);
    expect(text).not.toContain('note 0\n');
  });

  it('works when the person sent only the shortcut', () => {
    expect(notesPrompt([note()], '   ')).toBe(
      '<osade_notes>\nOpen — things I noticed and told you to remember for later:\n1. fix the auth redirect loop\nIf this turn touches one of these, say so. If I ask what is outstanding, this is the list.\n</osade_notes>',
    );
  });
});

describe('stripNotesPrompt', () => {
  it('takes the block back out of a transcript line', () => {
    expect(
      visibleUserText(notesPrompt([note()], 'why is login looping?')),
    ).toBe('why is login looping?');
  });

  it('leaves a message with no notes untouched', () => {
    expect(visibleUserText('plain message')).toBe('plain message');
  });

  it('composes with the lanes and photos handling', () => {
    const sent = [
      '<osade_lanes>Other agents in this chat:\n- codex on x: implementing</osade_lanes>',
      notesPrompt([note()], 'look at this'),
    ].join('\n\n');
    expect(visibleUserText(sent)).toBe('look at this');
  });

  it('does not leave an empty bubble behind when notes were the whole message', () => {
    expect(stripNotesPrompt(notesPrompt([note()], ''))).toBe('');
  });
});

describe('partitionNotes', () => {
  it('splits open from resolved without losing any', () => {
    const notes = [
      note({ id: 'a' }),
      note({ id: 'b', resolvedAt: 1 }),
      note({ id: 'c' }),
      note({ id: 'd', resolvedAt: 2 }),
    ];
    const parts = partitionNotes(notes);
    expect(parts.open.map((n) => n.id)).toEqual(['a', 'c']);
    expect(parts.resolved.map((n) => n.id)).toEqual(['b', 'd']);
    expect(parts.open.length + parts.resolved.length).toBe(notes.length);
  });
});
