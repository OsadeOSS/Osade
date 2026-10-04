import { contextBridge, ipcRenderer } from 'electron';

import type { BrowserElement, BrowserShot, BrowserState, CssRect } from '../main/browser-contract.js';

/**
 * The contextBridge surface — OSADE.md §18.1.
 *
 * Deliberately tiny. The renderer talks to the daemon over tRPC + websocket on loopback; the
 * only things it needs from main are where the daemon is listening, the "open in the substrate"
 * hint, and the operating system's folder picker. Nothing here exposes Node, the filesystem, or
 * the substrate's sockets — the picker hands back a path the person chose, and nothing more.
 */
contextBridge.exposeInMainWorld('osade', {
  daemonPort: (): Promise<number | null> => ipcRenderer.invoke('osade:daemon-port'),
  log: (message: string): void => {
    ipcRenderer.send('osade:log', message);
  },
  openInSubstrate: (): Promise<{ command: string; hint: string }> =>
    ipcRenderer.invoke('osade:open-in-substrate'),

  openedRepo: (): Promise<string | null> => ipcRenderer.invoke('osade:opened-repo'),

  githubStatus: (): Promise<{ signedIn: boolean; login: string | null }> =>
    ipcRenderer.invoke('osade:github-status'),

  githubLogin: (
    token?: string,
  ): Promise<
    | { ok: true; login: string }
    | { ok: false; need: 'paste'; message: string }
    | { ok: false; error: string }
  > => ipcRenderer.invoke('osade:github-login', token),

  onGithubDevice: (handler: (prompt: { userCode: string; verificationUri: string }) => void): (() => void) => {
    const listener = (_event: unknown, prompt: { userCode: string; verificationUri: string }): void =>
      handler(prompt);
    ipcRenderer.on('osade:github-device', listener);
    return () => ipcRenderer.removeListener('osade:github-device', listener);
  },

  /**
   * The operating system's folder picker, for choosing a repository. Resolves to the chosen
   * folder, or null when the picker was dismissed.
   */
  chooseRepository: (defaultPath?: string): Promise<string | null> =>
    ipcRenderer.invoke('osade:choose-repository', defaultPath),

  /** Code editors installed on PATH, for the project menu's "Open in". */
  editors: (): Promise<{ id: string; label: string }[]> => ipcRenderer.invoke('osade:editors'),

  /** Open a project folder in the file manager (`files`) or an editor from `editors()`. */
  openFolderIn: (folder: string, target: string): Promise<void> =>
    ipcRenderer.invoke('osade:open-folder-in', folder, target),

  /**
   * VS Code zoom: +1 / −1 steps of 1.2×. Keyboard chords are handled in main;
   * the renderer only uses this for Ctrl+wheel.
   */
  zoom: (delta: 1 | -1): Promise<number> => ipcRenderer.invoke('osade:zoom', delta),

  /**
   * A second `osade .` in another repository re-scopes this window rather than opening another.
   * Returns an unsubscribe, because a renderer that leaks listeners across reloads leaks them
   * forever.
   */
  onRepoOpened: (handler: (path: string) => void): (() => void) => {
    const listener = (_event: unknown, path: string): void => handler(path);
    ipcRenderer.on('osade:repo-opened', listener);
    return () => ipcRenderer.removeListener('osade:repo-opened', listener);
  },

  /**
   * The browser pane — issue #13.
   *
   * Geometry in, geometry out: `bounds` takes a rectangle the renderer measured and main
   * re-applies, and `changed` pushes navigation state back whenever the page moves. The page
   * itself is never reachable from here — no `execute`, no `eval`, no way to run script in the
   * pane. `element` is the one page-reading call, and it answers with a description rather than
   * a handle.
   */
  browser: {
    open: (url: string): Promise<BrowserState> => ipcRenderer.invoke('osade:browser-open', url),
    close: (): Promise<void> => ipcRenderer.invoke('osade:browser-close'),
    bounds: (rect: CssRect | null): Promise<void> => ipcRenderer.invoke('osade:browser-bounds', rect),
    load: (url: string): Promise<BrowserState> => ipcRenderer.invoke('osade:browser-load', url),
    reload: (): Promise<void> => ipcRenderer.invoke('osade:browser-reload'),
    back: (): Promise<boolean> => ipcRenderer.invoke('osade:browser-back'),
    forward: (): Promise<boolean> => ipcRenderer.invoke('osade:browser-forward'),
    openExternal: (): Promise<void> => ipcRenderer.invoke('osade:browser-external'),
    state: (): Promise<BrowserState> => ipcRenderer.invoke('osade:browser-state'),
    screenshot: (): Promise<BrowserShot> => ipcRenderer.invoke('osade:browser-screenshot'),
    element: (x: number, y: number): Promise<BrowserElement | null> =>
      ipcRenderer.invoke('osade:browser-element', { x, y }),
    onChanged: (handler: (state: BrowserState) => void): (() => void) => {
      const listener = (_event: unknown, state: BrowserState): void => handler(state);
      ipcRenderer.on('osade:browser-changed', listener);
      return () => ipcRenderer.removeListener('osade:browser-changed', listener);
    },
  },
});
