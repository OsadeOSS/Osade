import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { TaskView } from '@osade/contract';

/**
 * A tiny tRPC-over-HTTP client for the `osade` CLI.
 *
 * OSADE.md §17 — DECISION: agents coordinate by driving this CLI, exactly as a human would.
 * There is no agent-to-agent protocol and no privileged path: an orchestrator cannot bypass a
 * gate, because gates live in the daemon rather than in the caller. Anything an orchestrator
 * can do, a human can do from a terminal, and vice versa. That symmetry is the point.
 *
 * Deliberately hand-rolled rather than pulling in `@trpc/client`: the CLI must stay cheap to
 * start, and this is three fetches.
 */

export class OsadeCliError extends Error {}

function portFilePath(): string {
  const root = process.env.OSADE_HOME ?? join(homedir(), '.osade');
  return join(root, 'daemon.port');
}

export function daemonBaseUrl(): string {
  if (process.env.OSADE_DAEMON_URL) return process.env.OSADE_DAEMON_URL;
  let port: string;
  try {
    port = readFileSync(portFilePath(), 'utf8').trim();
  } catch {
    throw new OsadeCliError(
      `the osade daemon does not appear to be running (no ${portFilePath()}).\n` +
        `start it with: osade-daemon start`,
    );
  }
  // §2.1 — loopback only. There is no remote mode in v1.
  return `http://127.0.0.1:${port}`;
}

async function call(kind: 'query' | 'mutation', path: string, input: unknown): Promise<unknown> {
  const base = daemonBaseUrl();
  const url =
    kind === 'query'
      ? `${base}/${path}?input=${encodeURIComponent(JSON.stringify(input))}`
      : `${base}/${path}`;

  const response = await fetch(url, {
    method: kind === 'query' ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    ...(kind === 'mutation' ? { body: JSON.stringify(input) } : {}),
  });

  const body = (await response.json()) as {
    result?: { data?: unknown };
    error?: { message?: string; json?: { message?: string } };
  };

  if (body.error) {
    throw new OsadeCliError(body.error.json?.message ?? body.error.message ?? 'daemon error');
  }
  return body.result?.data;
}

export const api = {
  taskList: () => call('query', 'taskList', undefined) as Promise<TaskView[]>,
  taskGet: (taskId: string) =>
    call('query', 'taskGet', { taskId }) as Promise<TaskView | null>,
  taskCreate: (input: {
    repoPath: string;
    title: string;
    intent: string;
    agentId?: string;
    baseRef?: string;
  }) => call('mutation', 'taskCreate', input) as Promise<{ taskId: string }>,
  taskLaunch: (taskId: string) =>
    call('mutation', 'taskLaunch', { taskId }) as Promise<{
      taskId: string;
      paneId: string;
      workspaceId: string;
    }>,
  taskSend: (taskId: string, text: string, wait: boolean) =>
    call('mutation', 'taskSend', { taskId, text, wait }) as Promise<{ ok: true }>,
  taskTranscript: (taskId: string, lines?: number) =>
    call('query', 'taskTranscript', { taskId, lines }) as Promise<{
      text: string;
      revision: number;
      truncated: boolean;
    }>,
  taskArchive: (taskId: string) =>
    call('mutation', 'taskArchive', { taskId }) as Promise<{ ok: true }>,
};
