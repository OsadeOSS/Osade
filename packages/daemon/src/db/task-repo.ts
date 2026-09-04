import type {
  AgentFact,
  GateRequest,
  ScmFact,
  Task,
  TaskFacts,
  VerifyRun,
} from '@osade/contract';

import type { Db } from './index.js';

/**
 * Reads facts out of sqlite and back into contract shapes.
 *
 * sqlite has no booleans, so every `INTEGER NOT NULL DEFAULT 0` flag is converted here rather
 * than at call sites. Getting this wrong is how `terminated: 0` becomes truthy.
 */

const int2bool = (v: unknown): boolean => v === 1 || v === true;
const nullableBool = (v: unknown): boolean | null => (v == null ? null : int2bool(v));

export function getTask(db: Db, taskId: string): Task | null {
  const row = db.prepare('SELECT * FROM task WHERE id = ?').get(taskId) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToTask(row) : null;
}

export function listTasks(db: Db): Task[] {
  const rows = db.prepare('SELECT * FROM task ORDER BY created_at DESC').all() as Record<
    string,
    unknown
  >[];
  return rows.map(rowToTask);
}

function rowToTask(r: Record<string, unknown>): Task {
  return {
    id: r.id as string,
    repo_id: r.repo_id as string,
    title: r.title as string,
    intent: r.intent as string,
    origin_kind: r.origin_kind as Task['origin_kind'],
    origin_ref: (r.origin_ref as string | null) ?? null,
    agent_id: (r.agent_id as string | null) ?? null,
    base_ref: r.base_ref as string,
    base_sha: r.base_sha as string,
    branch: r.branch as string,
    worktree_path: r.worktree_path as string,
    herdr_workspace_id: (r.herdr_workspace_id as string | null) ?? null,
    archived_at: (r.archived_at as number | null) ?? null,
    created_at: r.created_at as number,
  };
}

export function getAgentFact(db: Db, taskId: string): AgentFact | null {
  const r = db.prepare('SELECT * FROM agent_fact WHERE task_id = ?').get(taskId) as
    | Record<string, unknown>
    | undefined;
  if (!r) return null;
  return {
    task_id: r.task_id as string,
    herdr_pane_id: (r.herdr_pane_id as string | null) ?? null,
    herdr_state: (r.herdr_state as AgentFact['herdr_state']) ?? null,
    last_event: (r.last_event as AgentFact['last_event']) ?? null,
    last_event_at: (r.last_event_at as number | null) ?? null,
    activity_text: (r.activity_text as string | null) ?? null,
    tool_name: (r.tool_name as string | null) ?? null,
    final_message: (r.final_message as string | null) ?? null,
    agent_session_id: (r.agent_session_id as string | null) ?? null,
    pane_alive: int2bool(r.pane_alive),
    last_probe_at: (r.last_probe_at as number | null) ?? null,
    probe_failures: r.probe_failures as number,
    terminated: int2bool(r.terminated),
    state_change_seq: r.state_change_seq as number,
    controller_generation: r.controller_generation as number,
  };
}

export function getScmFact(db: Db, taskId: string): ScmFact | null {
  const r = db.prepare('SELECT * FROM scm_fact WHERE task_id = ?').get(taskId) as
    | Record<string, unknown>
    | undefined;
  if (!r) return null;
  return {
    task_id: r.task_id as string,
    pr_number: (r.pr_number as number | null) ?? null,
    pr_url: (r.pr_url as string | null) ?? null,
    pr_state: (r.pr_state as ScmFact['pr_state']) ?? null,
    pr_head_sha: (r.pr_head_sha as string | null) ?? null,
    pr_draft: nullableBool(r.pr_draft),
    checks_state: (r.checks_state as ScmFact['checks_state']) ?? null,
    review_state: (r.review_state as ScmFact['review_state']) ?? null,
    unresolved_threads: r.unresolved_threads as number,
    mergeable: (r.mergeable as ScmFact['mergeable']) ?? null,
    fetched_at: r.fetched_at as number,
    fetch_failed_at: (r.fetch_failed_at as number | null) ?? null,
  };
}

/** Undecided gates only — §6 row 3 keys on presence, not on content. */
export function getOpenGates(db: Db, taskId: string): GateRequest[] {
  const rows = db
    .prepare('SELECT * FROM gate_request WHERE task_id = ? AND decided_at IS NULL')
    .all(taskId) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as string,
    task_id: r.task_id as string,
    gate: r.gate as string,
    payload_json: r.payload_json as string,
    payload_hash: r.payload_hash as string,
    requested_at: r.requested_at as number,
    decided_at: (r.decided_at as number | null) ?? null,
    decision: (r.decision as GateRequest['decision']) ?? null,
    decided_by: (r.decided_by as string | null) ?? null,
    executed_at: (r.executed_at as number | null) ?? null,
    execution_error: (r.execution_error as string | null) ?? null,
  }));
}

/**
 * Runs for the task's current head only.
 *
 * §6 — a verify failure against an older commit is stale and must not gate, so the scoping
 * happens here rather than in `deriveStatus`, which stays pure over what it is handed.
 */
export function getVerifyRunsForHead(db: Db, taskId: string, headSha: string): VerifyRun[] {
  const rows = db
    .prepare('SELECT * FROM verify_run WHERE task_id = ? AND head_sha = ? ORDER BY started_at')
    .all(taskId, headSha) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as string,
    task_id: r.task_id as string,
    step_name: r.step_name as string,
    cmd: r.cmd as string,
    started_at: r.started_at as number,
    finished_at: (r.finished_at as number | null) ?? null,
    exit_code: (r.exit_code as number | null) ?? null,
    required: int2bool(r.required),
    head_sha: r.head_sha as string,
    log_path: r.log_path as string,
  }));
}

/** Assembles the complete fact set for one task — the sole input to `deriveStatus`. */
export function getTaskFacts(db: Db, taskId: string): TaskFacts | null {
  const task = getTask(db, taskId);
  if (!task) return null;
  const scm = getScmFact(db, taskId);
  const head = scm?.pr_head_sha ?? task.base_sha;
  return {
    task,
    agent: getAgentFact(db, taskId),
    scm,
    openGates: getOpenGates(db, taskId),
    verifyRuns: getVerifyRunsForHead(db, taskId, head),
  };
}

export function listTaskFacts(db: Db): TaskFacts[] {
  const out: TaskFacts[] = [];
  for (const task of listTasks(db)) {
    const facts = getTaskFacts(db, task.id);
    if (facts) out.push(facts);
  }
  return out;
}
