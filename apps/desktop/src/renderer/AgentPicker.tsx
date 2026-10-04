import { useEffect, useMemo, useRef, useState, type JSX } from 'react';

import { AgentMark } from './agent-icon.js';
import type { ShellKind } from './api.js';
import type { CatalogAgent } from './RepoSettings.js';
import { ShellIcon } from './shell-icon.js';

/**
 * Which agent a new chat starts with: the modal pick wins, then the repo
 * default, then the daemon fallback. Mirrors the daemon's own default chain.
 */
export function resolveNewChatAgent(picked: string | null, repoDefault: string | null): string {
  return picked ?? repoDefault ?? 'claude';
}

export interface ShellOption {
  kind: ShellKind;
  label: string;
}

type Entry =
  | { type: 'shell'; key: string; label: string; shell: ShellOption }
  | { type: 'agent'; key: string; label: string; agent: CatalogAgent };

/** Case-insensitive match against everything a row could be searched by. */
export function filterEntries<T extends { label: string }>(
  entries: T[],
  query: string,
  extra: (entry: T) => string[] = () => [],
): T[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return entries;
  return entries.filter((entry) =>
    [entry.label, ...extra(entry)].some((value) => value.toLowerCase().includes(needle)),
  );
}

/**
 * The new-session menu: open a plain terminal in the folder, or start a chat with an agent.
 * Laid out like Orca's "+" menu — search on top, terminals, then agents.
 */
export function AgentPicker({
  agents,
  shells,
  defaultId,
  repoName,
  onPick,
  onPickShell,
  onClose,
}: {
  agents: CatalogAgent[];
  shells: ShellOption[];
  defaultId: string;
  repoName: string | null;
  onPick: (agentId: string) => void;
  onPickShell: (shell: ShellKind) => void;
  onClose: () => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const entries = useMemo<Entry[]>(() => {
    const shellRows: Entry[] = shells.map((shell) => ({
      type: 'shell',
      key: `shell:${shell.kind}`,
      label: `New Terminal: ${shell.label}`,
      shell,
    }));
    const agentRows: Entry[] = agents.map((agent) => ({
      type: 'agent',
      key: `agent:${agent.id}`,
      label: agent.displayName,
      agent,
    }));
    return filterEntries([...shellRows, ...agentRows], query, (entry) =>
      entry.type === 'shell' ? ['terminal', 'shell', entry.shell.kind] : [entry.agent.id],
    );
  }, [agents, shells, query]);

  const selectable = entries.filter((entry) => entry.type === 'shell' || entry.agent.installed);
  const active = selectable[Math.min(cursor, selectable.length - 1)] ?? null;

  useEffect(() => setCursor(0), [query]);

  useEffect(() => {
    if (!active) return;
    listRef.current
      ?.querySelector(`[data-key="${CSS.escape(active.key)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function choose(entry: Entry): void {
    if (entry.type === 'shell') onPickShell(entry.shell.kind);
    else if (entry.agent.installed) onPick(entry.agent.id);
  }

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

  const shellEntries = entries.filter((entry) => entry.type === 'shell');
  const agentEntries = entries.filter((entry) => entry.type === 'agent');

  function row(entry: Entry): JSX.Element {
    const disabled = entry.type === 'agent' && !entry.agent.installed;
    const isDefault = entry.type === 'agent' && entry.agent.id === defaultId && entry.agent.installed;
    return (
      <button
        key={entry.key}
        data-key={entry.key}
        type="button"
        role="option"
        aria-selected={active?.key === entry.key}
        disabled={disabled}
        className="new-menu-row"
        onMouseMove={() => {
          const index = selectable.findIndex((candidate) => candidate.key === entry.key);
          if (index >= 0 && index !== cursor) setCursor(index);
        }}
        onClick={() => choose(entry)}
        title={disabled ? `${entry.label} is not installed` : undefined}
      >
        <span className="new-menu-icon" aria-hidden="true">
          {entry.type === 'shell' ? (
            <ShellIcon shell={entry.shell.kind} size={16} />
          ) : (
            <AgentMark name={entry.agent.id} size={16} />
          )}
        </span>
        <span className="new-menu-label">{entry.label}</span>
        {disabled ? <span className="new-menu-hint">Not installed</span> : null}
        {isDefault ? <span className="new-menu-hint">Default</span> : null}
      </button>
    );
  }

  return (
    <div
      className="new-menu-backdrop"
      onMouseDown={onClose}
      onContextMenu={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div
        className="new-menu"
        role="dialog"
        aria-label={repoName ? `New session in ${repoName}` : 'New session'}
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          autoFocus
          className="new-menu-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              if (selectable.length === 0) return;
              const delta = event.key === 'ArrowDown' ? 1 : -1;
              setCursor((current) => (current + delta + selectable.length) % selectable.length);
            } else if (event.key === 'Enter' && active) {
              event.preventDefault();
              choose(active);
            }
          }}
          placeholder="Search terminals and agents…"
          aria-label="Search terminals and agents"
          title={repoName ?? undefined}
        />

        <div className="new-menu-list" role="listbox" ref={listRef}>
          {shellEntries.map(row)}
          {shellEntries.length > 0 && agentEntries.length > 0 && <div className="new-menu-sep" role="separator" />}
          {agentEntries.map(row)}
          {agents.length === 0 && query.trim().length === 0 && (
            <p className="new-menu-empty">No agents found. Check that the daemon is connected.</p>
          )}
          {entries.length === 0 && query.trim().length > 0 && (
            <p className="new-menu-empty">Nothing matches “{query}”.</p>
          )}
        </div>
      </div>
    </div>
  );
}
