import { describe, expect, it } from 'vitest';

import { readTitle, withProcess, withTitle, type TerminalAgent } from '../src/renderer/terminal-agent.js';

const kiro = { agent: 'kiro', name: 'Kiro' };
const claude = { agent: 'claude', name: 'Claude' };

function titles(start: TerminalAgent | null, list: string[]): TerminalAgent | null {
  return list.reduce<TerminalAgent | null>((state, title, i) => withTitle(state, title, 100 + i), start);
}

describe('readTitle', () => {
  it('reads status glyphs and strips them from the topic', () => {
    expect(readTitle('✳ Fix the sidebar')).toEqual({ signal: 'waiting', label: 'Fix the sidebar' });
    expect(readTitle('⠐ Fix the sidebar')).toEqual({ signal: 'working', label: 'Fix the sidebar' });
    expect(readTitle('◐ Fix')).toEqual({ signal: 'working', label: 'Fix' });
    expect(readTitle('✦ Gemini CLI')).toEqual({ signal: 'working', label: 'Gemini CLI' });
    expect(readTitle('✋ Gemini CLI').signal).toBe('attention');
    expect(readTitle('Kiro - refactor auth')).toEqual({ signal: null, label: 'Kiro - refactor auth' });
  });
});

describe('withProcess', () => {
  it('starts any agent the daemon finds as running, named for itself', () => {
    expect(withProcess(null, kiro, 5)).toEqual({ agent: 'kiro', name: 'Kiro', status: 'running', label: 'Kiro', since: 5 });
  });

  it('keeps state while the same agent runs, and drops it when none does', () => {
    const a = withProcess(null, kiro, 5);
    expect(withProcess(a, kiro, 9)).toBe(a);
    expect(withProcess(a, null, 9)).toBeNull();
    expect(withProcess(a, claude, 9)?.agent).toBe('claude');
  });
});

describe('withTitle', () => {
  const started = withProcess(null, claude, 1);

  it('never creates an agent from a title alone', () => {
    expect(withTitle(null, '✳ Claude Code', 2)).toBeNull();
  });

  it('follows Claude through a turn', () => {
    expect(titles(started, ['✳ Claude Code'])).toMatchObject({ status: 'running', label: 'Claude' });
    expect(titles(started, ['✳ Claude Code', '⠂ Fix the sidebar'])).toMatchObject({
      status: 'working',
      label: 'Fix the sidebar',
    });
    expect(titles(started, ['⠂ Fix the sidebar', '✳ Fix the sidebar'])).toMatchObject({
      status: 'done',
      label: 'Fix the sidebar',
    });
    expect(titles(started, ['⠂ Task', '✳ Claude Code'])).toMatchObject({ status: 'done', label: 'Task' });
  });

  it('takes a plain title as the topic for agents without glyphs, but not paths or shells', () => {
    const k = withProcess(null, kiro, 1);
    expect(withTitle(k, 'refactor auth', 2)).toMatchObject({ status: 'running', label: 'refactor auth' });
    expect(withTitle(k, 'C:\\Users\\me\\.local\\bin\\kiro-cli.exe', 2)).toBe(k);
    expect(withTitle(k, 'Windows PowerShell', 2)).toBe(k);
    expect(withTitle(k, 'kiro cli', 2)).toBe(k);
  });

  it('keeps `since` unless the status changes', () => {
    const working = withTitle(started, '⠂ A', 10)!;
    expect(withTitle(working, '⠄ B', 20)).toMatchObject({ label: 'B', since: 10 });
  });
});
