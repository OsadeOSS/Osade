import { useEffect, useState } from 'react';

import { api } from './api.js';

/**
 * The repository the window is scoped to, when it was opened with one.
 *
 * `osade .` passes a path; this turns it into the repo the ledger filters by. Resolving through
 * the daemon rather than matching the path in the renderer is deliberate — the daemon is the one
 * that knows a subdirectory belongs to a repository, and §18.1 says the renderer never decides
 * anything it can be told.
 *
 * A second `osade .` in another repository re-scopes this window rather than opening a new one,
 * which is what `onRepoOpened` is listening for. `requestId` bumps on every such open — including
 * the same path twice — so the window can focus a fresh empty chat each time.
 */

export interface OpenRepo {
  repoId: string;
  path: string;
  name: string;
  slug: string | null;
  defaultBranch: string;
  currentBranch: string;
  defaultAgent: string | null;
}

export function useRepo(): { repo: OpenRepo | null; error: string | null; requestId: number } {
  const [path, setPath] = useState<string | null>(null);
  const [askId, setAskId] = useState(0);
  const [repo, setRepo] = useState<OpenRepo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(0);

  useEffect(() => {
    function take(next: string | null): void {
      if (!next) return;
      setPath(next);
      setAskId((n) => n + 1);
    }
    void window.osade?.openedRepo().then(take);
    return window.osade?.onRepoOpened(take);
  }, []);

  useEffect(() => {
    if (!path || askId === 0) {
      setRepo(null);
      return;
    }

    const forAsk = askId;
    let cancelled = false;
    void api
      .repoOpen(path)
      .then((result) => {
        if (cancelled) return;
        setRepo(result);
        setError(null);
        setRequestId(forAsk);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [path, askId]);

  return { repo, error, requestId };
}
