import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';

import { TaskId, TaskStatus, TaskView, isNeedsYou } from '@osade/contract';

import type { Db } from '../db/index.js';
import { getTaskFacts, listTaskFacts } from '../db/task-repo.js';
import { deriveStatus } from '../domain/derive-status.js';
import type { LaunchTask } from '../domain/launch-task.js';

/**
 * The tRPC router — OSADE.md §5.5.
 *
 * Every procedure declares `.output()` with a contract schema, so the renderer's types are
 * derived rather than hand-written and nothing crosses the boundary untyped.
 */

export interface DaemonContext {
  db: Db;
  launcher: LaunchTask;
  now: () => number;
}

const t = initTRPC.context<DaemonContext>().create();

function viewFor(ctx: DaemonContext, taskId: string): TaskView | null {
  const facts = getTaskFacts(ctx.db, taskId);
  if (!facts) return null;
  // §6 — derived on every read. Never stored, never accepted from the client.
  const status = deriveStatus(facts, ctx.now());
  return {
    task: facts.task,
    status,
    agent: facts.agent,
    scm: facts.scm,
    openGates: facts.openGates,
    latestVerifyRuns: facts.verifyRuns,
    needsYou: isNeedsYou(status),
  };
}

/**
 * §19.3 — the ledger sorts needs-you first, then live, then everything else. Never by creation
 * time by default: with eight agents running, "who needs me?" is the only question.
 */
const SORT_RANK: Record<TaskStatus, number> = {
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

export const appRouter = t.router({
  health: t.procedure
    .output(z.object({ ok: z.literal(true), tasks: z.number().int() }))
    .query(({ ctx }) => ({
      ok: true as const,
      tasks: listTaskFacts(ctx.db).length,
    })),

  taskList: t.procedure.output(z.array(TaskView)).query(({ ctx }) => {
    const views = listTaskFacts(ctx.db)
      .map((f) => viewFor(ctx, f.task.id))
      .filter((v): v is TaskView => v != null);

    return views.sort((a, b) => {
      const rank = SORT_RANK[a.status] - SORT_RANK[b.status];
      if (rank !== 0) return rank;
      return b.task.created_at - a.task.created_at;
    });
  }),

  taskGet: t.procedure
    .input(z.object({ taskId: TaskId }))
    .output(TaskView.nullable())
    .query(({ ctx, input }) => viewFor(ctx, input.taskId)),

  taskCreate: t.procedure
    .input(
      z.object({
        repoPath: z.string().min(1),
        title: z.string().min(1),
        intent: z.string().min(1),
        agentId: z.string().optional(),
        baseRef: z.string().optional(),
      }),
    )
    .output(z.object({ taskId: TaskId }))
    .mutation(async ({ ctx, input }) => {
      const taskId = await ctx.launcher.createTask(input);
      return { taskId };
    }),

  /** Runs the §8.2 launch sequence. Long-running: worktree, lane, agent start. */
  taskLaunch: t.procedure
    .input(z.object({ taskId: TaskId }))
    .output(z.object({ taskId: TaskId, paneId: z.string(), workspaceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.launcher.launch(input.taskId);
      return { taskId: input.taskId, paneId: result.paneId, workspaceId: result.workspaceId };
    }),

  /** Sends a prompt into the task's agent lane. */
  taskSend: t.procedure
    .input(z.object({ taskId: TaskId, text: z.string().min(1), wait: z.boolean().optional() }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.launcher.prompt(input.taskId, input.text, input.wait ?? false);
      return { ok: true as const };
    }),

  /** Reads the agent pane transcript — §4.4.1. On demand, never a render loop. */
  taskTranscript: t.procedure
    .input(z.object({ taskId: TaskId, lines: z.number().int().min(1).max(1000).optional() }))
    .output(z.object({ text: z.string(), revision: z.number(), truncated: z.boolean() }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.launcher.readTranscript(input.taskId, input.lines ?? 200);
      if (!result) throw new TRPCError({ code: 'NOT_FOUND', message: 'task has no live pane' });
      return result;
    }),

  taskArchive: t.procedure
    .input(z.object({ taskId: TaskId }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(({ ctx, input }) => {
      ctx.db.prepare('UPDATE task SET archived_at = ? WHERE id = ?').run(ctx.now(), input.taskId);
      return { ok: true as const };
    }),
});

export type AppRouter = typeof appRouter;
