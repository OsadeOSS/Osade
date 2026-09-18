import { spawn, type SpawnOptions } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Io } from './cli.js';

/**
 * `osade .` — open the window on the repository you are standing in.
 *
 * The shape people already know from `code .`. The CLI does **not** talk to the daemon first:
 * that would hold the console until a server answered, and it would fail when the window is
 * closed even though agents (and the daemon) are still running. Launch the app, return, and let
 * the window adopt-or-spawn the daemon the way §18.1 already specifies.
 *
 * The daemon still resolves the path to the repository *root*, so this works from any
 * subdirectory. A second invocation re-scopes the window you already have — Electron's
 * single-instance lock, not a second process.
 */

export interface AppLaunch {
  command: string;
  args: string[];
  cwd?: string;
}

export type SpawnApp = (launch: AppLaunch, repoPath: string) => void;

export interface OpenHooks {
  spawnApp?: SpawnApp;
  findApp?: () => AppLaunch | null;
}

/**
 * Is this argument a path rather than a command?
 *
 * Deliberately narrow. `osade task` must never be read as "open the ./task directory", so a bare
 * word is only treated as a path when a directory of that name actually exists *and* it is not a
 * command name. `.`, `..`, anything with a slash, and anything absolute are unambiguous.
 */
export function looksLikePath(arg: string, commands: readonly string[]): boolean {
  if (arg === '.' || arg === '..') return true;
  if (arg.startsWith('~')) return true;
  if (/^[/\\]/.test(arg) || /^[A-Za-z]:[/\\]/.test(arg)) return true;
  if (arg.includes('/') || arg.includes('\\')) return true;
  if (commands.includes(arg)) return false;

  try {
    return statSync(resolve(arg)).isDirectory();
  } catch {
    return false;
  }
}

export async function openRepo(pathArg: string, io: Io, hooks: OpenHooks = {}): Promise<number> {
  const target = resolve(pathArg.startsWith('~') ? expandHome(pathArg) : pathArg);

  if (!existsSync(target)) {
    io.err(`${target} does not exist.\n`);
    return 2;
  }

  const app = (hooks.findApp ?? findApp)();
  if (!app) {
    io.err(
      'could not find the Osade app to open.\n' +
        '  from a source checkout run: node scripts/install-cli.mjs\n' +
        '  or set OSADE_APP_BIN to the app, then try again.\n',
    );
    return 1;
  }

  (hooks.spawnApp ?? spawnDetached)(app, target);
  return 0;
}

export function spawnDetached(app: AppLaunch, repoPath: string): void {
  // `--repo=<path>` as one token: Electron rewrites the argv it hands a second instance, and a
  // two-token flag loses its value there.
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  const options: SpawnOptions = {
    detached: true,
    stdio: 'ignore',
    // A new console on Windows would be a second window. Hide it; Electron's own frame is the UI.
    windowsHide: true,
    env,
    ...(app.cwd ? { cwd: app.cwd } : {}),
  };

  const child = spawn(app.command, [...app.args, `--repo=${repoPath}`], options);
  child.unref();
}

function expandHome(path: string): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  return home ? path.replace(/^~/, home) : path;
}

/**
 * Where the app is.
 *
 * `OSADE_APP_BIN` wins, then the packaged layout, then a source checkout. A checkout needs
 * electron and the built main, which is why it is last: it is the only one that can be
 * half-present.
 */
export function findApp(): AppLaunch | null {
  const explicit = process.env.OSADE_APP_BIN;
  if (explicit && existsSync(explicit)) return { command: explicit, args: [] };

  const here = dirname(fileURLToPath(import.meta.url));

  // Packaged: this file runs from <root>/resources/cli/bin.js, and the executable sits at the
  // root beside `resources`.
  const packagedRoot = resolve(here, '..', '..');
  for (const name of ['Osade.exe', 'Osade', 'osade']) {
    const candidate = join(packagedRoot, name);
    if (existsSync(candidate)) return { command: candidate, args: [] };
  }

  // A source checkout: <repo>/packages/cli/{src,dist} → repo root.
  const repoRoot = resolve(here, '..', '..', '..');
  const appDir = join(repoRoot, 'apps', 'desktop');
  if (!existsSync(join(appDir, 'dist', 'main', 'electron.js'))) return null;

  const electron = electronBinary(appDir, repoRoot);
  return electron ? { command: electron, args: [appDir], cwd: appDir } : null;
}

/**
 * Electron's binary, through the package that declares it.
 *
 * `apps/desktop/node_modules/electron` rather than anything under `.pnpm`: the store's internal
 * layout is pnpm's business and has changed before, while the package's own node_modules entry is
 * the documented way to find it and is a symlink to whatever the store currently does.
 */
function electronBinary(appDir: string, repoRoot: string): string | null {
  const name = process.platform === 'win32' ? 'electron.exe' : 'electron';
  for (const dir of [appDir, repoRoot]) {
    const local = join(dir, 'node_modules', 'electron', 'dist', name);
    if (existsSync(local)) return local;
  }
  return null;
}
