import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { availableShells, defaultShell, TaskShells } from '../../src/domain/task-shell.js';

let dir: string;
let shells: TaskShells;

afterEach(() => {
  shells?.closeAll();
  if (dir) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 80 });
    } catch {
      // Windows keeps a just-killed powershell cwd locked; the temp sweeper takes it.
    }
  }
});

async function waitFor(needle: string, timeoutMs = 8_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let seen = '';
  while (Date.now() < deadline) {
    seen += shells.read('t1');
    if (seen.includes(needle)) return seen;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for ${JSON.stringify(needle)}; got ${JSON.stringify(seen)}`);
}

describe('TaskShells', () => {
  it('opens a real shell in the worktree and echoes a command', async () => {
    dir = mkdtempSync(join(tmpdir(), 'osade-shell-'));
    shells = new TaskShells();
    shells.open('t1', dir);
    shells.write('t1', 'echo OSADE_SHELL_OK\r');
    const out = await waitFor('OSADE_SHELL_OK');
    expect(out).toContain('OSADE_SHELL_OK');
  });

  it('is a tty so backspace, cls, and interactive CLIs work', async () => {
    dir = mkdtempSync(join(tmpdir(), 'osade-shell-'));
    shells = new TaskShells();
    shells.open('t1', dir, { cols: 80, rows: 24 });
    // Split the marker so a command echo cannot satisfy waitFor.
    if (process.platform === 'win32') {
      shells.write(
        't1',
        "$m='OSADE'+'_PTY_'+'OK'; if (-not [console]::IsOutputRedirected) { $m }\r",
      );
    } else {
      shells.write('t1', 'test -t 1 && printf %s%s%s OSADE _PTY_ OK\r');
    }
    const out = await waitFor('OSADE_PTY_OK');
    expect(out).toContain('OSADE_PTY_OK');
  });

  it('picks powershell on Windows and a login shell elsewhere', () => {
    const shell = defaultShell();
    if (process.platform === 'win32') {
      expect(shell.command.toLowerCase()).toContain('powershell');
    } else {
      expect(shell.command.length).toBeGreaterThan(0);
    }
  });

  it('open is idempotent for the same task', () => {
    dir = mkdtempSync(join(tmpdir(), 'osade-shell-'));
    shells = new TaskShells();
    shells.open('t1', dir);
    expect(shells.open('t1', dir)).toBe(dir);
  });

  it('offers PowerShell and CMD on Windows, and one login shell elsewhere', () => {
    const kinds = availableShells().map((s) => s.kind);
    if (process.platform === 'win32') {
      expect(kinds.slice(0, 2)).toEqual(['powershell', 'cmd']);
    } else {
      expect(kinds).toEqual(['default']);
    }
  });

  it('opens the picked shell', async () => {
    dir = mkdtempSync(join(tmpdir(), 'osade-shell-'));
    shells = new TaskShells();
    const kind = process.platform === 'win32' ? 'cmd' : 'default';
    shells.open('t1', dir, { cols: 80, rows: 24 }, kind);
    // cmd's caret escape (and printf's split) keep the echoed command line from satisfying waitFor.
    shells.write('t1', process.platform === 'win32' ? 'echo OSADE_CMD^_OK\r' : 'printf %s%s OSADE_CMD _OK\r');
    const out = await waitFor('OSADE_CMD_OK');
    expect(out).toContain('OSADE_CMD_OK');
  });
});

