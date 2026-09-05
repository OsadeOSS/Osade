/**
 * The renderer's tRPC calls.
 *
 * OSADE.md §18.1 — INVARIANT: the renderer is never the source of truth. Everything here is a
 * *mutation* or an on-demand read; live state arrives on the websocket (`useLedger`), and the
 * renderer never computes status.
 */

let cachedBase: string | null = null;

async function base(): Promise<string> {
  if (cachedBase) return cachedBase;
  const port = await window.osade?.daemonPort();
  if (port == null) throw new Error('the osade daemon is not running');
  // §2.1 — loopback only.
  cachedBase = `http://127.0.0.1:${port}`;
  return cachedBase;
}

async function call(kind: 'query' | 'mutation', path: string, input?: unknown): Promise<unknown> {
  const root = await base();
  const url =
    kind === 'query'
      ? `${root}/${path}${input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`}`
      : `${root}/${path}`;

  const response = await fetch(url, {
    method: kind === 'query' ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    ...(kind === 'mutation' ? { body: JSON.stringify(input ?? {}) } : {}),
  });

  const body = (await response.json()) as {
    result?: { data?: unknown };
    error?: { message?: string; json?: { message?: string } };
  };
  if (body.error) throw new Error(body.error.json?.message ?? body.error.message ?? 'daemon error');
  return body.result?.data;
}

export interface PlanStep {
  name: string;
  cmd: string;
  cwd: string;
  timeoutSec: number;
  required: boolean;
  source: 'ci' | 'manifest' | 'doc' | 'user';
  evidence: string;
}

export const api = {
  gateDecide: (gateId: string, decision: 'approve' | 'deny') =>
    call('mutation', 'gateDecide', { gateId, decision }) as Promise<{ ok: true }>,

  gateEditAndApprove: (gateId: string, payload: unknown) =>
    call('mutation', 'gateEditAndApprove', { gateId, payload }) as Promise<{ ok: true }>,

  verifyPlanDerive: (taskId: string) =>
    call('mutation', 'verifyPlanDerive', { taskId }) as Promise<{
      steps: PlanStep[];
      needsReview: boolean;
    }>,

  verifyPlanConfirm: (taskId: string, steps?: PlanStep[]) =>
    call('mutation', 'verifyPlanConfirm', { taskId, steps }) as Promise<{ ok: true }>,

  verifyRun: (taskId: string) =>
    call('mutation', 'verifyRun', { taskId }) as Promise<{ passed: boolean; headSha: string }>,

  taskTranscript: (taskId: string, lines = 200) =>
    call('query', 'taskTranscript', { taskId, lines }) as Promise<{
      text: string;
      revision: number;
      truncated: boolean;
    }>,
};
