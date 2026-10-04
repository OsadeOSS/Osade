/**
 * The renderer's tRPC calls.
 *
 * OSADE.md §18.1 — INVARIANT: the renderer is never the source of truth. Everything here is a
 * *mutation* or an on-demand read; live state arrives on the websocket (`useLedger`), and the
 * renderer never computes status.
 */

import type { ConventionImpact, ConventionView, MineStatus, QuickNoteView } from '@osade/contract';

/** A standalone terminal's shell; `default` is PowerShell on Windows, $SHELL elsewhere. */
export type ShellKind = 'default' | 'powershell' | 'cmd' | 'gitbash';

let cachedBase: string | null = null;

async function base(): Promise<string> {
  if (cachedBase) return cachedBase;
  const port = await window.osade?.daemonPort();
  if (port == null) throw new Error('the osade daemon is not running');
  // §2.1 — loopback only.
  cachedBase = `http://127.0.0.1:${port}`;
  return cachedBase;
}

/**
 * What the Files and Changes panels read: a chat lane's checkout, or a project's own folder (for
 * a terminal tab, which has no task).
 */
export type WorkSource = { taskId: string } | { repoId: string };

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
  if (body.error) {
    const raw = body.error.json?.message ?? body.error.message ?? 'daemon error';
    const shown = humanizeDaemonError(raw);
    if (shown !== raw) window.osade?.log?.(raw);
    throw new Error(shown);
  }
  return body.result?.data;
}

/** tRPC/Zod dumps a JSON issue array as `error.message`. Never show that in the chrome. */
export function humanizeDaemonError(raw: string): string {
  const trimmed = raw.trim();
  if (/worktree\.create failed|worktree_create_failed/iu.test(trimmed)) {
    return 'could not create a worktree — see the terminal';
  }
  if (!trimmed.startsWith('[')) return raw;
  try {
    const issues = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(issues) || issues.length === 0) return raw;
    const issue = issues[0];
    if (!issue || typeof issue !== 'object') return raw;
    const row = issue as { code?: unknown; path?: unknown; message?: unknown };
    const path = Array.isArray(row.path)
      ? row.path.filter((part): part is string => typeof part === 'string').join('.')
      : '';
    if (row.code === 'too_small') return path ? `${path} is required` : 'a required value was empty';
    if (typeof row.message === 'string' && row.message.length > 0 && row.message.length < 120) {
      return path ? `${path}: ${row.message}` : row.message;
    }
  } catch {
    return raw;
  }
  return raw;
}

export interface Issue {
  number: number;
  title: string;
  body: string;
  url: string;
}

/** §12 — a triage task terminates in an artifact rather than a pull request. */
export type TriageKind =
  | 'reproduce'
  | 'bisect'
  | 'failing-test'
  | 'duplicate-check'
  | 'verify-pr-claim';

export interface PlanStep {
  name: string;
  cmd: string;
  cwd: string;
  timeoutSec: number;
  required: boolean;
  source: 'ci' | 'manifest' | 'doc' | 'user' | 'agent';
  evidence: string;
}

export const api = {
  /** §17 — the same call `osade .` makes. Idempotent, resolves to the repository root. */
  repoPath: (repoId: string) => call('query', 'repoPath', { repoId }) as Promise<{ path: string }>,
  repoOpen: (path: string) =>
    call('mutation', 'repoOpen', { path }) as Promise<{
      repoId: string;
      path: string;
      name: string;
      slug: string | null;
      defaultBranch: string;
      currentBranch: string;
      defaultAgent: string | null;
      taskCount: number;
    }>,

  repoSetDefaultAgent: (repoId: string, agentId: string) =>
    call('mutation', 'repoSetDefaultAgent', { repoId, agentId }) as Promise<{ ok: true }>,

  agentCatalogList: () =>
    call('query', 'agentCatalogList') as Promise<
      { id: string; displayName: string; installed: boolean }[]
    >,

  /** §8.2 — creating a task. Default is attached (no worktree). */
  taskCreate: (input: {
    repoPath: string;
    title: string;
    intent: string;
    agentId?: string;
    chatId?: string;
    baseRef?: string;
    checkoutRef?: string;
    isolate?: boolean;
    home?: boolean;
  }) =>
    call('mutation', 'taskCreate', input) as Promise<{
      taskId: string;
      isolated: boolean;
      isolatedBecause?: { taskId: string; chatId: string; title: string };
    }>,

  orchestratorOpen: (repoPath: string, agentId?: string) =>
    call('mutation', 'orchestratorOpen', { repoPath, agentId }) as Promise<{
      taskId: string;
      chatId: string;
      isolated: false;
    }>,

  /** §8.2 — the launch sequence. Long-running: worktree, lane, agent start. */
  taskLaunch: (taskId: string) =>
    call('mutation', 'taskLaunch', { taskId }) as Promise<{
      taskId: string;
      paneId: string;
      workspaceId: string;
    }>,

  mineStatus: (repoId: string) =>
    call('query', 'mineStatus', { repoId }) as Promise<MineStatus>,

  repoRulesGet: (repoId: string) =>
    call('query', 'repoRulesGet', { repoId }) as Promise<{ text: string; path: string }>,

  repoRulesSave: (repoId: string, text: string) =>
    call('mutation', 'repoRulesSave', { repoId, text }) as Promise<{ ok: true }>,

  /** Starts a background run and returns at once; poll `mineStatus` for progress. */
  mineRepo: (repoId: string, full?: boolean) =>
    call('mutation', 'mineRepo', { repoId, full }) as Promise<{ runId: string }>,

  conventionList: (repoId: string) =>
    call('query', 'conventionList', { repoId }) as Promise<ConventionView[]>,

  conventionConfirm: (id: string) =>
    call('mutation', 'conventionConfirm', { id }) as Promise<{ confirmed: boolean }>,

  conventionReject: (id: string, reason: string) =>
    call('mutation', 'conventionReject', { id, reason }) as Promise<{ ok: true }>,

  conventionImpact: (repoId: string) =>
    call('query', 'conventionImpact', { repoId }) as Promise<ConventionImpact>,

  /**
   * Quick notes — issue #19. Repo-scoped, so read on demand rather than streamed: a note belongs
   * to no task and `useLedger` only carries tasks. Every write is followed by a `noteList`, never
   * by a local patch — §18.1, the renderer renders what the daemon says.
   */
  noteList: (repoId: string) =>
    call('query', 'noteList', { repoId }) as Promise<QuickNoteView[]>,

  noteListOpen: (repoId: string) =>
    call('query', 'noteListOpen', { repoId }) as Promise<QuickNoteView[]>,

  noteForFile: (repoId: string, file: string) =>
    call('query', 'noteForFile', { repoId, file }) as Promise<QuickNoteView | null>,

  noteCreate: (input: {
    repoId: string;
    text: string;
    file?: string | null;
    line?: number | null;
  }) => call('mutation', 'noteCreate', input) as Promise<QuickNoteView>,

  noteResolve: (id: string, resolved: boolean) =>
    call('mutation', 'noteResolve', { id, resolved }) as Promise<{ ok: true }>,

  noteEdit: (id: string, text: string) =>
    call('mutation', 'noteEdit', { id, text }) as Promise<{ ok: true }>,

  noteDelete: (id: string) =>
    call('mutation', 'noteDelete', { id }) as Promise<{ ok: true }>,

  gateDecide: (gateId: string, decision: 'approve' | 'deny') =>
    call('mutation', 'gateDecide', { gateId, decision }) as Promise<{ ok: true }>,

  gateEditAndApprove: (gateId: string, payload: unknown) =>
    call('mutation', 'gateEditAndApprove', { gateId, payload }) as Promise<{ ok: true }>,

  verifyPlanGet: (taskId: string) =>
    call('query', 'verifyPlanGet', { taskId }) as Promise<{
      steps: PlanStep[];
      needsReview: boolean;
    } | null>,

  verifyPlanDerive: (taskId: string) =>
    call('mutation', 'verifyPlanDerive', { taskId }) as Promise<{
      steps: PlanStep[];
      needsReview: boolean;
    }>,

  verifyPlanConfirm: (taskId: string, steps?: PlanStep[]) =>
    call('mutation', 'verifyPlanConfirm', { taskId, steps }) as Promise<{ ok: true }>,

  verifyRun: (taskId: string) =>
    call('mutation', 'verifyRun', { taskId }) as Promise<{ passed: boolean; headSha: string }>,

  verifyRunLog: (runId: string) =>
    call('query', 'verifyRunLog', { runId }) as Promise<{ text: string }>,

  issueList: (repoId: string) => call('query', 'issueList', { repoId }) as Promise<Issue[]>,

  issueImport: (repoPath: string, issue: Issue, triage?: TriageKind) =>
    call('mutation', 'issueImport', { repoPath, issue, triage }) as Promise<{ taskId: string }>,

  prPlan: (taskId: string) =>
    call('query', 'prPlan', { taskId }) as Promise<{
      viaFork: boolean;
      head: string;
      target: string;
      base: string;
      title: string;
      body: string;
    }>,

  prOpenRequest: (taskId: string, title: string, body: string, draft?: boolean) =>
    call('mutation', 'prOpenRequest', { taskId, title, body, draft }) as Promise<{
      gateId: string;
    }>,

  scmRefresh: (taskId: string) =>
    call('mutation', 'scmRefresh', { taskId }) as Promise<{ refreshed: boolean }>,

  /** Sends a prompt into the task's agent lane. State arrives through useLedger. */
  taskSend: (taskId: string, text: string, wait?: boolean) =>
    call('mutation', 'taskSend', { taskId, text, wait }) as Promise<{ ok: true }>,

  chatContextAdd: (chatId: string, path: string) =>
    call('mutation', 'chatContextAdd', { chatId, path }) as Promise<{
      repoId: string;
      path: string;
      name: string;
      remote: string | null;
      branch: string;
      access: 'read' | 'edit';
    }>,

  chatContextRemove: (chatId: string, repoId: string) =>
    call('mutation', 'chatContextRemove', { chatId, repoId }) as Promise<{ ok: true }>,

  taskDropImages: (
    taskId: string,
    files: { name: string; mime: string; data: string }[],
  ) =>
    call('mutation', 'taskDropImages', { taskId, files }) as Promise<{ paths: string[] }>,

  /** §4.4.1 — on-demand pane.read, never a render loop. */
  taskTranscript: (taskId: string, lines?: number) =>
    call('query', 'taskTranscript', { taskId, lines }) as Promise<{
      text: string;
      revision: number;
      truncated: boolean;
    }>,

  taskShellOpen: (taskId: string, size?: { cols: number; rows: number }) =>
    call('mutation', 'taskShellOpen', { taskId, ...size }) as Promise<{ cwd: string; replay: string }>,
  taskShellRead: (taskId: string) =>
    call('query', 'taskShellRead', { taskId }) as Promise<{ text: string }>,
  taskShellWrite: (taskId: string, data: string) =>
    call('mutation', 'taskShellWrite', { taskId, data }) as Promise<{ ok: true }>,
  taskShellResize: (taskId: string, cols: number, rows: number) =>
    call('mutation', 'taskShellResize', { taskId, cols, rows }) as Promise<{ ok: true }>,

  terminalShells: () =>
    call('query', 'terminalShells') as Promise<{ kind: ShellKind; label: string }[]>,
  terminalOpen: (id: string, cwd: string, shell: ShellKind, size?: { cols: number; rows: number }) =>
    call('mutation', 'terminalOpen', { id, cwd, shell, ...size }) as Promise<{ cwd: string; replay: string }>,
  terminalRead: (id: string) => call('query', 'terminalRead', { id }) as Promise<{ text: string }>,
  terminalWrite: (id: string, data: string) =>
    call('mutation', 'terminalWrite', { id, data }) as Promise<{ ok: true }>,
  terminalResize: (id: string, cols: number, rows: number) =>
    call('mutation', 'terminalResize', { id, cols, rows }) as Promise<{ ok: true }>,
  terminalAgents: () =>
    call('query', 'terminalAgents') as Promise<{ id: string; agent: string; name: string }[]>,
  terminalClose: (id: string) => call('mutation', 'terminalClose', { id }) as Promise<{ ok: true }>,

  taskFsList: (source: WorkSource, dirs?: string[]) =>
    call('query', 'taskFsList', { ...source, dirs }) as Promise<{
      cwd: string;
      listings: {
        dir: string;
        entries: {
          name: string;
          path: string;
          kind: 'dir' | 'file';
          flag: 'M' | 'A' | 'D' | '?' | null;
          insertions: number;
          deletions: number;
        }[];
      }[];
    }>,

  taskFsRead: (source: WorkSource, path: string) =>
    call('query', 'taskFsRead', { ...source, path }) as Promise<{
      path: string;
      text: string | null;
      binary: boolean;
      truncated: boolean;
    }>,

  taskFsWrite: (source: WorkSource, path: string, text: string) =>
    call('mutation', 'taskFsWrite', { ...source, path, text }) as Promise<{ path: string; bytes: number }>,

  taskChangesList: (source: WorkSource) =>
    call('query', 'taskChangesList', source) as Promise<{
      files: {
        path: string;
        flag: 'M' | 'A' | 'D' | '?';
        insertions: number;
        deletions: number;
      }[];
      outgoing: {
        ahead: number;
        commits: { sha: string; subject: string }[];
        files: {
          path: string;
          flag: 'M' | 'A' | 'D' | '?';
          insertions: number;
          deletions: number;
        }[];
      } | null;
    }>,

  taskChangesDiff: (source: WorkSource, path: string, vs: 'working' | 'outgoing') =>
    call('query', 'taskChangesDiff', { ...source, path, vs }) as Promise<{
      path: string;
      flag: 'M' | 'A' | 'D' | '?' | null;
      diff: string;
    }>,

  /** Hides the task from the ledger. Does not kill the agent process. */
  taskArchive: (taskId: string) =>
    call('mutation', 'taskArchive', { taskId }) as Promise<{ ok: true }>,

  taskRetitle: (taskId: string, title: string) =>
    call('mutation', 'taskRetitle', { taskId, title }) as Promise<{ ok: true }>,

  taskBranchOut: (input: { taskId: string; branch?: string; carryChanges: boolean }) =>
    call('mutation', 'taskBranchOut', input) as Promise<{
      worktreePath: string;
      branch: string;
      stashKept?: string;
    }>,

  taskSwitchBranch: (taskId: string, branch: string) =>
    call('mutation', 'taskSwitchBranch', { taskId, branch }) as Promise<{ gateId: string }>,

  repoStatus: (repoId: string) =>
    call('query', 'repoStatus', { repoId }) as Promise<{
      branch: string;
      dirty: boolean;
      ahead: number | null;
      behind: number | null;
    }>,

  repoBranchList: (repoId: string) =>
    call('query', 'repoBranchList', { repoId }) as Promise<string[]>,

  repoBranchHolders: (repoId: string) =>
    call('query', 'repoBranchHolders', { repoId }) as Promise<
      { branch: string; path: string; holder: { taskId: string; chatId: string; title: string } | null }[]
    >,

  taskMoveBranch: (taskId: string, checkoutRef: string) =>
    call('mutation', 'taskMoveBranch', { taskId, checkoutRef }) as Promise<{
      taskId: string;
      isolated: boolean;
      isolatedBecause?: { taskId: string; chatId: string; title: string };
    }>,
};
