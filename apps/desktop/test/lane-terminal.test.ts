import { describe, expect, it } from 'vitest';

import {
  nextOpenedTerminal,
  retainLaneTerminal,
  terminalKeyAction,
  terminalSurfaceVisible,
} from '../src/renderer/lane-terminal.js';

describe('terminalSurfaceVisible', () => {
  it('is only the Chat tab’s Terminal chip', () => {
    expect(terminalSurfaceVisible('transcript', 'terminal')).toBe(true);
    expect(terminalSurfaceVisible('transcript', 'chat')).toBe(false);
    expect(terminalSurfaceVisible('files', 'terminal')).toBe(false);
    expect(terminalSurfaceVisible('diff', 'terminal')).toBe(false);
  });
});

describe('retainLaneTerminal', () => {
  it('keeps the host after Terminal was opened for this lane', () => {
    expect(retainLaneTerminal('task-1', 'task-1')).toBe(true);
  });

  it('does not keep a host for a different lane', () => {
    expect(retainLaneTerminal('task-1', 'task-2')).toBe(false);
    expect(retainLaneTerminal(null, 'task-1')).toBe(false);
  });
});

describe('nextOpenedTerminal', () => {
  it('remembers the lane when Terminal is opened', () => {
    expect(nextOpenedTerminal(null, 'task-1', 'terminal')).toBe('task-1');
  });

  it('stays remembered after switching back to chat', () => {
    expect(nextOpenedTerminal('task-1', 'task-1', 'chat')).toBe('task-1');
  });

  it('drops the host when the focused lane changes', () => {
    expect(nextOpenedTerminal('task-1', 'task-2', 'chat')).toBe(null);
  });
});

describe('terminalKeyAction', () => {
  it('treats Ctrl/Cmd+V as paste, not a control character', () => {
    expect(
      terminalKeyAction({ type: 'keydown', ctrlKey: true, metaKey: false, altKey: false, key: 'v' }),
    ).toBe('paste');
    expect(
      terminalKeyAction({ type: 'keydown', ctrlKey: false, metaKey: true, altKey: false, key: 'V' }),
    ).toBe('paste');
  });

  it('treats Ctrl/Cmd+C as copy so a selection is not sent as SIGINT', () => {
    expect(
      terminalKeyAction({ type: 'keydown', ctrlKey: true, metaKey: false, altKey: false, key: 'c' }),
    ).toBe('copy');
  });

  it('ignores keyup and unmodified typing', () => {
    expect(
      terminalKeyAction({ type: 'keyup', ctrlKey: true, metaKey: false, altKey: false, key: 'v' }),
    ).toBe(null);
    expect(
      terminalKeyAction({ type: 'keydown', ctrlKey: false, metaKey: false, altKey: false, key: 'v' }),
    ).toBe(null);
  });
});
