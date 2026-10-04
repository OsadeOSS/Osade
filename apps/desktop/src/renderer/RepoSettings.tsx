import { useEffect, useState, type JSX } from 'react';

import { api } from './api.js';

export interface CatalogAgent {
  id: string;
  displayName: string;
  installed: boolean;
}

export function useAgentCatalog(ready = true): CatalogAgent[] {
  const [agents, setAgents] = useState<CatalogAgent[]>([]);
  useEffect(() => {
    if (!ready) return;
    void api.agentCatalogList().then(setAgents, () => setAgents([]));
  }, [ready]);
  return agents;
}

export function RepoSettings({
  repoId,
  defaultAgent,
  catalog,
  onSaved,
}: {
  repoId: string;
  defaultAgent: string | null;
  catalog: CatalogAgent[];
  onSaved: (agentId: string) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(defaultAgent ?? 'claude');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setValue(defaultAgent ?? 'claude');
  }, [defaultAgent]);

  async function save(next: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api.repoSetDefaultAgent(repoId, next);
      setValue(next);
      onSaved(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="osade-settings" style={{ position: 'relative' }}>
      <button
        type="button"
        className="osade-action-btn"
        title="Repo settings"
        aria-label="Repo settings"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <circle cx="8" cy="8" r="2.2" />
          <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
        </svg>
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: '100%',
            marginTop: 4,
            // The sidebar can be 240px wide; a right-anchored 240px panel would clip on the left.
            width: 212,
            zIndex: 15,
            background: 'var(--bg-2)',
            border: '0.5px solid var(--line)',
            borderRadius: 'var(--radius)',
            padding: 12,
          }}
        >
          <label style={{ display: 'block', fontSize: 'var(--t-xs)', color: 'var(--ink-2)' }}>
            Default agent
            <select
              value={value}
              disabled={busy}
              onChange={(event) => void save(event.target.value)}
              style={{ display: 'block', width: '100%', marginTop: 6 }}
            >
              {catalog.map((agent) => (
                <option key={agent.id} value={agent.id} disabled={!agent.installed}>
                  {agent.displayName}
                  {agent.installed ? '' : ' (not on PATH)'}
                </option>
              ))}
            </select>
          </label>
          {error && (
            <p className="mono" style={{ color: 'var(--st-fail)', fontSize: 'var(--t-xs)', margin: '8px 0 0' }}>
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
