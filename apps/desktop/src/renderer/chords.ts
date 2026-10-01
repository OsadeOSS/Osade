export function isMac(): boolean {
  return typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
}

/** Visible chord labels. Unicode arrows vanish in Plex on Windows. */
export function chord(
  key: 'k' | 'n' | 't' | 'w' | 'b' | 'note' | 'notes' | 'enter' | 'backspace',
): string {
  if (isMac()) {
    if (key === 'k') return '⌘K';
    if (key === 'n' || key === 't') return '⌘T';
    if (key === 'w') return '⌘W';
    // Both shift-qualified chords are spelled out: bare ⌘B and ⌘Q are conventional elsewhere.
    if (key === 'b') return '⌘⇧B';
    if (key === 'note') return '⌘⇧N';
    if (key === 'notes') return '⌘⇧Q';
    if (key === 'enter') return '⌘↵';
    return '⌘⌫';
  }
  if (key === 'k') return 'Ctrl+K';
  if (key === 'n' || key === 't') return 'Ctrl+T';
  if (key === 'w') return 'Ctrl+W';
  if (key === 'b') return 'Ctrl+Shift+B';
  if (key === 'note') return 'Ctrl+Shift+N';
  if (key === 'notes') return 'Ctrl+Shift+Q';
  if (key === 'enter') return 'Ctrl+Enter';
  return 'Ctrl+Backspace';
}