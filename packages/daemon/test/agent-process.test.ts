import { describe, expect, it } from 'vitest';

import { agentUnder, recognizeAgent, tokenize, type ProcessRow } from '../src/domain/agent-process.js';

describe('recognizeAgent', () => {
  it('knows native agents by executable', () => {
    expect(
      recognizeAgent(
        'claude.exe',
        '"C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"',
      )?.id,
    ).toBe('claude');
    expect(recognizeAgent('kiro-cli', null)?.id).toBe('kiro');
    expect(recognizeAgent('codex-x86_64-pc-windows-msvc.exe', null)?.id).toBe('codex');
    expect(recognizeAgent('agy.exe', null)?.id).toBe('antigravity');
    expect(recognizeAgent('/usr/local/bin/goose', null)?.id).toBe('goose');
  });

  it('knows Node agents by the script they run', () => {
    expect(
      recognizeAgent('node.exe', '"C:\\Program Files\\nodejs\\node.exe" C:\\Users\\me\\AppData\\Roaming\\npm/node_modules/cline/bin/cline')?.id,
    ).toBe('cline');
    expect(
      recognizeAgent('node', 'node /usr/lib/node_modules/@google/gemini-cli/dist/index.js --yolo')?.id,
    ).toBe('gemini');
    expect(recognizeAgent('node', 'node --no-warnings /x/node_modules/freebuff/dist/index.js')?.id).toBe('freebuff');
    expect(recognizeAgent('node', 'node /x/node_modules/@openai/codex/bin/codex.js')?.id).toBe('codex');
  });

  it('knows Python agents by module or script', () => {
    expect(recognizeAgent('python3', 'python3 -m aider')?.id).toBe('aider');
    expect(recognizeAgent('python.exe', 'python.exe C:\\venv\\Scripts\\aider.py')?.id).toBe('aider');
  });

  it('does not read past the script, and ignores unrelated programs', () => {
    expect(recognizeAgent('node', 'node build.js --label claude')).toBeNull();
    expect(recognizeAgent('node', 'node /x/node_modules/@truefoundry/trueforge/dist/cli.js')).toBeNull();
    expect(recognizeAgent('node.exe', null)).toBeNull();
    expect(recognizeAgent('git.exe', null)).toBeNull();
    expect(recognizeAgent('powershell.exe', null)).toBeNull();
  });
});

describe('tokenize', () => {
  it('keeps quoted paths whole', () => {
    expect(tokenize('"C:\\Program Files\\nodejs\\node.exe" a "b c"')).toEqual([
      'C:\\Program Files\\nodejs\\node.exe',
      'a',
      'b c',
    ]);
  });
});

describe('agentUnder', () => {
  const rows: ProcessRow[] = [
    { pid: 10, ppid: 1, name: 'powershell.exe', command: null },
    { pid: 11, ppid: 10, name: 'cmd.exe', command: null },
    { pid: 12, ppid: 11, name: 'node.exe', command: 'node C:/npm/node_modules/@google/gemini-cli/dist/index.js' },
    { pid: 13, ppid: 12, name: 'claude.exe', command: null },
    { pid: 20, ppid: 1, name: 'powershell.exe', command: null },
    { pid: 21, ppid: 20, name: 'git.exe', command: null },
  ];

  it('finds the agent nearest the shell through launcher shims', () => {
    expect(agentUnder(rows, 10)?.id).toBe('gemini');
  });

  it('is null for a shell running no agent', () => {
    expect(agentUnder(rows, 20)).toBeNull();
    expect(agentUnder(rows, 99)).toBeNull();
  });
});
