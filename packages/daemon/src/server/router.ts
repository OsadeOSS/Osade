import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';

import { TaskId, TaskStatus, TaskView, isNeedsYou } from '@osade/contract';

import type { Db } from '../db/index.js';
import { getTask, getTaskFacts, listTaskFacts } from '../db/task-repo.js';
import { deriveStatus } from '../domain/derive-status.js';
import type { Gates } from '../domain/gates.js';
import type { LaunchTask } from '../domain/launch-task.js';
import { deriveVerifyPlan, type VerifyStep } from '../domain/verify-plan.js';
import type { VerifyRunner } from '../domain/verify-run.js';

/**
 * The tRPC router — OSADE.md §5.5.
 *
 * Every procedure declares `.output()` with a contract schema, so the renderer's types are
 * derived rather than hand-written and nothing crosses the boundary untyped.
 */

export interface DaemonContext {
  db: Db;
  launcher: LaunchTask;
  gates: Gates;
  verifier: VerifyRunner;
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

  // ── verification (§10) ───────────────────────────────────────────────────

  /** Derives a plan and stores it. §10.1 — shown to the user before first use. */
  verifyPlanDerive: t.procedure
    .input(z.object({ taskId: TaskId }))
    .output(
      z.object({
        steps: z.array(
          z.object({
            name: z.string(),
            cmd: z.string(),
            cwd: z.string(),
            timeoutSec: z.number(),
            required: z.boolean(),
            source: z.enum(['ci', 'manifest', 'doc', 'user']),
            evidence: z.string(),
          }),
        ),
        needsReview: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const task = getTask(ctx.db, input.taskId);
      if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'unknown task' });
      const repo = ctx.db.prepare('SELECT path FROM repo WHERE id = ?').get(task.repo_id) as {
        path: string;
      };

      const plan = await deriveVerifyPlan(repo.path);
      ctx.db
        .prepare(
          `INSERT INTO verify_plan (repo_id, steps_json, needs_review, derived_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(repo_id) DO UPDATE SET steps_json = excluded.steps_json,
                                              needs_review = excluded.needs_review,
                                              derived_at = excluded.derived_at`,
        )
        .run(task.repo_id, JSON.stringify(plan.steps), plan.needsReview ? 1 : 0, ctx.now());
      return plan;
    }),

  /** §10.1 — the user confirms (or edits) the plan. Only then may it run. */
  verifyPlanConfirm: t.procedure
    .input(z.object({ taskId: TaskId, steps: z.array(z.unknown()).optional() }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(({ ctx, input }) => {
      const task = getTask(ctx.db, input.taskId);
      if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'unknown task' });
      if (input.steps) {
        ctx.db
          .prepare('UPDATE verify_plan SET steps_json = ? WHERE repo_id = ?')
          .run(JSON.stringify(input.steps), task.repo_id);
      }
      ctx.db
        .prepare('UPDATE verify_plan SET needs_review = 0, confirmed_at = ? WHERE repo_id = ?')
        .run(ctx.now(), task.repo_id);
      return { ok: true as const };
    }),

  verifyRun: t.procedure
    .input(z.object({ taskId: TaskId }))
    .output(z.object({ passed: z.boolean(), headSha: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const task = getTask(ctx.db, input.taskId);
      if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'unknown task' });

      const stored = ctx.db
        .prepare('SELECT steps_json, needs_review FROM verify_plan WHERE repo_id = ?')
        .get(task.repo_id) as { steps_json: string; needs_review: number } | undefined;
      if (!stored) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'no verification plan yet' });
      }

      const plan = {
        steps: JSON.parse(stored.steps_json) as VerifyStep[],
        needsReview: stored.needs_review === 1,
      };
      const facts = getTaskFacts(ctx.db, input.taskId)!;
      const head = facts.scm?.pr_head_sha ?? task.base_sha;

      const report = await ctx.verifier.run(input.taskId, plan, head);
      return { passed: report.passed, headSha: report.headSha };
    }),

  // ── gates (§14) ──────────────────────────────────────────────────────────

  gateDecide: t.procedure
    .input(z.object({ gateId: z.string(), decision: z.enum(['approve', 'deny']) }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(({ ctx, input }) => {
      try {
        ctx.gates.decide(input.gateId, input.decision);
      } catch (err) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: (err as Error).message });
      }
      return { ok: true as const };
    }),

  /** §14.2 — editing rewrites the payload and re-hashes, so the edit is what is bound. */
  gateEditAndApprove: t.procedure
    .input(z.object({ gateId: z.string(), payload: z.unknown() }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(({ ctx, input }) => {
      try {
        ctx.gates.editAndApprove(input.gateId, input.payload);
      } catch (err) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: (err as Error).message });
      }
      return { ok: true as const };
    }),
});

export type AppRouter = typeof appRouter;
