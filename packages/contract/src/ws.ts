import { z } from 'zod';

import { AgentFact, GateRequest, ScmFact, Task, VerifyRun } from './facts.js';
import { TaskId, TaskStatus, Timestamp } from './primitives.js';

/**
 * The daemon → renderer websocket protocol.
 *
 * OSADE.md §5.4 — INVARIANT: one event path. Every message below originates from a row landing
 * in `change_log`, decoded by the CDC poller and fanned out by `server/cdc-broadcaster.ts`. No
 * service emits a websocket message directly. If the UI did not update, the mutation did not go
 * through the database — that is the bug, and it is not fixed by emitting here.
 *
 * Clients receive one `snapshot` on connect, then a discriminated union of pushes. The client
 * never polls, and on reconnect it discards local state and takes a fresh snapshot (§18.1).
 */

/**
 * A task as the ledger renders it: durable facts plus the status derived from them.
 *
 * `status` appears on the wire and **never** in the database (§6). It is recomputed on every
 * read. If you find yourself wanting to persist it to index on it, index the facts instead.
 */
export const TaskView = z.object({
  task: Task,
  status: TaskStatus,
  agent: AgentFact.nullable(),
  scm: ScmFact.nullable(),
  openGates: z.array(GateRequest),
  latestVerifyRuns: z.array(VerifyRun),
  /** True when `status` is in the needs-you set. Derived; here so the client need not know §6. */
  needsYou: z.boolean(),
});
export type TaskView = z.infer<typeof TaskView>;

/** Monotonic per-connection cursor, so a client can tell a gap from a reorder. */
export const Watermark = z.number().int().nonnegative();
export type Watermark = z.infer<typeof Watermark>;

export const ServerSnapshot = z.object({
  type: z.literal('snapshot'),
  /** `change_log.seq` this snapshot was taken at. Subsequent pushes are strictly after it. */
  watermark: Watermark,
  at: Timestamp,
  tasks: z.array(TaskView),
});
export type ServerSnapshot = z.infer<typeof ServerSnapshot>;

export const TaskUpserted = z.object({
  type: z.literal('task.upserted'),
  watermark: Watermark,
  task: TaskView,
});
export type TaskUpserted = z.infer<typeof TaskUpserted>;

export const TaskRemoved = z.object({
  type: z.literal('task.removed'),
  watermark: Watermark,
  taskId: TaskId,
});
export type TaskRemoved = z.infer<typeof TaskRemoved>;

/**
 * The CDC poller fell behind or the client's watermark is older than retention. The client must
 * discard local state and take a fresh snapshot. Cheaper to say so than to lie by omission.
 */
export const StreamReset = z.object({
  type: z.literal('stream.reset'),
  watermark: Watermark,
  reason: z.enum(['watermark_pruned', 'poller_restarted']),
});
export type StreamReset = z.infer<typeof StreamReset>;

export const ServerMessage = z.discriminatedUnion('type', [
  ServerSnapshot,
  TaskUpserted,
  TaskRemoved,
  StreamReset,
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

/** Client → daemon. Minimal in M0: the client subscribes and otherwise mutates over tRPC. */
export const ClientHello = z.object({
  type: z.literal('hello'),
  /** Resume from a known point, or omit for a full snapshot. */
  since: Watermark.optional(),
});
export type ClientHello = z.infer<typeof ClientHello>;

export const ClientMessage = z.discriminatedUnion('type', [ClientHello]);
export type ClientMessage = z.infer<typeof ClientMessage>;
