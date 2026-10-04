import type { JSX, ReactNode } from 'react';

import { GitHubSignIn } from './GitHubSignIn.js';

/** The full-width bar along the window's bottom edge, like Orca's: activity left, connections right. */
export function StatusBar({
  summary,
  working,
  total,
  connected,
  github,
  onGithubSignedIn,
}: {
  summary: string;
  working: number;
  total: number;
  connected: boolean;
  github: { signedIn: boolean; login: string | null };
  onGithubSignedIn: (login: string) => void;
}): JSX.Element {
  return (
    <footer className="status-bar" aria-label="Application status">
      <div className="status-bar-group">
        <StatusItem icon="agents" title="Agents">
          <span
            className={`dock-status-dot ${working > 0 ? 'dock-status-live' : ''}`}
            data-tone={working > 0 ? 'live' : 'idle'}
            aria-hidden="true"
          />
          {working === 0 ? 'Idle' : `${working} running`}
        </StatusItem>
        <StatusItem icon="chats" title="Chats">
          {total} {total === 1 ? 'chat' : 'chats'}
        </StatusItem>
        {summary && <span className="status-bar-item status-bar-muted">{summary}</span>}
      </div>
      <div className="status-bar-group">
        <StatusItem icon="daemon" title="Daemon">
          <span
            className={`dock-status-dot ${connected ? 'dock-status-live' : ''}`}
            data-tone={connected ? 'live' : 'fail'}
            aria-hidden="true"
          />
          {connected ? 'Daemon connected' : 'Reconnecting'}
        </StatusItem>
        {github.signedIn ? (
          <StatusItem icon="github" title="GitHub">
            {github.login ?? 'Signed in'}
          </StatusItem>
        ) : (
          <details className="status-bar-popover">
            <summary className="status-bar-item">
              <DockIcon name="github" />
              Sign in to GitHub
            </summary>
            <div className="status-bar-popover-body">
              <GitHubSignIn status={github} onSignedIn={onGithubSignedIn} />
            </div>
          </details>
        )}
      </div>
    </footer>
  );
}

function StatusItem({
  icon,
  title,
  children,
}: {
  icon: 'agents' | 'chats' | 'daemon' | 'github';
  title: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <span className="status-bar-item" title={title}>
      <DockIcon name={icon} />
      {children}
    </span>
  );
}

function DockIcon({ name }: { name: 'agents' | 'chats' | 'daemon' | 'github' }): JSX.Element {
  const common = {
    className: 'dock-ico',
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    'aria-hidden': true as const,
  };
  if (name === 'chats') {
    return (
      <svg {...common}>
        <path d="M2.5 4h11v6.2H5.8L2.5 13z" />
      </svg>
    );
  }
  if (name === 'daemon') {
    return (
      <svg {...common}>
        <rect x="2.5" y="3" width="11" height="4.5" rx="1" />
        <rect x="2.5" y="9" width="11" height="4.5" rx="1" />
        <circle cx="5" cy="5.25" r="0.8" fill="currentColor" />
        <circle cx="5" cy="11.25" r="0.8" fill="currentColor" />
      </svg>
    );
  }
  if (name === 'github') {
    return (
      <svg {...common} fill="currentColor" stroke="none">
        <path d="M8 2.2a5.8 5.8 0 0 0-1.83 11.3c.29.05.4-.12.4-.28v-1.02c-1.62.35-1.96-.7-1.96-.7-.26-.67-.64-.85-.64-.85-.53-.36.04-.35.04-.35.58.04.89.6.89.6.52.88 1.36.63 1.69.48.05-.38.2-.63.37-.78-1.3-.15-2.66-.65-2.66-2.9 0-.64.23-1.16.6-1.57-.06-.15-.26-.75.06-1.56 0 0 .5-.16 1.62.6a5.6 5.6 0 0 1 2.94 0c1.12-.76 1.62-.6 1.62-.6.32.81.12 1.41.06 1.56.38.41.6.93.6 1.57 0 2.26-1.37 2.75-2.67 2.9.21.18.4.53.4 1.07v1.58c0 .16.1.34.4.28A5.8 5.8 0 0 0 8 2.2z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" />
      <circle cx="8" cy="8" r="1.5" fill="currentColor" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2" />
    </svg>
  );
}
