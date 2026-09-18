import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  shell,
  type OpenDialogOptions,
} from 'electron';
import type { ChildProcess } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * OSADE.md §2.2 — INVARIANT: state containment.
 *
 * `app.setPath('userData', ...)` runs **before anything else touches disk** and before
 * `app.whenReady()`. No `~/Library/Application Support`, no `%APPDATA%`, ever: the whole
 * system must be resettable with `rm -rf ~/.osade`.
 *
 * This is the first executable statement in the app for that reason. Do not move it.
 */
// `resolve`, not the raw value: Electron's setPath rejects a relative path with a bare
// "Path must be absolute" thrown before any of this file's logging exists, which is a hard
// thing to diagnose from the outside. A relative OSADE_HOME is a reasonable thing to type.
const OSADE_ROOT = resolve(process.env.OSADE_HOME ?? join(homedir(), '.osade'));
app.setPath('userData', join(OSADE_ROOT, 'electron'));
app.setPath('sessionData', join(OSADE_ROOT, 'electron', 'session'));
app.setAppUserModelId('dev.osade.app');

import { repoFromArgv } from './argv.js';
import {
  beginDeviceFlow,
  githubClientId,
  githubLogin as githubUser,
  pollDeviceFlow,
  tokenFromGh,
} from './oauth.js';
import { githubToken, setGithubToken } from './secrets.js';
import { adoptOrSpawnDaemon, stopDaemon } from './supervisor/daemon.js';
import {
  clampZoomLevel,
  levelFromFactor,
  parseZoomLevel,
  zoomActionFromInput,
  zoomFactor,
} from './zoom.js';
import {
  adoptOrSpawnSubstrate,
  OSADE_SESSION,
  runtimeEnv,
  substrateBinary,
} from './supervisor/substrate.js';

/**
 * The app's own log — `~/.osade/logs/app.log`.
 *
 * A packaged app on Windows is a GUI binary with no console, so `console.log` goes nowhere and a
 * boot that hangs is indistinguishable from a boot that is slow. Everything the main process says
 * is teed to a file as well, under `~/.osade` like everything else (§2.2).
 */
function say(message: string): void {
  console.log(message);
  try {
    const dir = join(OSADE_ROOT, 'logs');
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'app.log'), `${new Date().toISOString()} ${message}\n`);
  } catch {
    // A log that cannot be written must not take the app down with it.
  }
}

let window: BrowserWindow | null = null;
let daemonPort: number | null = null;
/** Non-null only when *this* process started the daemon. §18.1 — an adopted one is not ours. */
let spawnedDaemon: ChildProcess | null = null;
/** The repository this window is scoped to — `osade .`'s argument. */
let openedRepo: string | null = null;

const ZOOM_PATH = join(OSADE_ROOT, 'ui-zoom');

function readZoomLevel(): number {
  try {
    return parseZoomLevel(readFileSync(ZOOM_PATH, 'utf8'));
  } catch {
    return 0;
  }
}

function writeZoomLevel(level: number): void {
  try {
    mkdirSync(OSADE_ROOT, { recursive: true });
    writeFileSync(ZOOM_PATH, `${clampZoomLevel(level)}\n`);
  } catch {
    // Persistence is convenience. A failed write must not take zoom down with it.
  }
}

function currentZoomLevel(): number {
  if (window && !window.isDestroyed()) {
    return levelFromFactor(window.webContents.getZoomFactor());
  }
  return readZoomLevel();
}

function applyZoom(level: number): void {
  const next = clampZoomLevel(level);
  writeZoomLevel(next);
  if (window && !window.isDestroyed()) {
    window.webContents.setZoomFactor(zoomFactor(next));
  }
}

function bumpZoom(delta: number): number {
  applyZoom(currentZoomLevel() + delta);
  return currentZoomLevel();
}

/**
 * One window, re-scoped — not one window per repository.
 *
 * `osade .` in a second repository should bring the window you already have to the front and
 * point it at the new repo, the way `code .` does. Without the lock, the second invocation gets
 * its own process, which then finds the daemon already running, adopts it, and leaves two windows
 * arguing over the same ledger.
 */
if (!app.requestSingleInstanceLock()) {
  // `app.exit`, not `app.quit`. Quit is asynchronous, so `whenReady` still fires and the losing
  // instance boots far enough to adopt the substrate and open a daemon connection before it dies —
  // observed doing exactly that. Exit stops here.
  app.exit(0);
} else {
  app.on('second-instance', (_event, argv) => {
    // Wrapped, because this runs on an event emitted from Electron's own message loop: an
    // exception thrown here is uncaught in main, and an uncaught exception in a packaged GUI app
    // is an app that vanishes with nothing written down. A failed re-scope should cost you the
    // re-scope, not the window you already had.
    try {
      const repo = repoFromArgv(argv);
      if (repo) {
        openedRepo = repo;
        say(`re-scoping to ${repo}`);
        if (window && !window.isDestroyed()) {
          window.webContents.send('osade:repo-opened', repo);
        }
      }
      if (window && !window.isDestroyed()) {
        window.show();
        if (window.isMinimized()) window.restore();
        window.focus();
      }
      app.focus({ steal: true });
    } catch (err) {
      say(`re-scope failed: ${(err as Error).message}`);
    }
  });
}

/**
 * Startup order, and it matters (§18.1):
 *   1. userData redirect (above, before this runs)
 *   2. boot drift check — owned by the daemon, which refuses to start on a mismatch
 *   3. adopt-or-spawn the substrate on the `osade` session; wait for ping
 *   4. spawn the daemon; wait for its ready handshake, never a fixed sleep
 *   5. create the window
 *
 * There is no surface port in M0: the embedded terminal is deferred (§4.4, ADR 0001).
 */
async function boot(): Promise<void> {
  openedRepo = repoFromArgv(process.argv);
  if (openedRepo) say(`boot: opening on ${openedRepo}`);

  say('boot: adopting or spawning the substrate');
  await adoptOrSpawnSubstrate({ onInfo: (m) => say(`[substrate] ${m}`) });

  const entry = process.env.OSADE_DAEMON_ENTRY ?? daemonEntry();
  say(`boot: daemon entry ${entry}`);
  const daemon = await adoptOrSpawnDaemon({ entry, onInfo: (m) => say(`[daemon] ${m}`) });
  daemonPort = daemon.port;
  spawnedDaemon = daemon.child;

  say('boot: creating the window');
  createWindow();
}

/**
 * The daemon to run: built JavaScript when it exists, TypeScript source otherwise.
 *
 * Built wins because it is what a packaged app has and what plain node can execute. Source is
 * the fallback so a fresh checkout works before anyone has run `pnpm build` — the supervisor
 * routes that through the dev runner. `OSADE_DAEMON_ENTRY` overrides both.
 */
function daemonEntry(): string {
  // Packaged: extraResources put the daemon beside its addon. `resourcesPath` exists only in a
  // packaged app, so it is read defensively rather than assumed.
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resources) {
    const packaged = join(resources, 'daemon', 'cli.js');
    if (existsSync(packaged)) return packaged;
  }

  const repo = join(__dirname, '../../../..');
  const built = join(repo, 'packages/daemon/dist/cli.js');
  return existsSync(built) ? built : join(repo, 'packages/daemon/src/cli.ts');
}

function windowIcon(): string | undefined {
  const fromRepo = join(__dirname, '../../../..', 'assets', 'osade.png');
  if (existsSync(fromRepo)) return fromRepo;
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resources) {
    const packaged = join(resources, 'osade.png');
    if (existsSync(packaged)) return packaged;
  }
  return undefined;
}

function createWindow(): void {
  // §19.2 ships light and dark as peers, which is only true if both get looked at. A smoke run
  // can pin one; left alone, the app follows the machine.
  const theme = process.env.OSADE_SMOKE_THEME;
  if (theme === 'light' || theme === 'dark') nativeTheme.themeSource = theme;

  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    center: true,
    // Match --bg-0 so the frame does not flash light before the page paints.
    backgroundColor: '#0F1214',
    icon: windowIcon(),
    title: 'Osade',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // External links open in the user's browser, never inside the app frame.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  const rendererUrl = process.env.OSADE_RENDERER_URL;
  if (rendererUrl) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // Why the window went away, in the log. Without these, a renderer that dies takes the app with
  // it through `window-all-closed` and leaves an app.log whose last line is "creating the window"
  // — which reads exactly like a hang.
  window.webContents.on('did-fail-load', (_event, code, description, url) =>
    say(`renderer failed to load: ${description} (${code}) ${url}`),
  );
  window.webContents.on('did-finish-load', () => {
    say('renderer loaded');
    applyZoom(readZoomLevel());
    window?.show();
    window?.focus();
  });
  void window.webContents.setVisualZoomLevelLimits(1, 1);
  window.webContents.on('before-input-event', (event, input) => {
    const action = zoomActionFromInput(input);
    if (action == null) return;
    event.preventDefault();
    if (action === 'reset') applyZoom(0);
    else bumpZoom(action === 'in' ? 1 : -1);
  });
  window.on('close', () => {
    if (window && !window.isDestroyed()) writeZoomLevel(currentZoomLevel());
  });
  window.webContents.on('render-process-gone', (_event, details) =>
    say(`renderer gone: ${details.reason}${details.exitCode ? ` (exit ${details.exitCode})` : ''}`),
  );
  window.on('unresponsive', () => say('the window stopped responding'));
  window.on('closed', () => {
    say('the window closed');
    window = null;
  });

  void runSmokeShot(window);
}

/** Where a smoke run should write its screenshot, if this is one. */
function smokeShotPath(): string | undefined {
  return process.env.OSADE_SMOKE_SHOT;
}

/**
 * Boot, photograph the window, quit.
 *
 * The renderer is the one part of Osade a test suite cannot see: everything else is asserted by
 * `pnpm check`, while the window is only ever verified by a human looking at it. This makes
 * "does it actually render against a live daemon" a command that leaves evidence behind, which
 * is the difference between the app being checked occasionally and being checked at all.
 *
 * Off unless `OSADE_SMOKE_SHOT` names a file. It is a capture, not a mode — nothing about the
 * boot sequence changes, so what it photographs is the real thing.
 */
async function runSmokeShot(target: BrowserWindow): Promise<void> {
  const path = smokeShotPath();
  if (!path) return;

  let failed = false;
  const failures: string[] = [];
  target.webContents.on('console-message', (_event, level, message) => {
    // Errors only. A renderer that logged a warning still rendered.
    if (level >= 2) failures.push(message);
  });
  target.webContents.on('render-process-gone', (_event, details) =>
    failures.push(`render process gone: ${details.reason}`),
  );

  try {
    await new Promise<void>((resolve, reject) => {
      target.webContents.once('did-finish-load', () => resolve());
      target.webContents.once('did-fail-load', (_event, code, description) =>
        reject(new Error(`the renderer failed to load: ${description} (${code})`)),
      );
    });

    // A moment past load, so React has mounted rather than being caught mid-paint.
    await new Promise((resolve) => setTimeout(resolve, 2_000));

    // `OSADE_SMOKE_CLICK` opens something before the photograph. The detail panels — gates, the
    // verification plan, the PR flow, conventions — are only reachable by selecting a row, so
    // without this the only thing a smoke run can ever see is the ledger.
    const clickSelector = process.env.OSADE_SMOKE_CLICK;
    if (clickSelector) {
      const clicked = await target.webContents.executeJavaScript(
        `(() => { const el = document.querySelector(${JSON.stringify(clickSelector)});
                  if (!el) return false; el.click(); return true; })()`,
      );
      if (!clicked) throw new Error(`nothing matched ${clickSelector}`);
      await new Promise((resolve) => setTimeout(resolve, 1_500));
    }

    // `OSADE_SMOKE_EXPECT` turns the screenshot into a check. A picture proves the window is not
    // blank; it proves nothing about a panel that quietly stopped rendering, because the only
    // thing that would notice is a person who happened to look carefully.
    //
    // Each `|`-separated phrase must be **visible**, not merely present. `innerText` reports text
    // that is scrolled out of view, clipped to nothing, or sitting outside the window, so a
    // check against it passes for a panel that rendered somewhere nobody can see — which is the
    // failure this was supposed to catch.
    const expected = (process.env.OSADE_SMOKE_EXPECT ?? '').split('|').filter(Boolean);
    if (expected.length > 0) {
      const problems = (await target.webContents.executeJavaScript(
        `(() => {
          const wanted = ${JSON.stringify(expected)};
          const problems = [];

          // Nothing should need a horizontal scrollbar: the layout is two panes and neither is
          // allowed to push the other off the edge.
          if (document.documentElement.scrollWidth > window.innerWidth + 1) {
            problems.push('the page scrolls horizontally (' +
              document.documentElement.scrollWidth + 'px in a ' + window.innerWidth + 'px window)');
          }

          for (const phrase of wanted) {
            // The deepest element containing the phrase — the one actually laying it out.
            let host = null;
            for (const el of document.querySelectorAll('body *')) {
              if (el.textContent && el.textContent.includes(phrase)) host = el;
            }
            if (!host) { problems.push('absent: ' + phrase); continue; }

            const style = getComputedStyle(host);
            if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') {
              problems.push('present but not visible: ' + phrase);
              continue;
            }

            // Laid out *reachably*, which is not the same as currently on screen. The detail
            // pane scrolls, so content below the fold is the design working, not a fault. What
            // is a fault is content with no size, or pushed outside the document's own width
            // where no amount of scrolling reaches it.
            const r = host.getBoundingClientRect();
            if (r.width < 1 || r.height < 1) {
              problems.push('collapsed to nothing: ' + phrase);
            } else if (r.left < -1 || r.right > document.documentElement.scrollWidth + 1) {
              problems.push('laid out outside the page: ' + phrase);
            }
          }
          return problems;
        })()`,
      )) as string[];

      for (const problem of problems) failures.push(problem);
      if (problems.length === 0) {
        say(`[smoke] all ${expected.length} phrases laid out, sized and on the page`);
      }
    }

    // An occluded or unpainted window captures as an *empty* image rather than failing, so a
    // zero-byte PNG would otherwise be written and reported as a pass. Bring the window forward,
    // stop Chromium throttling it, and retry until there are actual pixels.
    target.webContents.setBackgroundThrottling(false);
    target.show();
    target.focus();

    let png = new Uint8Array(0);
    for (let attempt = 0; attempt < 10 && png.length === 0; attempt += 1) {
      png = new Uint8Array((await target.webContents.capturePage()).toPNG());
      if (png.length === 0) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (png.length === 0) throw new Error('captured an empty image: the window never painted');

    writeFileSync(path, png);
    say(`[smoke] wrote ${path} (${png.length} bytes)`);

    for (const failure of failures) say(`[smoke] renderer error: ${failure}`);
    if (failures.length > 0) failed = true;
  } catch (err) {
    say(`[smoke] ${(err as Error).message}`);
    failed = true;
  } finally {
    // §18.1 says shutdown detaches and the daemon outlives the window — which is right for a
    // person, and wrong for a harness that would otherwise leave a daemon behind on every run.
    // Only ever the one this process started; an adopted daemon belongs to someone else.
    if (spawnedDaemon?.pid) {
      try {
        process.kill(spawnedDaemon.pid);
        say('[smoke] stopped the daemon this run started');
      } catch {
        // Already gone. Nothing to do, and nothing worth saying.
      }
    }

    // `app.exit(code)`, not `app.quit()`. Electron's quit sequence discards `process.exitCode`,
    // so a smoke run that detected a missing panel still exited 0 — a check that reports a
    // failure and then reports success is worse than no check, because CI believes the second
    // one. Found by deliberately asserting a phrase that was not on screen.
    app.exit(failed ? 1 : 0);
  }
}

ipcMain.handle('osade:daemon-port', () => daemonPort);
ipcMain.on('osade:log', (_event, message: unknown) => {
  if (typeof message === 'string' && message.length > 0) say(message);
});
ipcMain.handle('osade:opened-repo', () => openedRepo);
ipcMain.handle('osade:zoom', (_event, delta: unknown) => {
  if (delta === 1 || delta === -1) return bumpZoom(delta);
  return currentZoomLevel();
});

ipcMain.handle('osade:github-status', async () => {
  const token = githubToken();
  if (!token) return { signedIn: false, login: null };
  try {
    const login = await githubUser(token);
    return { signedIn: true, login };
  } catch {
    return { signedIn: false, login: null };
  }
});

ipcMain.handle('osade:github-login', async (event, pasted?: unknown) => {
  try {
    const token = await resolveGithubToken(
      event.sender,
      typeof pasted === 'string' ? pasted : undefined,
    );
    if (token == null) {
      return {
        ok: false as const,
        need: 'paste' as const,
        message:
          'Paste a GitHub personal access token with repo scope, or run `gh auth login` and try again.',
      };
    }
    setGithubToken(token);
    const login = await githubUser(token);
    await respawnDaemonWithToken();
    return { ok: true as const, login };
  } catch (err) {
    return { ok: false as const, error: (err as Error).message };
  }
});

async function resolveGithubToken(
  sender: Electron.WebContents,
  pasted?: string,
): Promise<string | null> {
  if (pasted?.trim()) return pasted.trim();
  const fromGh = await tokenFromGh();
  if (fromGh) return fromGh;
  const clientId = githubClientId();
  if (!clientId) return null;

  const begin = await beginDeviceFlow(clientId);
  sender.send('osade:github-device', {
    userCode: begin.userCode,
    verificationUri: begin.verificationUri,
  });
  await shell.openExternal(begin.verificationUri);

  const deadline = Date.now() + begin.expiresInSec * 1000;
  let waitMs = begin.intervalSec * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    const result = await pollDeviceFlow(clientId, begin.deviceCode);
    if (result === 'slow_down') {
      waitMs += 5_000;
      continue;
    }
    if (result === 'pending') continue;
    return result;
  }
  throw new Error('the GitHub sign-in code expired');
}

async function respawnDaemonWithToken(): Promise<void> {
  const previous = daemonPort;
  await stopDaemon(spawnedDaemon, previous);
  spawnedDaemon = null;
  daemonPort = null;
  const entry = process.env.OSADE_DAEMON_ENTRY ?? daemonEntry();
  const daemon = await adoptOrSpawnDaemon({ entry, onInfo: (m) => say(`[daemon] ${m}`) });
  daemonPort = daemon.port;
  spawnedDaemon = daemon.child;
}

ipcMain.handle('osade:choose-repository', async (event, defaultPath?: unknown) => {
  /**
   * The operating system's own folder picker. Main-process only — the renderer has no filesystem
   * access (contextIsolation, §18.1).
   */
  const options: OpenDialogOptions = {
    title: 'Choose a repository',
    buttonLabel: 'Choose',
    properties: ['openDirectory'],
    ...(typeof defaultPath === 'string' && defaultPath !== '' ? { defaultPath } : {}),
  };
  const owner = BrowserWindow.fromWebContents(event.sender);
  const result = owner
    ? await dialog.showOpenDialog(owner, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
});

/**
 * §4.4 — "Open in the substrate" replaces the embedded terminal in M0. A real substrate client, full
 * fidelity, real input, and no bincode decoder to maintain.
 *
 * Note the consequence recorded in §4.4: attaching a client marks panes seen, so the substrate flips
 * `done` to `idle` for that tab. That is safe only because `idle` is inert in the event
 * mapping (§6.1) — the task keeps its `awaiting_review`.
 */
ipcMain.handle('osade:open-in-substrate', async () => {
  const command =
    process.platform === 'win32'
      ? 'start'
      : process.platform === 'darwin'
        ? 'open'
        : 'x-terminal-emulator';
  // Best effort: we cannot know which terminal the user prefers, so hand them the command.
  //
  // Spelled out in full, including the socket overrides, because Osade runs the substrate on
  // sockets of its own naming under `~/.osade` (§2.2). Without them an attach looks at the
  // runtime's default location, finds nothing there, and reports no session.
  const env = runtimeEnv(OSADE_SESSION);
  const exports = Object.entries(env)
    .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
    .join(' ');
  return { command, hint: `${exports} ${substrateBinary()} session attach ${OSADE_SESSION}` };
});

app.whenReady().then(
  () => {
    void boot().catch((err: Error) => {
      say(`osade failed to start: ${err.message}`);
      app.quit();
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0 && daemonPort != null) createWindow();
    });
  },
  (err: Error) => {
    console.error(`electron failed to become ready: ${err.message}`);
  },
);

/**
 * §18.1 — **shutdown detaches. It does not stop the substrate and does not stop the daemon.**
 * Agents keep running. "Stop everything" is an explicit menu item, not a side effect of
 * closing a window.
 */
app.on('window-all-closed', () => {
  say('every window is closed; detaching');
  if (process.platform !== 'darwin') app.quit();
});

/**
 * The last thing the app says before it dies.
 *
 * Electron's default handler for an uncaught exception in main is a dialog the user dismisses and
 * a process that goes away, which in a packaged build means a silent disappearance. This does not
 * swallow anything — it writes the reason to `~/.osade/logs/app.log` and then exits — but the
 * difference between "it vanished" and "it vanished because X" is the whole of being able to fix
 * it from a bug report.
 */
process.on('uncaughtException', (err: Error) => {
  say(`fatal: ${err.stack ?? err.message}`);
  app.exit(1);
});
