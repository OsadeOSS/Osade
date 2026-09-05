import { contextBridge, ipcRenderer } from 'electron';

/**
 * The contextBridge surface — OSADE.md §18.1.
 *
 * Deliberately tiny. The renderer talks to the daemon over tRPC + websocket on loopback; the
 * only things it needs from main are where the daemon is listening and the "open in herdr"
 * hint. Nothing here exposes Node, the filesystem, or herdr's sockets.
 */
contextBridge.exposeInMainWorld('osade', {
  daemonPort: (): Promise<number | null> => ipcRenderer.invoke('osade:daemon-port'),
  openInHerdr: (): Promise<{ command: string; hint: string }> =>
    ipcRenderer.invoke('osade:open-in-herdr'),
});
