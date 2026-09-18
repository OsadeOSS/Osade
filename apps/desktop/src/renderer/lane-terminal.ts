export type ChatSurface = 'chat' | 'terminal';

/** The PTY view is on screen only for Chat → Terminal. */
export function terminalSurfaceVisible(lane: string, surface: ChatSurface): boolean {
  return lane === 'transcript' && surface === 'terminal';
}

/** Keep the xterm host mounted so switching to Chat does not throw the buffer away. */
export function retainLaneTerminal(openedTaskId: string | null, focusedTaskId: string): boolean {
  return openedTaskId === focusedTaskId;
}

/** First Terminal visit remembers this lane; a different focused lane drops it. */
export function nextOpenedTerminal(
  openedTaskId: string | null,
  focusedTaskId: string,
  surface: ChatSurface,
): string | null {
  if (surface === 'terminal') return focusedTaskId;
  return openedTaskId === focusedTaskId ? openedTaskId : null;
}

export type TerminalKeyAction = 'paste' | 'copy';

/**
 * xterm sends Ctrl+V as ^V (and Ctrl+C as SIGINT). Windows/Electron users expect clipboard.
 * Returning an action means the key must not go to the PTY.
 */
export function terminalKeyAction(event: {
  type?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  key: string;
}): TerminalKeyAction | null {
  if (event.type != null && event.type !== 'keydown') return null;
  if (event.altKey) return null;
  if (!(event.ctrlKey || event.metaKey)) return null;
  const key = event.key.toLowerCase();
  if (key === 'v') return 'paste';
  if (key === 'c') return 'copy';
  return null;
}
