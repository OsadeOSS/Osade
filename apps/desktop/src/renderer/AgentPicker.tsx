import { useEffect, type JSX } from 'react';

import { AgentMark } from './agent-icon.js';
import type { CatalogAgent } from './RepoSettings.js';

/**
 * Which agent a new chat starts with: the modal pick wins, then the repo
 * default, then the daemon fallback. Mirrors the daemon's own default chain
 * (`DAEMON_DEFAULT_AGENT`) so the composer never disagrees with launch time.
 */
export function resolveNewChatAgent(picked: string | null, repoDefault: string | null): string {
  return picked ?? repoDefault ?? 'claude';
}

export function AgentPicker({
  agents,
  defaultId,
  repoName,
  onPick,
  onClose,
}: {
  agents: CatalogAgent[];
  defaultId: string;
  repoName: string | null;
  onPick: (agentId: string) => void;
  onClose: () => void;
}): JSX.Element {
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      onContextMenu={(event) => {
        event.preventDefault();
        onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 40,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.45)',
      }}
    >
      <div
        role="dialog"
        aria-label="Pick an agent for the new chat"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 320,
          maxWidth: 'calc(100vw - 48px)',
          background: 'var(--bg-2)',
          border: '0.5px solid var(--line)',
          borderRadius: 'var(--radius)',
          padding: '14px 14px 10px',
        }}
      >
        <p style={{ margin: 0, fontSize: 'var(--t-m)', fontWeight: 600 }}>New chat</p>
        <p style={{ margin: '4px 0 12px', fontSize: 'var(--t-xs)', color: 'var(--ink-2)' }}>
          {repoName ? `In ${repoName} · pick an agent to start with.` : 'Pick an agent to start with.'}
        </p>
        {agents.length === 0 && (
          <p style={{ margin: '0 0 8px', fontSize: 'var(--t-s)', color: 'var(--ink-2)' }}>
            No agents found — is the daemon connected?
          </p>
        )}
        {agents.map((agent) => {
          const isDefault = agent.id === defaultId;
          return (
            <button
              key={agent.id}
              type="button"
              autoFocus={isDefault}
              onClick={() => onPick(agent.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                textAlign: 'left',
                background: 'transparent',
                border: 'none',
                borderRadius: 0,
                padding: '8px 6px',
                fontSize: 'var(--t-s)',
                color: agent.installed ? 'var(--ink)' : 'var(--ink-3)',
              }}
            >
              <span aria-hidden="true" style={{ flexShrink: 0, display: 'flex' }}>
                <AgentMark name={agent.id} size={16} />
              </span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {agent.displayName}
              </span>
              {isDefault && (
                <span className="mono" style={{ fontSize: 'var(--t-xs)', color: 'var(--ink-3)' }}>
                  default
                </span>
              )}
              {!agent.installed && (
                <span className="mono" style={{ fontSize: 'var(--t-xs)', color: 'var(--ink-3)' }}>
                  not installed
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
