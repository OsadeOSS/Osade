import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * OSADE.md §2.2 — INVARIANT: state containment.
 *
 * `app.setPath('userData', ...)` runs **before anything else touches disk** and before
 * `app.whenReady()`. No `~/Library/Application Support`, no `%APPDATA%`, ever: the whole
 * system must be resettable with `rm -rf ~/.osade`.
 *
 * This is the first executable statement in the app for that reason. Do not move it.
 */
const OSADE_ROOT = process.env.OSADE_HOME ?? join(homedir(), '.osade');
app.setPath('userData', join(OSADE_ROOT, 'electron'));
app.setPath('sessionData', join(OSADE_ROOT, 'electron', 'session'));

import { adoptOrSpawnDaemon } from './supervisor/daemon.js';
import { adoptOrSpawnHerdr } from './supervisor/herdr.js';

const isDev = !app.isPackaged;

let window: BrowserWindow | null = null;
let daemonPort: number | null = null;

/**
 * Startup order, and it matters (§18.1):
 *   1. userData redirect (above, before this runs)
 *   2. boot drift check — owned by the daemon, which refuses to start on a mismatch
 *   3. adopt-or-spawn herdr on the `osade` session; wait for ping
 *   4. spawn the daemon; wait for its ready handshake, never a fixed sleep
 *   5. create the window
 *
 * There is no surface port in M0: the embedded terminal is deferred (§4.4, ADR 0001).
 */
async function boot(): Promise<void> {
  await adoptOrSpawnHerdr({ onInfo: (m) => console.log(`[herdr] ${m}`) });

  const daemonEntry = join(__dirname, '../../../..', 'packages/daemon/src/cli.ts');
  const daemon = await adoptOrSpawnDaemon({
    entry: process.env.OSADE_DAEMON_ENTRY ?? daemonEntry,
    onInfo: (m) => console.log(`[daemon] ${m}`),
  });
  daemonPort = daemon.port;

  createWindow();
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    // §19.2 — light-first, --paper. Set here too so the frame does not flash white-then-dark.
    backgroundColor: '#F6F7F4',
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

  if (isDev) window.webContents.openDevTools({ mode: 'detach' });
  window.on('closed', () => {
    window = null;
  });
}

ipcMain.handle('osade:daemon-port', () => daemonPort);

/**
 * §4.4 — "Open in herdr" replaces the embedded terminal in M0. A real herdr client, full
 * fidelity, real input, and no bincode decoder to maintain.
 *
 * Note the consequence recorded in §4.4: attaching a client marks panes seen, so herdr flips
 * `done` to `idle` for that tab. That is safe only because `idle` is inert in the event
 * mapping (§6.1) — the task keeps its `awaiting_review`.
 */
ipcMain.handle('osade:open-in-herdr', async () => {
  const command =
    process.platform === 'win32'
      ? 'start'
      : process.platform === 'darwin'
        ? 'open'
        : 'x-terminal-emulator';
  // Best effort: we cannot know which terminal the user prefers, so hand them the command.
  return { command, hint: 'herdr session attach osade' };
});

app.whenReady().then(
  () => {
    void boot().catch((err: Error) => {
      console.error(`osade failed to start: ${err.message}`);
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
 * §18.1 — **shutdown detaches. It does not stop herdr and does not stop the daemon.**
 * Agents keep running. "Stop everything" is an explicit menu item, not a side effect of
 * closing a window.
 */
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
