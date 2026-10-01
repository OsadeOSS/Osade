import { spawn, type ChildProcess } from 'node:child_process';
import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';

import { runtimeEnv, substrateBinary } from './substrate.js';
import { githubToken } from '../secrets.js';
import { delimiter, dirname, join } from 'node:path';
import { daemonBuildId, healthMatchesBuild } from './daemon-build.js';

/**
 * Spawn and adopt the Osade daemon — OSADE.md §18.1.
 *
 * The daemon owns tasks, gates, verification and the GitHub poller, and it must survive the
 * window closing exactly as the substrate does: agents keep running, and half the system does not die
 * because someone closed a window.
 */

export function osadeRoot(): string {
  return process.env.OSADE_HOME ?? join(homedir(), '.osade');
}

function portFile(): string {
  return join(osadeRoot(), 'daemon.port');
}

async function health(port: number, timeoutMs = 1_500, build?: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // §2.1 — loopback only. There is no remote mode.
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return false;
    if (build == null) return true;
    return healthMatchesBuild(await res.json(), build);
  } catch {
    return false;
  }
}

function readPort(): number | null {
  try {
    const port = Number(readFileSync(portFile(), 'utf8').trim());
    return Number.isFinite(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

function pidFile(): string {
  return join(osadeRoot(), 'daemon.pid');
}

function readPid(): number | null {
  try {
    const pid = Number(readFileSync(pidFile(), 'utf8').trim());
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** Stops a daemon we spawned or adopted, so the next spawn can carry a new GitHub token. */
export async function stopDaemon(child: ChildProcess | null, lastPort?: number | null): Promise<void> {
  const pids = new Set<number>();
  if (child?.pid) pids.add(child.pid);
  const written = readPid();
  if (written) pids.add(written);
  for (const pid of pids) {
    try {
      process.kill(pid);
    } catch {
      // Already gone.
    }
  }
  const port = lastPort ?? readPort();
  if (port != null) {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (!(await health(port, 400))) break;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    if (await health(port, 400)) {
      throw new Error('the osade daemon did not stop');
    }
  }
  rmSync(portFile(), { force: true });
  rmSync(pidFile(), { force: true });
}

/**
 * How to actually run the daemon — three things the first live launch got wrong, each of which
 * surfaced as the same useless symptom: "the daemon did not become healthy within 30s".
 *
 * **The daemon runs on Node, not on Electron's Node.** `process.execPath` under Electron is
 * `electron.exe`, whose Node has its own native ABI (`NODE_MODULE_VERSION` 130 for Electron 33,
 * against 127 for Node 22). `better-sqlite3` is compiled once, for Node — and it has to be,
 * because the daemon also runs standalone under the CLI and the test suite. Running it under
 * Electron would demand a second, ABI-matched build of the same module and two ways to get it
 * wrong. §2 already treats the daemon as an independent process that outlives the window; this
 * makes the runtime match that.
 *
 * **`ELECTRON_RUN_AS_NODE` is the fallback, not the plan.** If no Node is found, `electron.exe`
 * at least behaves as a Node runtime rather than booting a second, invisible Electron app — but
 * native modules will still be wrong, so the failure is loud when it comes.
 *
 * **A `.ts` entry is not executable.** In a source checkout the daemon is TypeScript and Node
 * answers `ERR_UNKNOWN_FILE_EXTENSION`. A packaged build ships JavaScript and is spawned
 * directly; a checkout goes through the same dev runner every doc and test already uses.
 */
export function daemonCommand(entry: string): {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
} {
  const node = nodeBinary();
  // Read at the use site, never snapshotted (§20.1).
  const env = { ...process.env };
  if (node.isElectron) env.ELECTRON_RUN_AS_NODE = '1';

  const token = githubToken();
  if (token) env.OSADE_GITHUB_TOKEN = token;
  env.OSADE_DAEMON_BUILD = daemonBuildId(entry);

  // Point better-sqlite3 straight at its addon, packaged or not.
  //
  // The daemon is a *bundle*, so the resolver better-sqlite3 would otherwise use (`bindings`,
  // which walks upward looking for a `node_modules/better-sqlite3/build`) is searching from the
  // wrong place and with the wrong assumptions. Packaged, the addon sits beside the bundle; in a
  // checkout it is still in the package's own node_modules.
  const addon = sqliteAddon(entry);
  if (addon) env.OSADE_SQLITE_BINDING = addon;
  // The daemon's boot drift check spawns the runtime. A packaged machine has nothing on PATH,
  // so it is handed the binary Osade ships rather than left to search for one.
  env.OSADE_SUBSTRATE_BIN = substrateBinary();
  Object.assign(env, runtimeEnv());

  const args = entry.endsWith('.ts')
    ? // `--` separates vite-node's own arguments from the script's; without it `start` is eaten.
      [viteNodeCli(entry), entry, '--', 'start']
    : [entry, 'start'];

  return { command: node.command, args, env };
}

/** The better-sqlite3 addon: beside a packaged bundle, or in the package's node_modules. */
function sqliteAddon(entry: string): string | null {
  const beside = join(dirname(entry), 'better_sqlite3.node');
  if (existsSync(beside)) return beside;

  // A checkout: <repo>/packages/daemon/dist/cli.js -> the package's own node_modules.
  const inPackage = join(
    dirname(dirname(entry)),
    'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
  );
  return existsSync(inPackage) ? inPackage : null;
}

/**
 * A real `node`, or Electron pretending.
 *
 * `OSADE_NODE_BIN` overrides the search, which is what a packaged build will set once it ships
 * its own runtime.
 */
export function nodeBinary(): { command: string; isElectron: boolean } {
  const name = process.platform === 'win32' ? 'node.exe' : 'node';

  const explicit = process.env.OSADE_NODE_BIN;
  if (explicit && existsSync(explicit)) return { command: explicit, isElectron: false };

  // The runtime Osade ships, which is the one a packaged app must use: a user's machine need not
  // have Node at all, and if it does, it may be a version this daemon does not run on.
  for (const vendored of vendoredNodePaths(name)) {
    if (existsSync(vendored)) return { command: vendored, isElectron: false };
  }

  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (existsSync(candidate)) return { command: candidate, isElectron: false };
  }

  return { command: process.execPath, isElectron: true };
}

/**
 * Where the shipped Node sits, packaged and in a checkout.
 *
 * `process.resourcesPath` exists only in a packaged Electron app, which is why it is read
 * defensively rather than assumed.
 *
 * Exported for the test that pins the upward walk, because the bug this shape replaced was
 * invisible from the outside: it compiled, it linted, it worked in a packaged app, and it made
 * every developer on a source checkout fail to boot.
 */
export function vendoredNodePaths(name: string): string[] {
  const target = `${process.platform}-${process.arch}`;
  const paths: string[] = [];

  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resources) paths.push(join(resources, 'node', name));

  // A source checkout. **Walked up, not counted** — and the counting is what put this bug here.
  //
  // This file is `src/main/supervisor/daemon.ts`, so it compiles to `dist/main/supervisor/` and
  // the four `..` it was written for (a comment claiming `__dirname` was `dist/main`) landed on
  // `apps/` instead of the repo root. Nothing was found, `nodeBinary` fell through to PATH, and
  // the daemon booted on whatever Node the machine happened to have. On Node 24 that is ABI 137
  // and `better-sqlite3` — built for 127 — refuses to load, so the app spends 30 seconds waiting
  // for a daemon that was never going to become healthy and reports exactly that. A packaged app
  // never noticed, because `resourcesPath` above answers first.
  //
  // `viteNodeCli` below walks upward for the same reason and has always been right. Both now do
  // it the same way, so a future move of this file cannot reintroduce the count.
  let dir = __dirname;
  for (let up = 0; up < 8; up += 1) {
    paths.push(join(dir, 'vendor', 'node', target, name));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return paths;
}

/**
 * The dev runner's entry, found from the daemon entry rather than from `__dirname`.
 *
 * Resolving relative to this file would break the moment the main process is bundled; the
 * daemon entry is a real path inside the repo either way.
 */
function viteNodeCli(daemonEntry: string): string {
  let dir = dirname(daemonEntry);
  for (let up = 0; up < 8; up += 1) {
    const candidate = join(dir, 'node_modules', 'vite-node', 'dist', 'cli.mjs');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `cannot run the daemon from TypeScript: vite-node was not found above ${daemonEntry}. ` +
      `Build the daemon, or point OSADE_DAEMON_ENTRY at built JavaScript.`,
  );
}

/**
 * Where the daemon's output goes — `~/.osade/logs/daemon.log`.
 *
 * Not the parent's stdout. A packaged app on Windows is a GUI binary with **no console**, so
 * `stdio: 'inherit'` hands the child handles that are not there and the daemon dies on spawn
 * without saying anything — the app then waits out its 30-second health timeout and reports that
 * the daemon "did not become healthy", which is true and useless. That is what a packaged build
 * actually did.
 *
 * Inheriting was wrong even where it worked: a *detached* child holding the parent's stdout keeps
 * a terminal pipeline open long after the app exits, and §2.2 says everything Osade writes lives
 * under `~/.osade` anyway.
 */
export function daemonLogPath(): string {
  return join(osadeRoot(), 'logs', 'daemon.log');
}

function daemonLog(): number {
  mkdirSync(join(osadeRoot(), 'logs'), { recursive: true });
  return openSync(daemonLogPath(), 'a');
}

let daemonLogFollow: NodeJS.Timeout | null = null;

/**
 * Mirror new daemon.log lines to the Electron console.
 *
 * The child still owns a file fd (so a detached daemon survives the window). Piping stdout
 * into the parent would EPIPE that daemon on quit, and `stdio: 'inherit'` kills a packaged
 * Windows spawn. Tailing the log is the remaining way `pnpm start` can show launch failures.
 */
function followDaemonLog(onInfo: (message: string) => void): void {
  if (daemonLogFollow) {
    clearInterval(daemonLogFollow);
    daemonLogFollow = null;
  }
  const path = daemonLogPath();
  let offset = 0;
  try {
    offset = statSync(path).size;
  } catch {
    offset = 0;
  }
  let pending = '';
  const tick = (): void => {
    let fd: number;
    try {
      fd = openSync(path, 'r');
    } catch {
      return;
    }
    try {
      const size = fstatSync(fd).size;
      if (size < offset) offset = 0;
      if (size <= offset) return;
      const buf = Buffer.alloc(size - offset);
      const n = readSync(fd, buf, 0, buf.length, offset);
      offset += n;
      pending += buf.toString('utf8', 0, n);
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trimEnd();
        if (trimmed.length > 0) onInfo(trimmed);
      }
    } finally {
      closeSync(fd);
    }
  };
  daemonLogFollow = setInterval(tick, 250) as unknown as NodeJS.Timeout;
  daemonLogFollow.unref();
}

export interface DaemonSupervisorOptions {
  /** Node entry for the daemon CLI. */
  entry: string;
  onInfo?: (message: string) => void;
}

export interface AdoptedDaemon {
  port: number;
  child: ChildProcess | null;
}

/**
 * Adopts a healthy daemon, or spawns one and waits for its ready handshake.
 *
 * The handshake is the port file plus a `/health` round trip — **never a fixed sleep** (§18.1).
 * A stale port file from a crashed daemon is removed rather than trusted.
 * A healthy daemon from a different `cli.js` is also stale: that is how `taskShellOpen` 404s.
 */
export async function adoptOrSpawnDaemon(
  options: DaemonSupervisorOptions,
): Promise<AdoptedDaemon> {
  const onInfo = options.onInfo ?? (() => {});
  followDaemonLog(onInfo);
  const build = daemonBuildId(options.entry);

  const existing = readPort();
  if (existing != null && (await health(existing, 1_500, build))) {
    onInfo(`adopted the running osade daemon on 127.0.0.1:${existing}`);
    return { port: existing, child: null };
  }
  const stalePid = readPid();
  if (existing != null || stalePid != null) {
    onInfo('stopping a stale osade daemon before spawn');
    await stopDaemon(null, existing);
  }

  const { command, args, env } = daemonCommand(options.entry);
  const log = daemonLog();
  const child = spawn(command, args, {
    env,
    stdio: ['ignore', log, log],
    detached: true,
    windowsHide: true,
  });
  child.unref();

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const port = readPort();
    if (port != null && (await health(port, 1_500, build))) {
      onInfo(`spawned the osade daemon on 127.0.0.1:${port}`);
      return { port, child };
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error('the osade daemon did not become healthy within 30s');
}
