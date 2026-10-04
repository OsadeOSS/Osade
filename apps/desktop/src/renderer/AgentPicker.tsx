import { useEffect, useMemo, useState, type JSX } from 'react';

import { AgentMark } from './agent-icon.js';
import type { CatalogAgent } from './RepoSettings.js';

/**
 * Which agent a new chat starts with: the modal pick wins, then the repo
 * default, then the daemon fallback. Mirrors the daemon's own default chain.
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
  const [query, setQuery] = useState('');
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return agents;
    return agents.filter((agent) =>
      [agent.id, agent.displayName].some((value) => value.toLowerCase().includes(needle)),
    );
  }, [agents, query]);

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
      className="agent-picker-backdrop"
      onMouseDown={onClose}
      onContextMenu={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div
        className="agent-picker"
        role="dialog"
        aria-label="Pick an agent for the new chat"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="agent-picker-head">
          <div>
            <h2>Start a new chat</h2>
            <p>{repoName ? `Choose the first agent for ${repoName}.` : 'Choose the first agent.'}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close agent picker">×</button>
        </header>

        <label className="agent-picker-search">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <circle cx="7" cy="7" r="4.3" />
            <path d="m10.3 10.3 3.2 3.2" />
          </svg>
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find an agent…"
            aria-label="Find an agent"
          />
        </label>

        <div className="agent-picker-list">
          {agents.length === 0 && (
            <p className="agent-picker-empty">No agents found. Check that the daemon is connected.</p>
          )}
          {agents.length > 0 && visible.length === 0 && (
            <p className="agent-picker-empty">No agent matches “{query}”.</p>
          )}
          {visible.map((agent) => {
            const isDefault = agent.id === defaultId;
            return (
              <button
                key={agent.id}
                type="button"
                disabled={!agent.installed}
                onClick={() => onPick(agent.id)}
                className="agent-picker-row"
              >
                <span className="agent-picker-mark" aria-hidden="true">
                  <AgentMark name={agent.id} size={17} />
                </span>
                <span className="agent-picker-copy">
                  <span>{agent.displayName}</span>
                  <small>{agent.installed ? agent.id : `${agent.id} · not installed`}</small>
                </span>
                {isDefault && agent.installed ? (
                  <span className="agent-picker-default">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                      <path d="M3 8.5 6.2 12 13 4.5" />
                    </svg>
                    Default
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <footer className="agent-picker-foot"><kbd>Esc</kbd> closes</footer>
      </div>
    </div>
  );
}
