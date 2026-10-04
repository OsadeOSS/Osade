import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import type { IPty } from 'node-pty';

import { resolveBinaryOnPath } from './agent-catalog.js';
import { agentUnder, type AgentIdentity } from './agent-process.js';
import { ProcessTable } from './process-table.js';

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
  /** Output not yet read by the open view. */
  buf: string;
  /** Recent output, replayed when a view reattaches to a running shell. */
  history: string;
  alive: boolean;
}

const HISTORY_LIMIT = 256_000;

/** Keep the tail, cut at a line break so the replay does not start mid escape sequence. */
export function trimHistory(history: string, limit = HISTORY_LIMIT): string {
  if (history.length <= limit) return history;
  const tail = history.slice(-limit);
  const newline = tail.indexOf('\n');
  return newline === -1 ? tail : tail.slice(newline + 1);
}

/** How long output may sit unsaved; a crash loses at most this much. */
const SAVE_DELAY_MS = 1_000;

/**
 * Shown under output saved by an earlier daemon. Also leaves the alternate screen and resets
 * colours, in case the old output ended inside a full-screen program.
 */
const RESTORED_NOTE =
  '\r\n\x1b[0m\x1b[?1049l\x1b[?25h\x1b[2m── Osade restarted. Above is this terminal\'s earlier output; a new shell starts here. ──\x1b[0m\r\n';

/** Process scans are shared by every caller asking within this window. */
const AGENT_SCAN_MS = 1_500;

export interface TaskShellsOptions {
  /**
   * Where each shell's recent output is saved. A shell lives in the daemon, so it outlives the
   * window and a reopened tab simply reattaches; this only matters once the daemon itself has
   * restarted (reboot, upgrade). Off when absent, as in tests.
   */
  historyDir?: string;
}

export class TaskShells {
  readonly #sessions = new Map<string, Session>();
  readonly #historyDir: string | null;
  readonly #saveTimers = new Map<string, NodeJS.Timeout>();

  constructor(options: TaskShellsOptions = {}) {
    this.#historyDir = options.historyDir ?? null;
  }

  #historyFile(key: string): string | null {
    return this.#historyDir ? join(this.#historyDir, `${key.replace(/[^A-Za-z0-9_-]/g, '_')}.log`) : null;
  }

  #scheduleSave(key: string, session: Session): void {
    if (!this.#historyDir || this.#saveTimers.has(key)) return;
    this.#saveTimers.set(
      key,
      setTimeout(() => {
        this.#saveTimers.delete(key);
        const file = this.#historyFile(key)!;
        mkdirSync(this.#historyDir!, { recursive: true });
        void writeFile(file, session.history).catch(() => undefined);
      }, SAVE_DELAY_MS),
    );
  }

  /** Write now, synchronously — for shutdown, when a pending timer would never fire. */
  #flush(key: string, session: Session): void {
    const timer = this.#saveTimers.get(key);
    if (!timer) return;
    clearTimeout(timer);
    this.#saveTimers.delete(key);
    try {
      mkdirSync(this.#historyDir!, { recursive: true });
      writeFileSync(this.#historyFile(key)!, session.history);
    } catch {
      // Best effort: losing a second of scrollback must not block shutdown.
    }
  }

  #saved(key: string): string {
    const file = this.#historyFile(key);
    if (!file || !existsSync(file)) return '';
    try {
      return readFileSync(file, 'utf8');
    } catch {
      return '';
    }
  }
  readonly #processes = new ProcessTable();
  #agentScan: { at: number; result: Promise<Map<string, AgentIdentity>> } | null = null;

  /**
   * The coding agent running in each open shell, found by walking the shell's child processes —
   * so any agent started by hand (claude, kiro-cli, cline, …) is seen, whether or not it sets a
   * terminal title. Shells running no agent are absent.
   */
  agents(): Promise<Map<string, AgentIdentity>> {
    const now = Date.now();
    if (this.#agentScan && now - this.#agentScan.at < AGENT_SCAN_MS) return this.#agentScan.result;
    const roots = new Map<string, number>();
    for (const [id, session] of this.#sessions) if (session.alive) roots.set(id, session.child.pid);
    const result =
      roots.size === 0
        ? Promise.resolve(new Map<string, AgentIdentity>())
        : this.#processes.rowsUnder([...roots.values()]).then((rows) => {
            const found = new Map<string, AgentIdentity>();
            for (const [id, pid] of roots) {
              const agent = agentUnder(rows, pid);
              if (agent) found.set(id, agent);
            }
            return found;
          });
    this.#agentScan = { at: now, result };
    // A failed scan is not cached, so the next caller retries.
    result.catch(() => {
      if (this.#agentScan?.result === result) this.#agentScan = null;
    });
    return result;
  }

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
    // A shell from an earlier daemon is gone, but its output is not: show it above the new one.
    const saved = this.#saved(taskId);
    const history = saved.length > 0 ? trimHistory(saved + RESTORED_NOTE) : '';
    const session: Session = { cwd, child, buf: '', history, alive: true };
    child.onData((chunk) => {
      session.buf += chunk;
      if (session.buf.length > 200_000) session.buf = session.buf.slice(-100_000);
      session.history = trimHistory(session.history + chunk);
      this.#scheduleSave(taskId, session);
    });
    child.onExit(() => {
      this.#flush(taskId, session);
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

  /**
   * Everything recent, for a view that just (re)attached. Clears the unread buffer, since the
   * replay already contains it.
   */
  replay(taskId: string): string {
    const session = this.#sessions.get(taskId);
    if (!session) return '';
    session.buf = '';
    return session.history;
  }

  /** The tab was closed: end the shell and forget its saved output. */
  close(taskId: string): void {
    const timer = this.#saveTimers.get(taskId);
    if (timer) clearTimeout(timer);
    this.#saveTimers.delete(taskId);
    const file = this.#historyFile(taskId);
    if (file) rmSync(file, { force: true });
    this.#end(taskId);
  }

  #end(taskId: string): void {
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

  /** Daemon shutdown: end every shell but keep its output, so tabs come back with it. */
  closeAll(): void {
    for (const [id, session] of [...this.#sessions]) {
      this.#flush(id, session);
      this.#end(id);
    }
    this.#processes.dispose();
    this.#agentScan = null;
  }
}
