import { z } from 'zod';

import {
  AgentEvent,
  ChecksState,
  GateDecision,
  HerdrAgentStatus,
  HerdrPaneId,
  HerdrWorkspaceId,
  PrState,
  RepoId,
  ReviewState,
  TaskId,
  TaskOriginKind,
  Timestamp,
} from './primitives.js';

/**
 * OSADE.md §5.2 — INVARIANT: these are the only durable truth. Nothing display-shaped is ever
 * stored, and there is no `status` field anywhere below. Status is a pure function over these
 * rows, recomputed at read time (§6).
 */

export const Task = z.object({
  id: TaskId,
  repo_id: RepoId,
  title: z.string(),
  intent: z.string(),
  origin_kind: TaskOriginKind,
  origin_ref: z.string().nullable(),
  agent_id: z.string().nullable(),
  base_ref: z.string(),
  base_sha: z.string(),
  branch: z.string(),
  worktree_path: z.string(),
  /** Null until herdr has adopted the worktree. */
  herdr_workspace_id: HerdrWorkspaceId.nullable(),
  archived_at: Timestamp.nullable(),
  created_at: Timestamp,
});
export type Task = z.infer<typeof Task>;

export const AgentFact = z.object({
  task_id: TaskId,
  /** The subscription key for this task's agent lane (§7.2). */
  herdr_pane_id: HerdrPaneId.nullable(),
  herdr_state: HerdrAgentStatus.nullable(),
  last_event: AgentEvent.nullable(),
  last_event_at: Timestamp.nullable(),
  /** From `AgentInfo.terminal_title_stripped`. Display only. */
  activity_text: z.string().nullable(),
  /** No source for claude or codex — see §7.1. */
  tool_name: z.string().nullable(),
  /** No source for claude or codex — see §7.1. */
  final_message: z.string().nullable(),
  /** From `AgentInfo.agent_session`, for resume after a herdr restart (§8.2.1). */
  agent_session_id: z.string().nullable(),
  pane_alive: z.boolean(),
  last_probe_at: Timestamp.nullable(),
  /**
   * §5.2 — INVARIANT: a failed probe is a fact, not a death certificate. This never by itself
   * marks a task terminated; it surfaces as a degraded-confidence badge and nothing else.
   */
  probe_failures: z.number().int().nonnegative(),
  /** Set only by an explicit process exit or an explicit user action. Never inferred. */
  terminated: z.boolean(),
  /**
   * §5.4.1 — INVARIANT: the monotonic write gate. herdr's event stream replays on connect and
   * can drop silently, and its envelopes carry no sequence number, so every write is gated on
   * this being strictly greater than what is stored.
   */
  state_change_seq: z.number().int().nonnegative(),
  controller_generation: z.number().int().nonnegative(),
});
export type AgentFact = z.infer<typeof AgentFact>;

export const VerifyRun = z.object({
  id: z.string(),
  task_id: TaskId,
  step_name: z.string(),
  cmd: z.string(),
  started_at: Timestamp,
  finished_at: Timestamp.nullable(),
  exit_code: z.number().int().nullable(),
  required: z.boolean(),
  /** §6 — `verify_failed` is scoped to this. A failure against an older commit is stale. */
  head_sha: z.string(),
  log_path: z.string(),
});
export type VerifyRun = z.infer<typeof VerifyRun>;

export const GateRequest = z.object({
  id: z.string(),
  task_id: TaskId,
  gate: z.string(),
  payload_json: z.string(),
  /** sha256, re-checked at execution time so an approval cannot be replayed against new text. */
  payload_hash: z.string(),
  requested_at: Timestamp,
  decided_at: Timestamp.nullable(),
  decision: GateDecision.nullable(),
  decided_by: z.string().nullable(),
  executed_at: Timestamp.nullable(),
  execution_error: z.string().nullable(),
});
export type GateRequest = z.infer<typeof GateRequest>;

export const ScmFact = z.object({
  task_id: TaskId,
  pr_number: z.number().int().nullable(),
  pr_url: z.string().nullable(),
  pr_state: PrState.nullable(),
  pr_head_sha: z.string().nullable(),
  pr_draft: z.boolean().nullable(),
  checks_state: ChecksState.nullable(),
  review_state: ReviewState.nullable(),
  unresolved_threads: z.number().int().nonnegative(),
  mergeable: z.enum(['clean', 'dirty', 'blocked', 'unknown']).nullable(),
  fetched_at: Timestamp,
  /** §11.1 — INVARIANT: a failed fetch is a fact, not a state change. */
  fetch_failed_at: Timestamp.nullable(),
});
export type ScmFact = z.infer<typeof ScmFact>;

/**
 * The complete fact set for one task — the sole input to `deriveStatus` (§6).
 *
 * Deliberately a plain aggregate with no methods and no clock: the deriving function is pure,
 * takes `now` injected, and is fully unit-testable.
 */
export const TaskFacts = z.object({
  task: Task,
  agent: AgentFact.nullable(),
  scm: ScmFact.nullable(),
  /** Undecided gate requests only; presence alone drives §6 row 3. */
  openGates: z.array(GateRequest),
  /** Verify runs for the task's current head. Older runs are stale and must not gate. */
  verifyRuns: z.array(VerifyRun),
});
export type TaskFacts = z.infer<typeof TaskFacts>;
