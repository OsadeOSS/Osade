import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import type { IPty } from 'node-pty';

import { resolveBinaryOnPath } from './agent-catalog.js';

/**
 * A real PTY in the lane's cwd — PowerShell on Windows, $SHELL elsewhere.
 *
 * Pipes are not a TTY: backspace, cls, and CLIs like Claude all fail. This is not the agent's
 * substrate pane. Killing the shell does not touch the agent.
 */

const pty = createRequire(import.meta.url)('node-pty') as typeof import('node-pty');

export function defaultShell(): { command: string; args: string[] } {
  if (process.platform === 'win32') {
    return { command: 'powershell.exe', args: ['-NoLogo'] };
  }
  return { command: process.env.SHELL || '/bin/bash', args: ['-i'] };
}

/** Which shell a standalone terminal runs. `default` is PowerShell on Windows, $SHELL elsewhere. */
export type ShellKind = 'default' | 'powershell' | 'cmd' | 'gitbash';

export interface ShellOption {
  kind: ShellKind;
  label: string;
}

/**
 * Git for Windows' bash.exe — not whatever `bash` is on PATH, which on Windows is usually the
 * WSL launcher in System32 and drops you into Linux instead of the repo.
 */
export function findGitBash(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates: string[] = [];
  const git = resolveBinaryOnPath('git', env);
  // <Git>\cmd\git.exe or <Git>\bin\git.exe → <Git>\bin\bash.exe
  if (git) candidates.push(join(dirname(dirname(git)), 'bin', 'bash.exe'));
  for (const root of [env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432]) {
    if (root) candidates.push(join(root, 'Git', 'bin', 'bash.exe'));
  }
  if (env.LOCALAPPDATA) candidates.push(join(env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'));
  return candidates.find((path) => existsSync(path)) ?? null;
}

/** The shells this machine can open, in menu order. */
export function availableShells(): ShellOption[] {
  if (process.platform !== 'win32') {
    const name = (process.env.SHELL || '/bin/bash').split('/').pop() || 'Shell';
    return [{ kind: 'default', label: name }];
  }
  const shells: ShellOption[] = [
    { kind: 'powershell', label: 'PowerShell' },
    { kind: 'cmd', label: 'CMD Prompt' },
  ];
  if (findGitBash()) shells.push({ kind: 'gitbash', label: 'Git Bash' });
  return shells;
}

export function shellCommand(kind: ShellKind): { command: string; args: string[] } {
  if (process.platform !== 'win32') return defaultShell();
  switch (kind) {
    case 'cmd':
      return { command: process.env.ComSpec || 'cmd.exe', args: [] };
    case 'gitbash': {
      const bash = findGitBash();
      if (!bash) throw new Error('Git Bash is not installed');
      return { command: bash, args: ['--login', '-i'] };
    }
    default:
      return defaultShell();
  }
}

function shellEnv(): { [key: string]: string | undefined } {
  const extra: string[] = [];
  if (process.platform === 'win32') {
    const npm = join(homedir(), 'AppData', 'Roaming', 'npm');
    if (existsSync(npm)) extra.push(npm);
  }
  const pathKey = extra.length > 0 ? (process.env.Path != null ? 'Path' : 'PATH') : null;
  const current = process.env.Path ?? process.env.PATH ?? '';
  return {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    ...(pathKey ? { [pathKey]: extra.join(delimiter) + delimiter + current } : {}),
  };
}

export interface PtySize {
  cols: number;
  rows: number;
}

interface Session {
  cwd: string;
  child: IPty;
  buf: string;
  alive: boolean;
}

export class TaskShells {
  readonly #sessions = new Map<string, Session>();

  /** Start (or reuse) the shell for this task. Returns the cwd it is running in. */
  open(taskId: string, cwd: string, size?: PtySize, kind: ShellKind = 'default'): string {
    const existing = this.#sessions.get(taskId);
    if (existing?.alive) {
      if (size) existing.child.resize(size.cols, size.rows);
      return existing.cwd;
    }
    if (existing) this.close(taskId);

    const { command, args } = shellCommand(kind);
    const cols = size?.cols ?? 80;
    const rows = size?.rows ?? 24;
    const child = pty.spawn(command, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      // A Git Bash login shell cd's to $HOME unless told it was opened "here".
      env: kind === 'gitbash' ? { ...shellEnv(), CHERE_INVOKING: '1' } : shellEnv(),
      ...(process.platform === 'win32' ? { useConpty: true, useConptyDll: true } : {}),
    });
    const session: Session = { cwd, child, buf: '', alive: true };
    child.onData((chunk) => {
      session.buf += chunk;
      if (session.buf.length > 200_000) session.buf = session.buf.slice(-100_000);
    });
    child.onExit(() => {
      session.alive = false;
      if (this.#sessions.get(taskId)?.child === child) this.#sessions.delete(taskId);
    });
    this.#sessions.set(taskId, session);
    return cwd;
  }

  resize(taskId: string, size: PtySize): void {
    const session = this.#sessions.get(taskId);
    if (!session?.alive) return;
    session.child.resize(size.cols, size.rows);
  }

  write(taskId: string, data: string): void {
    const session = this.#sessions.get(taskId);
    if (!session?.alive) {
      throw new Error('no shell is open for this lane');
    }
    session.child.write(data);
  }

  read(taskId: string): string {
    const session = this.#sessions.get(taskId);
    if (!session) return '';
    const out = session.buf;
    session.buf = '';
    return out;
  }

  close(taskId: string): void {
    const session = this.#sessions.get(taskId);
    if (!session) return;
    this.#sessions.delete(taskId);
    session.alive = false;
    try {
      session.child.write('exit\r');
    } catch {
      // already gone
    }
    try {
      process.kill(session.child.pid);
    } catch {
      // already gone
    }
  }

  closeAll(): void {
    for (const id of [...this.#sessions.keys()]) this.close(id);
  }
}
