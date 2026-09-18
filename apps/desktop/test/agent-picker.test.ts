import { describe, expect, it } from 'vitest';

import { resolveNewChatAgent } from '../src/renderer/AgentPicker.js';

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
