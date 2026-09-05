import { useEffect, useRef, useState } from 'react';

import type { ServerMessage, TaskView } from '@osade/contract';

/**
 * The ledger's connection to the daemon — OSADE.md §18.1.
 *
 * INVARIANT: the renderer is never the source of truth. It renders streamed state, never
 * computes status (§6 lives in the daemon), and **on reconnect it discards local state and
 * takes the snapshot**. There is no client-side merge of a stale cache with a fresh stream.
 *
 * There is also no polling: everything after the snapshot arrives as a push, which is only
 * true because every mutation flows through `change_log` (§5.4).
 */

declare global {
  interface Window {
    osade?: {
      daemonPort(): Promise<number | null>;
      openInHerdr(): Promise<{ command: string; hint: string }>;
    };
  }
}

export type Connection = 'connecting' | 'live' | 'offline';

export interface Ledger {
  tasks: TaskView[];
  connection: Connection;
  error: string | null;
}

const RECONNECT_MS = 1_000;

export function useLedger(): Ledger {
  const [tasks, setTasks] = useState<TaskView[]>([]);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;

    async function connect(): Promise<void> {
      if (cancelled) return;

      const port = (await window.osade?.daemonPort()) ?? null;
      if (port == null) {
        setConnection('offline');
        setError('the osade daemon is not running');
        retry = setTimeout(() => void connect(), RECONNECT_MS);
        return;
      }

      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      socketRef.current = socket;

      socket.onopen = () => {
        setConnection('live');
        setError(null);
      };

      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as ServerMessage;
        switch (message.type) {
          case 'snapshot':
            // Discard whatever we had. The snapshot is the truth.
            setTasks(message.tasks);
            return;
          case 'task.upserted':
            setTasks((current) => {
              const next = current.filter((t) => t.task.id !== message.task.task.id);
              next.push(message.task);
              return sortLedger(next);
            });
            return;
          case 'task.removed':
            setTasks((current) => current.filter((t) => t.task.id !== message.taskId));
            return;
          case 'stream.reset':
            // The daemon is telling us our watermark is unusable. Re-snapshot rather than
            // guess at what we missed.
            socket.send(JSON.stringify({ type: 'hello' }));
            return;
        }
      };

      socket.onclose = () => {
        if (cancelled) return;
        setConnection('offline');
        retry = setTimeout(() => void connect(), RECONNECT_MS);
      };

      socket.onerror = () => setError('lost the connection to the daemon');
    }

    void connect();

    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      socketRef.current?.close();
    };
  }, []);

  return { tasks, connection, error };
}

/**
 * §19.3 — needs-you first, then live, then everything else. Never creation time by default.
 *
 * The daemon sorts `taskList` the same way; this keeps an incrementally-updated ledger in the
 * same order rather than letting pushed rows land wherever they arrive.
 */
const RANK: Record<TaskView['status'], number> = {
  awaiting_approval: 0,
  needs_input: 1,
  review_changes_requested: 2,
  awaiting_review: 3,
  implementing: 4,
  verifying: 5,
  verify_failed: 6,
  ci_failed: 7,
  pr_open: 8,
  queued: 9,
  idle: 10,
  stopped: 11,
  merged: 12,
  archived: 13,
};

export function sortLedger(tasks: TaskView[]): TaskView[] {
  return [...tasks].sort((a, b) => {
    const rank = RANK[a.status] - RANK[b.status];
    return rank !== 0 ? rank : b.task.created_at - a.task.created_at;
  });
}
