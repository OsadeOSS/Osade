import { describe, expect, it } from 'vitest';

import { filterEntries, resolveNewChatAgent } from '../src/renderer/AgentPicker.js';

describe('resolveNewChatAgent', () => {
  it('uses the modal pick first', () => {
    expect(resolveNewChatAgent('codex', 'opencode')).toBe('codex');
    expect(resolveNewChatAgent('codex', null)).toBe('codex');
  });

  it('falls back to the repo default', () => {
    expect(resolveNewChatAgent(null, 'opencode')).toBe('opencode');
  });

  it('falls back to claude when nothing was picked or configured', () => {
    expect(resolveNewChatAgent(null, null)).toBe('claude');
  });
});

describe('filterEntries', () => {
  const rows = [
    { label: 'New Terminal: PowerShell', id: 'powershell' },
    { label: 'New Terminal: CMD Prompt', id: 'cmd' },
    { label: 'Claude Code', id: 'claude' },
  ];

  it('keeps everything for an empty query', () => {
    expect(filterEntries(rows, '  ')).toEqual(rows);
  });

  it('matches labels case-insensitively', () => {
    expect(filterEntries(rows, 'power').map((r) => r.id)).toEqual(['powershell']);
  });

  it('matches extra search terms', () => {
    expect(filterEntries(rows, 'claude', (r) => [r.id]).map((r) => r.id)).toEqual(['claude']);
    expect(filterEntries(rows, 'terminal').map((r) => r.id)).toEqual(['powershell', 'cmd']);
  });
});
