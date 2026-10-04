import type { JSX } from 'react';

import type { ShellKind } from './api.js';
import gitForWindowsLogo from './assets/git-for-windows.svg';

/*
 * Shell badges from Orca's tab bar (MIT, see THIRD-PARTY-NOTICES.md): stock glyphs render every
 * shell as the same chevron, and the new-session menu needs PowerShell, CMD and Git Bash to be
 * told apart at a glance.
 */

function PowerShellIcon({ size }: { size: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1.5" y="3" width="21" height="18" rx="2.5" fill="#2E74B5" />
      <path d="M6.5 7.3l6.2 4.7-6.2 4.7-1.2-1.2 4.6-3.5-4.6-3.5z" fill="#ffffff" />
      <rect x="12.5" y="15.3" width="5" height="1.4" rx="0.4" fill="#ffffff" />
    </svg>
  );
}

function CmdIcon({ size }: { size: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1.5" y="3" width="21" height="18" rx="2.5" fill="#1F1F1F" />
      <path d="M5.8 8l4 4-4 4-1.1-1.1L7.7 12 4.7 9.1z" fill="#ffffff" />
      <rect x="10.5" y="15" width="8" height="1.4" rx="0.4" fill="#ffffff" />
    </svg>
  );
}

function GenericTerminalIcon({ size }: { size: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1.5" y="3" width="21" height="18" rx="2.5" fill="#000000" />
      <path
        d="M6 7.5 L11.5 12 L6 16.5"
        stroke="#ffffff"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M12.5 16.5 L18 16.5" stroke="#ffffff" strokeWidth="2.6" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function ShellIcon({ shell, size = 14 }: { shell: ShellKind; size?: number }): JSX.Element {
  switch (shell) {
    case 'powershell':
      return <PowerShellIcon size={size} />;
    case 'cmd':
      return <CmdIcon size={size} />;
    case 'gitbash':
      return (
        <img src={gitForWindowsLogo} alt="" aria-hidden="true" width={size} height={size} style={{ display: 'block' }} />
      );
    default:
      return <GenericTerminalIcon size={size} />;
  }
}
