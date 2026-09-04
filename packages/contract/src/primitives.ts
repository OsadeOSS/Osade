import { z } from 'zod';

/**
 * Shared primitives. OSADE.md §5.5 — everything crossing a process boundary is declared here,
 * so renderer and CLI types are derived rather than hand-written.
 */

/** Milliseconds since the epoch. Every timestamp in Osade is an integer, never a Date. */
export const Timestamp = z.number().int();
export type Timestamp = z.infer<typeof Timestamp>;

export const TaskId = z.string().min(1);
export type TaskId = z.infer<typeof TaskId>;

export const RepoId = z.string().min(1);
export type RepoId = z.infer<typeof RepoId>;

export const OrgId = z.string().min(1);
export type OrgId = z.infer<typeof OrgId>;

/**
 * herdr's public workspace id, e.g. `w3`.
 *
 * OSADE.md §5.2 — a durable key, stable across other workspaces closing and across a herdr
 * restart. Always the full `wN` form: `parse_workspace_id` has a positional fallback for bare
 * integers, so sending `"3"` can resolve to a different workspace.
 */
export const HerdrWorkspaceId = z.string().regex(/^w\d+$/, 'expected herdr workspace id like w3');
export type HerdrWorkspaceId = z.infer<typeof HerdrWorkspaceId>;

/** herdr's public tab id, e.g. `w3:t2`. */
export const HerdrTabId = z.string().regex(/^w\d+:t\d+$/, 'expected herdr tab id like w3:t2');
export type HerdrTabId = z.infer<typeof HerdrTabId>;

/** herdr's public pane id, e.g. `w3:p2`. The key for a status subscription (§7.2). */
export const HerdrPaneId = z.string().regex(/^w\d+:p\d+$/, 'expected herdr pane id like w3:p2');
export type HerdrPaneId = z.infer<typeof HerdrPaneId>;

/**
 * herdr's `AgentStatus`, verbatim from the pinned schema.
 *
 * `done` and `idle` are not interchangeable: herdr reports `done` when a pane is idle **and
 * unseen**, `idle` once it has been seen. See OSADE.md §6.1.
 */
export const HerdrAgentStatus = z.enum(['idle', 'working', 'blocked', 'done', 'unknown']);
export type HerdrAgentStatus = z.infer<typeof HerdrAgentStatus>;

/**
 * OSADE.md §6.1 — INVARIANT: exactly three internal agent events. Adding a fourth requires
 * changing the spec first.
 */
export const AgentEvent = z.enum(['to_in_progress', 'to_review', 'activity']);
export type AgentEvent = z.infer<typeof AgentEvent>;

/** OSADE.md §6 — derived, never stored. Present here only as a wire type. */
export const TaskStatus = z.enum([
  'merged',
  'archived',
  'awaiting_approval',
  'needs_input',
  'review_changes_requested',
  'ci_failed',
  'verify_failed',
  'verifying',
  'pr_open',
  'awaiting_review',
  'implementing',
  'stopped',
  'queued',
  'idle',
]);
export type TaskStatus = z.infer<typeof TaskStatus>;

/**
 * The needs-you set — OSADE.md §6, rows 3–5 and 10. The ledger sorts on this, and it is the
 * entire product for someone running eight agents.
 */
export const NEEDS_YOU: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  'awaiting_approval',
  'needs_input',
  'review_changes_requested',
  'awaiting_review',
]);

export function isNeedsYou(status: TaskStatus): boolean {
  return NEEDS_YOU.has(status);
}

export const TaskOriginKind = z.enum(['issue', 'manual', 'triage', 'followup']);
export type TaskOriginKind = z.infer<typeof TaskOriginKind>;

export const PrState = z.enum(['open', 'closed', 'merged']);
export type PrState = z.infer<typeof PrState>;

export const ChecksState = z.enum(['pending', 'success', 'failure', 'neutral']);
export type ChecksState = z.infer<typeof ChecksState>;

export const ReviewState = z.enum(['none', 'commented', 'changes_requested', 'approved']);
export type ReviewState = z.infer<typeof ReviewState>;

export const GateDecision = z.enum(['approve', 'deny', 'expired']);
export type GateDecision = z.infer<typeof GateDecision>;
