import { existsSync, statSync } from 'node:fs';
import { basename } from 'node:path';

import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  ConventionImpact,
  ConventionView,
  MineStatus,
  QuickNoteView,
  TaskId,
  TaskStatus,
  TaskView,
} from '@osade/contract';

import type { Db } from '../db/index.js';
import { getTask, getTaskFacts, listTaskFacts } from '../db/task-repo.js';
import {
  AGENT_CATALOG,
  agentDisplayName,
  binaryOnPath,
  requireAgent,
  UnknownAgentError,
} from '../domain/agent-catalog.js';
import type { Gates } from '../domain/gates.js';
import {
  ContextReadOnlyError,
  assertWritablePath,
  attachContextRepo,
  detachContextRepo,
} from '../domain/chat-context.js';
import { AgentLiveError, BranchHeldError, LaneIsolatedError, type LaunchTask } from '../domain/launch-task.js';
import { availableShells, TaskShells } from '../domain/task-shell.js';
import { NoHeadlessAgentError, type HeadlessRuns } from '../domain/headless-run.js';
import {
  agentPrCopy,
  agentSlug,
  agentTitle,
  stepsFromAgentText,
  tailFile,
} from '../domain/headless-copy.js';
import {
  repoRoot,
  checkoutBranch,
  currentBranch,
  listLocalBranches,
  listWorktreeCheckouts,
  repoWorkingStatus,
} from '../domain/git.js';
import { toTaskView } from '../domain/task-view.js';
import {
  createNote,
  deleteNote,
  editNote,
  listNotes,
  listOpenNotes,
  NoteError,
  openNoteForFile,
  setNoteResolved,
} from '../domain/quick-notes.js';
import { saveChatPhotos } from '../domain/chat-photos.js';
import { deriveVerifyPlan, type VerifyStep } from '../domain/verify-plan.js';
import { isAttached, taskCwd } from '../domain/cwd.js';
import {
  fileChanges,
  listDir,
  listWorkingChanges,
  readChangeDiff,
  readFile as readTaskFile,
  safeResolve,
  writeFile as writeTaskFile,
} from '../domain/files.js';
import type { Triage, TriageKind } from '../domain/triage.js';
import type { VerifyRunner } from '../domain/verify-run.js';
import type { Knowledge } from '../knowledge/service.js';
import { readRepoRules, repoRulesPath, writeRepoRules } from '../knowledge/repo-rules.js';
import type { ScmPoller } from '../scm/poller.js';
import type { CommentPayload, OpenPrPayload, ScmWrites } from '../scm/writes.js';

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
  triage: Triage;
  scmWrites: ScmWrites;
  poller: ScmPoller;
  shells: TaskShells;
  headless?: HeadlessRuns | null;
  /** §13 — absent when no model is configured. Mining is optional; everything else is not. */
  knowledge?: Knowledge | null;
  now: () => number;
}

const t = initTRPC.context<DaemonContext>().create();

const ShellKind = z.enum(['default', 'powershell', 'cmd', 'gitbash']);
const TerminalId = z.string().uuid();

function viewFor(ctx: DaemonContext, taskId: string): TaskView | null {
  return toTaskView(ctx.db, taskId, ctx.now());
}

function unknownAgent(err: unknown): never {
  if (err instanceof UnknownAgentError) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: err.message });
  }
  throw err;
}

function locateTaskCwd(ctx: DaemonContext, taskId: string): { cwd: string; baseSha: string } {
  const task = getTask(ctx.db, taskId);
  if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'unknown task' });
  const repo = ctx.db.prepare('SELECT path FROM repo WHERE id = ?').get(task.repo_id) as
    | { path: string }
    | undefined;
  if (!repo) throw new TRPCError({ code: 'NOT_FOUND', message: 'unknown repo' });
  return { cwd: taskCwd(task, repo.path), baseSha: task.base_sha };
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
  blocked_external: 7,
  ci_failed: 8,
  pr_open: 9,
  queued: 10,
  idle: 11,
  stopped: 12,
  merged: 13,
  archived: 14,
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
        chatId: z.string().optional(),
        baseRef: z.string().optional(),
        checkoutRef: z.string().optional(),
        isolate: z.boolean().optional(),
        home: z.boolean().optional(),
      }),
    )
    .output(
      z.object({
        taskId: TaskId,
        isolated: z.boolean(),
        isolatedBecause: z
          .object({ taskId: z.string(), chatId: z.string(), title: z.string() })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        if (input.agentId) requireAgent(input.agentId);
        return await ctx.launcher.createTask(input);
      } catch (err) {
        if (err instanceof ContextReadOnlyError) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: err.message });
        }
        unknownAgent(err);
      }
    }),

  orchestratorOpen: t.procedure
    .input(z.object({ repoPath: z.string().min(1), agentId: z.string().optional() }))
    .output(z.object({ taskId: TaskId, chatId: z.string(), isolated: z.literal(false) }))
    .mutation(async ({ ctx, input }) => {
      try {
        if (input.agentId) requireAgent(input.agentId);
        const created = await ctx.launcher.createTask({
          repoPath: input.repoPath,
          title: 'Plan',
          intent: 'Plan work across this repository and delegate focused tasks.',
          agentId: input.agentId,
          home: true,
        });
        const row = getTask(ctx.db, created.taskId);
        if (!row) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'plan chat missing' });
        return { taskId: created.taskId, chatId: row.chat_id, isolated: false as const };
      } catch (err) {
        unknownAgent(err);
      }
    }),

  /** Runs the §8.2 launch sequence. Long-running: worktree, lane, agent start. */
  taskLaunch: t.procedure
    .input(z.object({ taskId: TaskId }))
    .output(z.object({ taskId: TaskId, paneId: z.string(), workspaceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await ctx.launcher.launch(input.taskId);
        return { taskId: input.taskId, paneId: result.paneId, workspaceId: result.workspaceId };
      } catch (err) {
        if (err instanceof BranchHeldError) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: err.message });
        }
        throw err;
      }
    }),

  /** Sends a prompt into the task's agent lane. */
  taskSend: t.procedure
    .input(z.object({ taskId: TaskId, text: z.string().min(1), wait: z.boolean().optional() }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.launcher.sendTurn(input.taskId, input.text, {
        wait: input.wait ?? false,
        origin: 'human',
      });
      const task = getTask(ctx.db, input.taskId);
      if (task && task.title === 'New chat' && ctx.headless) {
        void agentTitle(ctx.headless, task.repo_id, input.text).then((title) => {
          if (title) ctx.db.prepare('UPDATE task SET title = ? WHERE id = ?').run(title, input.taskId);
        });
      }
      return { ok: true as const };
    }),

  /** Writes pasted photos under ~/.osade/inbox/<task>/ so the agent can open them. */
  taskDropImages: t.procedure
    .input(
      z.object({
        taskId: TaskId,
        files: z
          .array(
            z.object({
              name: z.string().min(1),
              mime: z.string().min(1),
              data: z.string().min(1),
            }),
          )
          .min(1)
          .max(8),
      }),
    )
    .output(z.object({ paths: z.array(z.string()) }))
    .mutation(({ ctx, input }) => {
      if (!getTask(ctx.db, input.taskId)) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'unknown task' });
      }
      try {
        return saveChatPhotos(input.taskId, input.files);
      } catch (err) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: (err as Error).message });
      }
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

  /** A cmd/PowerShell (or $SHELL) PTY in this lane's cwd. Not the agent pane. */
  taskShellOpen: t.procedure
    .input(
      z.object({
        taskId: TaskId,
        cols: z.number().int().min(2).max(500).optional(),
        rows: z.number().int().min(2).max(200).optional(),
      }),
    )
    .output(z.object({ cwd: z.string() }))
    .mutation(({ ctx, input }) => {
      const located = locateTaskCwd(ctx, input.taskId);
      const size =
        input.cols != null && input.rows != null ? { cols: input.cols, rows: input.rows } : undefined;
      return { cwd: ctx.shells.open(input.taskId, located.cwd, size) };
    }),

  taskShellRead: t.procedure
    .input(z.object({ taskId: TaskId }))
    .output(z.object({ text: z.string() }))
    .query(({ ctx, input }) => ({ text: ctx.shells.read(input.taskId) })),

  taskShellWrite: t.procedure
    .input(z.object({ taskId: TaskId, data: z.string().min(1) }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(({ ctx, input }) => {
      try {
        ctx.shells.write(input.taskId, input.data);
      } catch (err) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: (err as Error).message });
      }
      return { ok: true as const };
    }),

  taskShellResize: t.procedure
    .input(
      z.object({
        taskId: TaskId,
        cols: z.number().int().min(2).max(500),
        rows: z.number().int().min(2).max(200),
      }),
    )
    .output(z.object({ ok: z.literal(true) }))
    .mutation(({ ctx, input }) => {
      ctx.shells.resize(input.taskId, { cols: input.cols, rows: input.rows });
      return { ok: true as const };
    }),

  taskShellClose: t.procedure
    .input(z.object({ taskId: TaskId }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(({ ctx, input }) => {
      ctx.shells.close(input.taskId);
      return { ok: true as const };
    }),

  /*
   * Standalone terminal tabs: a PTY in a folder, not tied to any task. Keyed by a
   * renderer-minted UUID under a `term:` prefix so they can never collide with a lane's shell.
   */
  terminalShells: t.procedure
    .output(z.array(z.object({ kind: ShellKind, label: z.string() })))
    .query(() => availableShells()),

  terminalOpen: t.procedure
    .input(
      z.object({
        id: TerminalId,
        cwd: z.string().min(1),
        shell: ShellKind,
        cols: z.number().int().min(2).max(500).optional(),
        rows: z.number().int().min(2).max(200).optional(),
      }),
    )
    .output(z.object({ cwd: z.string() }))
    .mutation(({ ctx, input }) => {
      if (!existsSync(input.cwd) || !statSync(input.cwd).isDirectory()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `not a folder: ${input.cwd}` });
      }
      const size =
        input.cols != null && input.rows != null ? { cols: input.cols, rows: input.rows } : undefined;
      try {
        return { cwd: ctx.shells.open(`term:${input.id}`, input.cwd, size, input.shell) };
      } catch (err) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: (err as Error).message });
      }
    }),

  terminalRead: t.procedure
    .input(z.object({ id: TerminalId }))
    .output(z.object({ text: z.string() }))
    .query(({ ctx, input }) => ({ text: ctx.shells.read(`term:${input.id}`) })),

  terminalWrite: t.procedure
    .input(z.object({ id: TerminalId, data: z.string().min(1) }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(({ ctx, input }) => {
      try {
        ctx.shells.write(`term:${input.id}`, input.data);
      } catch (err) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: (err as Error).message });
      }
      return { ok: true as const };
    }),

  terminalResize: t.procedure
    .input(
      z.object({
        id: TerminalId,
        cols: z.number().int().min(2).max(500),
        rows: z.number().int().min(2).max(200),
      }),
    )
    .output(z.object({ ok: z.literal(true) }))
    .mutation(({ ctx, input }) => {
      ctx.shells.resize(`term:${input.id}`, { cols: input.cols, rows: input.rows });
      return { ok: true as const };
    }),

  terminalClose: t.procedure
    .input(z.object({ id: TerminalId }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(({ ctx, input }) => {
      ctx.shells.close(`term:${input.id}`);
      return { ok: true as const };
    }),

  taskFsList: t.procedure
    .input(z.object({ taskId: TaskId, dirs: z.array(z.string()).optional() }))
    .output(
      z.object({
        cwd: z.string(),
        listings: z.array(
          z.object({
            dir: z.string(),
            entries: z.array(
              z.object({
                name: z.string(),
                path: z.string(),
                kind: z.enum(['dir', 'file']),
                flag: z.enum(['M', 'A', 'D', '?']).nullable(),
                insertions: z.number().int(),
                deletions: z.number().int(),
              }),
            ),
          }),
        ),
      }),
    )
    .query(async ({ ctx, input }) => {
      const located = locateTaskCwd(ctx, input.taskId);
      try {
        const changes = await fileChanges(located.cwd, located.baseSha);
        const dirs = input.dirs ?? [''];
        return {
          cwd: located.cwd,
          listings: dirs.map((dir) => ({ dir, entries: listDir(located.cwd, dir, changes) })),
        };
      } catch (err) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: (err as Error).message });
      }
    }),

  taskFsRead: t.procedure
    .input(z.object({ taskId: TaskId, path: z.string().min(1) }))
    .output(
      z.object({
        path: z.string(),
        text: z.string().nullable(),
        binary: z.boolean(),
        truncated: z.boolean(),
      }),
    )
    .query(({ ctx, input }) => {
      const located = locateTaskCwd(ctx, input.taskId);
      try {
        return readTaskFile(located.cwd, input.path);
      } catch (err) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: (err as Error).message });
      }
    }),

  taskFsWrite: t.procedure
    .input(z.object({ taskId: TaskId, path: z.string().min(1), text: z.string() }))
    .output(z.object({ path: z.string(), bytes: z.number().int() }))
    .mutation(({ ctx, input }) => {
      const located = locateTaskCwd(ctx, input.taskId);
      try {
        assertWritablePath(ctx.db, input.taskId, safeResolve(located.cwd, input.path));
        return writeTaskFile(located.cwd, input.path, input.text);
      } catch (err) {
        if (err instanceof ContextReadOnlyError) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: err.message });
        }
        throw new TRPCError({ code: 'BAD_REQUEST', message: (err as Error).message });
      }
    }),

  taskChangesList: t.procedure
    .input(z.object({ taskId: TaskId }))
    .output(
      z.object({
        files: z.array(
          z.object({
            path: z.string(),
            flag: z.enum(['M', 'A', 'D', '?']),
            insertions: z.number().int(),
            deletions: z.number().int(),
          }),
        ),
        outgoing: z
          .object({
            ahead: z.number().int(),
            commits: z.array(z.object({ sha: z.string(), subject: z.string() })),
            files: z.array(
              z.object({
                path: z.string(),
                flag: z.enum(['M', 'A', 'D', '?']),
                insertions: z.number().int(),
                deletions: z.number().int(),
              }),
            ),
          })
          .nullable(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const located = locateTaskCwd(ctx, input.taskId);
      try {
        return await listWorkingChanges(located.cwd, located.baseSha);
      } catch (err) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: (err as Error).message });
      }
    }),

  taskChangesDiff: t.procedure
    .input(
      z.object({
        taskId: TaskId,
        path: z.string().min(1),
        vs: z.enum(['working', 'outgoing']),
      }),
    )
    .output(
      z.object({
        path: z.string(),
        flag: z.enum(['M', 'A', 'D', '?']).nullable(),
        diff: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const located = locateTaskCwd(ctx, input.taskId);
      try {
        return await readChangeDiff(located.cwd, input.path, input.vs, located.baseSha);
      } catch (err) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: (err as Error).message });
      }
    }),

  taskArchive: t.procedure
    .input(z.object({ taskId: TaskId }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(({ ctx, input }) => {
      ctx.shells.close(input.taskId);
      ctx.db.prepare('UPDATE task SET archived_at = ? WHERE id = ?').run(ctx.now(), input.taskId);
      return { ok: true as const };
    }),

  taskRetitle: t.procedure
    .input(z.object({ taskId: TaskId, title: z.string().min(1) }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(({ ctx, input }) => {
      const result = ctx.db
        .prepare('UPDATE task SET title = ? WHERE id = ?')
        .run(input.title, input.taskId);
      if (result.changes === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'unknown task' });
      return { ok: true as const };
    }),

  taskBranchOut: t.procedure
    .input(
      z.object({
        taskId: TaskId,
        branch: z.string().min(1).optional(),
        carryChanges: z.boolean(),
      }),
    )
    .output(z.object({ worktreePath: z.string(), branch: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        let branch = input.branch;
        if (!branch && ctx.headless) {
          const task = getTask(ctx.db, input.taskId);
          if (task) {
            const fallback = task.id.replace(/^t_/, '');
            branch = await agentSlug(ctx.headless, task.repo_id, task.title, fallback);
          }
        }
        return await ctx.launcher.branchOut(input.taskId, {
          branch,
          carryChanges: input.carryChanges,
        });
      } catch (err) {
        if (err instanceof AgentLiveError || err instanceof LaneIsolatedError) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: err.message });
        }
        throw new TRPCError({ code: 'BAD_REQUEST', message: (err as Error).message });
      }
    }),

  taskSwitchBranch: t.procedure
    .input(z.object({ taskId: TaskId, branch: z.string().min(1) }))
    .output(z.object({ gateId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const task = getTask(ctx.db, input.taskId);
      if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'unknown task' });
      if (!isAttached(task)) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'only an attached lane can switch the checkout',
        });
      }
      const repo = ctx.db.prepare('SELECT path FROM repo WHERE id = ?').get(task.repo_id) as
        | { path: string }
        | undefined;
      if (!repo) throw new TRPCError({ code: 'NOT_FOUND', message: 'unknown repo' });
      const status = await repoWorkingStatus(repo.path);
      const gateId = ctx.gates.request({
        taskId: input.taskId,
        gate: 'gate.branch_switch',
        payload: { branch: input.branch, repoId: task.repo_id, dirty: status.dirty },
      });
      return { gateId };
    }),

  repoStatus: t.procedure
    .input(z.object({ repoId: z.string().min(1) }))
    .output(
      z.object({
        branch: z.string(),
        dirty: z.boolean(),
        ahead: z.number().nullable(),
        behind: z.number().nullable(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const repo = ctx.db.prepare('SELECT path FROM repo WHERE id = ?').get(input.repoId) as
        | { path: string }
        | undefined;
      if (!repo) throw new TRPCError({ code: 'NOT_FOUND', message: 'unknown repo' });
      return repoWorkingStatus(repo.path);
    }),

  repoBranchList: t.procedure
    .input(z.object({ repoId: z.string().min(1) }))
    .output(z.array(z.string()))
    .query(async ({ ctx, input }) => {
      const repo = ctx.db.prepare('SELECT path FROM repo WHERE id = ?').get(input.repoId) as
        | { path: string }
        | undefined;
      if (!repo) throw new TRPCError({ code: 'NOT_FOUND', message: 'unknown repo' });
      return listLocalBranches(repo.path);
    }),

  repoBranchHolders: t.procedure
    .input(z.object({ repoId: z.string().min(1) }))
    .output(
      z.array(
        z.object({
          branch: z.string(),
          path: z.string(),
          holder: z
            .object({ taskId: z.string(), chatId: z.string(), title: z.string() })
            .nullable(),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      const repo = ctx.db.prepare('SELECT path FROM repo WHERE id = ?').get(input.repoId) as
        | { path: string }
        | undefined;
      if (!repo) throw new TRPCError({ code: 'NOT_FOUND', message: 'unknown repo' });
      const checkouts = await listWorktreeCheckouts(repo.path);
      const tasks = ctx.db
        .prepare(
          `SELECT id, chat_id, title, worktree_path FROM task
            WHERE repo_id = ? AND archived_at IS NULL`,
        )
        .all(input.repoId) as {
        id: string;
        chat_id: string;
        title: string;
        worktree_path: string | null;
      }[];
      const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
      return checkouts
        .filter((row) => row.branch != null)
        .map((row) => {
          const target = norm(row.path);
          const match = tasks.find((t) => norm(t.worktree_path ?? repo.path) === target);
          return {
            branch: row.branch!,
            path: row.path,
            holder: match
              ? { taskId: match.id, chatId: match.chat_id, title: match.title }
              : null,
          };
        });
    }),

  taskMoveBranch: t.procedure
    .input(z.object({ taskId: TaskId, checkoutRef: z.string().min(1) }))
    .output(
      z.object({
        taskId: TaskId,
        isolated: z.boolean(),
        isolatedBecause: z
          .object({ taskId: z.string(), chatId: z.string(), title: z.string() })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.launcher.moveToBranch(input.taskId, input.checkoutRef);
      } catch (err) {
        if (err instanceof BranchHeldError) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: err.message });
        }
        throw new TRPCError({ code: 'BAD_REQUEST', message: (err as Error).message });
      }
    }),

  /**
   * Open a repository — what `osade .` calls.
   *
   * Idempotent, and resolves the *root* rather than taking the path literally: `osade .` is typed
   * from wherever you happen to be standing, which is usually a subdirectory. Registering here
   * rather than waiting for a first task is what lets the window open on a repo with nothing in
   * it yet and still know whose repo it is.
   */
  repoOpen: t.procedure
    .input(z.object({ path: z.string().min(1) }))
    .output(
      z.object({
        repoId: z.string(),
        path: z.string(),
        name: z.string(),
        /** `owner/name` when there is a GitHub remote; null for a local-only repo. */
        slug: z.string().nullable(),
        defaultBranch: z.string(),
        currentBranch: z.string(),
        defaultAgent: z.string().nullable(),
        taskCount: z.number().int(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const root = await repoRoot(input.path);
      if (!root) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `${input.path} is not inside a git repository.`,
        });
      }

      const repoId = await ctx.launcher.ensureRepo(root);
      const repo = ctx.db.prepare('SELECT * FROM repo WHERE id = ?').get(repoId) as {
        path: string;
        default_branch: string;
        default_agent: string | null;
        gh_owner: string | null;
        gh_name: string | null;
      };
      const counted = ctx.db
        .prepare('SELECT COUNT(*) AS n FROM task WHERE repo_id = ? AND archived_at IS NULL')
        .get(repoId) as { n: number };

      return {
        repoId,
        path: repo.path,
        name: basename(repo.path) || repo.path,
        slug: repo.gh_owner && repo.gh_name ? `${repo.gh_owner}/${repo.gh_name}` : null,
        defaultBranch: repo.default_branch,
        currentBranch: await currentBranch(repo.path),
        defaultAgent: repo.default_agent,
        taskCount: counted.n,
      };
    }),

  chatContextAdd: t.procedure
    .input(z.object({ chatId: z.string().min(1), path: z.string().min(1) }))
    .output(
      z.object({
        repoId: z.string(),
        path: z.string(),
        name: z.string(),
        remote: z.string().nullable(),
        branch: z.string(),
        access: z.enum(['read', 'edit']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const root = await repoRoot(input.path);
      if (!root) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `${input.path} is not inside a git repository.`,
        });
      }
      try {
        const repoId = await ctx.launcher.ensureRepo(root);
        return attachContextRepo(ctx.db, input.chatId, repoId, ctx.now());
      } catch (err) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: (err as Error).message });
      }
    }),

  chatContextRemove: t.procedure
    .input(z.object({ chatId: z.string().min(1), repoId: z.string().min(1) }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(({ ctx, input }) => {
      detachContextRepo(ctx.db, input.chatId, input.repoId);
      return { ok: true as const };
    }),

  repoRulesGet: t.procedure
    .input(z.object({ repoId: z.string().min(1) }))
    .output(z.object({ text: z.string(), path: z.string() }))
    .query(({ ctx, input }) => {
      const path = requireRepoPath(ctx, input.repoId);
      return { text: readRepoRules(path), path: repoRulesPath(path) };
    }),

  repoRulesSave: t.procedure
    .input(z.object({ repoId: z.string().min(1), text: z.string() }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(({ ctx, input }) => {
      writeRepoRules(requireRepoPath(ctx, input.repoId), input.text);
      return { ok: true as const };
    }),

  repoSetDefaultAgent: t.procedure
    .input(z.object({ repoId: z.string().min(1), agentId: z.string().min(1) }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(({ ctx, input }) => {
      try {
        requireAgent(input.agentId);
      } catch (err) {
        unknownAgent(err);
      }
      const result = ctx.db
        .prepare('UPDATE repo SET default_agent = ? WHERE id = ?')
        .run(input.agentId, input.repoId);
      if (result.changes === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'unknown repo' });
      }
      return { ok: true as const };
    }),

  agentCatalogList: t.procedure
    .output(
      z.array(
        z.object({
          id: z.string(),
          displayName: z.string(),
          installed: z.boolean(),
        }),
      ),
    )
    .query(() =>
      AGENT_CATALOG.map((entry) => ({
        id: entry.id,
        displayName: agentDisplayName(entry.id),
        installed: binaryOnPath(entry.binary),
      })),
    ),

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
            source: z.enum(['ci', 'manifest', 'doc', 'user', 'agent']),
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
      if (plan.steps.length === 0 && ctx.headless) {
        try {
          const { text } = await ctx.headless.run({
            repoId: task.repo_id,
            prompt:
              'This repository has no CI, package.json scripts, or docs Osade could parse into checks. Reply with JSON {"steps":[{"name":"...","cmd":"...","cwd":".","timeoutSec":600}]} of guessed local verification commands. No markdown.',
            timeoutSec: 60,
          });
          const guessed = stepsFromAgentText(text);
          if (guessed.length > 0) {
            plan.steps = guessed;
            plan.needsReview = true;
          }
        } catch {
          // leave empty; the UI still offers Add
        }
      }
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

  /**
   * The plan this repo already has, if any — §10.1.
   *
   * Read-only, and the reason it exists: without it the renderer cannot tell a repo with a
   * confirmed plan from one with none, so it offered "Derive a verification plan" either way and
   * deriving resets `needs_review` to 1 — silently discarding the confirmation §10.1 exists to
   * collect. Found by looking at the panel for the first time.
   */
  verifyPlanGet: t.procedure
    .input(z.object({ taskId: TaskId }))
    .output(
      z
        .object({
          steps: z.array(
            z.object({
              name: z.string(),
              cmd: z.string(),
              cwd: z.string(),
              timeoutSec: z.number(),
              required: z.boolean(),
              source: z.enum(['ci', 'manifest', 'doc', 'user', 'agent']),
              evidence: z.string(),
            }),
          ),
          needsReview: z.boolean(),
        })
        .nullable(),
    )
    .query(({ ctx, input }) => {
      const task = getTask(ctx.db, input.taskId);
      if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'unknown task' });

      const stored = ctx.db
        .prepare('SELECT steps_json, needs_review FROM verify_plan WHERE repo_id = ?')
        .get(task.repo_id) as { steps_json: string; needs_review: number } | undefined;
      if (!stored) return null;

      return {
        steps: JSON.parse(stored.steps_json) as VerifyStep[],
        needsReview: stored.needs_review === 1,
      };
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

  verifyRunLog: t.procedure
    .input(z.object({ runId: z.string().min(1) }))
    .output(z.object({ text: z.string() }))
    .query(({ ctx, input }) => {
      const row = ctx.db.prepare('SELECT log_path FROM verify_run WHERE id = ?').get(input.runId) as
        | { log_path: string }
        | undefined;
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'unknown verify run' });
      return { text: tailFile(row.log_path, 40) };
    }),

  runHeadless: t.procedure
    .input(
      z.object({
        repoId: z.string().min(1),
        agentId: z.string().optional(),
        prompt: z.string().min(1),
        timeoutSec: z.number().int().min(5).max(600).optional(),
      }),
    )
    .output(z.object({ text: z.string(), agentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.headless) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'no installed agent can run headless',
        });
      }
      try {
        return await ctx.headless.run(input);
      } catch (err) {
        if (err instanceof NoHeadlessAgentError) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: err.message });
        }
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: (err as Error).message });
      }
    }),

  // ── gates (§14) ──────────────────────────────────────────────────────────

  gateDecide: t.procedure
    .input(z.object({ gateId: z.string(), decision: z.enum(['approve', 'deny']) }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      try {
        ctx.gates.decide(input.gateId, input.decision);
      } catch (err) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: (err as Error).message });
      }
      if (input.decision === 'approve') {
        await executeApprovedGate(ctx, input.gateId);
      }
      return { ok: true as const };
    }),

  /** §14.2 — editing rewrites the payload and re-hashes, so the edit is what is bound. */
  gateEditAndApprove: t.procedure
    .input(z.object({ gateId: z.string(), payload: z.unknown() }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      try {
        ctx.gates.editAndApprove(input.gateId, input.payload);
      } catch (err) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: (err as Error).message });
      }
      await executeApprovedGate(ctx, input.gateId);
      return { ok: true as const };
    }),

  // ── GitHub (§11) and triage (§12) ────────────────────────────────────────

  /** §11.1 — the issue list for a watched repo. Candidates, not tasks. */
  issueList: t.procedure
    .input(z.object({ repoId: z.string() }))
    .output(
      z.array(
        z.object({
          number: z.number().int(),
          title: z.string(),
          body: z.string(),
          url: z.string(),
        }),
      ),
    )
    .query(({ ctx, input }) => ctx.poller.pollIssues(input.repoId)),

  /**
   * §12 — import an issue as a task.
   *
   * `triage` makes it a task that terminates in an artifact rather than a PR. That path is the
   * wedge, so it is a first-class option here rather than a mode discovered later.
   */
  issueImport: t.procedure
    .input(
      z.object({
        repoPath: z.string().min(1),
        issue: z.object({
          number: z.number().int(),
          title: z.string(),
          body: z.string(),
          url: z.string(),
        }),
        triage: z
          .enum(['reproduce', 'bisect', 'failing-test', 'duplicate-check', 'verify-pr-claim'])
          .optional(),
      }),
    )
    .output(z.object({ taskId: TaskId }))
    .mutation(async ({ ctx, input }) => {
      const taskId = await ctx.triage.importIssue(input.repoPath, input.issue, {
        triage: input.triage as TriageKind | undefined,
      });
      return { taskId };
    }),

  /** Forces a PR refresh without waiting out the 30s interval. */
  scmRefresh: t.procedure
    .input(z.object({ taskId: TaskId }))
    .output(z.object({ refreshed: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const facts = getTaskFacts(ctx.db, input.taskId);
      const prNumber = facts?.scm?.pr_number;
      if (prNumber == null) return { refreshed: false };
      return { refreshed: await ctx.poller.refreshPr(input.taskId, prNumber) };
    }),

  /**
   * §11.3 — what would happen if this task opened a PR.
   *
   * Shown *before* asking for approval: §11.3 says check permissions before offering the
   * action, not after.
   */
  prPlan: t.procedure
    .input(z.object({ taskId: TaskId }))
    .output(
      z.object({
        viaFork: z.boolean(),
        head: z.string(),
        target: z.string(),
        base: z.string(),
        title: z.string(),
        body: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        const plan = await ctx.scmWrites.planFork(input.taskId);
        const task = getTask(ctx.db, input.taskId);
        const fallbackTitle = task?.title ?? 'Update';
        const copy = ctx.headless
          ? await agentPrCopy(ctx.headless, task?.repo_id ?? '', fallbackTitle)
          : { title: fallbackTitle, body: '' };
        return {
          viaFork: plan.viaFork,
          head: plan.head,
          target: `${plan.prOwner}/${plan.prRepo}`,
          base: plan.prBase,
          title: copy.title,
          body: copy.body,
        };
      } catch (err) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: (err as Error).message });
      }
    }),

  /** §11.2 — requests a gate for opening a PR. Nothing is written until it is approved. */
  prOpenRequest: t.procedure
    .input(
      z.object({
        taskId: TaskId,
        title: z.string().min(1),
        body: z.string(),
        draft: z.boolean().optional(),
      }),
    )
    .output(z.object({ gateId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const plan = await ctx.scmWrites.planFork(input.taskId);
      const payload = {
        title: input.title,
        body: input.body,
        head: plan.head,
        base: plan.prBase,
        draft: input.draft ?? false,
      };
      return { gateId: ctx.scmWrites.requestGate(input.taskId, 'gate.pr_open', payload) };
    }),

  /**
   * §11.2 / §12 — requests a gate for posting a comment on the originating issue.
   * Nothing is written until it is approved.
   */
  issueCommentRequest: t.procedure
    .input(z.object({ taskId: TaskId, body: z.string().min(1) }))
    .output(z.object({ gateId: z.string() }))
    .mutation(({ ctx, input }) => {
      const task = getTask(ctx.db, input.taskId);
      if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'unknown task' });
      if (issueNumberFromRef(task.origin_ref) == null) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'this task has no originating issue to comment on',
        });
      }
      const disclosure = '_Produced by an agent through Osade, and reviewed by a human before posting._';
      const body = input.body.includes(disclosure) ? input.body : `${input.body.trim()}\n\n---\n${disclosure}`;
      return { gateId: ctx.scmWrites.requestGate(input.taskId, 'gate.issue_comment', { body }) };
    }),

  // ── §13 repository conventions ─────────────────────────────────────────────

  /** What is known about this repo, and whether more can be learned right now. */
  mineStatus: t.procedure
    .input(z.object({ repoId: z.string() }))
    .output(MineStatus)
    .query(({ ctx, input }) => {
      const knowledge = requireKnowledge(ctx);
      const availability = knowledge.availability(input.repoId);
      const rules = knowledge.list(input.repoId);
      return {
        available: availability.available,
        reason: availability.reason,
        running: knowledge.isRunning(input.repoId),
        lastRun: knowledge.lastRun(input.repoId),
        activeRules: rules.filter((r) => r.lifecycle === 'active').length,
        candidateRules: rules.filter((r) => r.lifecycle === 'candidate').length,
        dueForRemine: knowledge.dueForRemine(input.repoId),
      };
    }),

  /**
   * §13.4 — mining is always explicit. It spends GitHub quota and model tokens, so nothing
   * starts it on its own and no task launch waits on it.
   *
   * Returns as soon as the run is *started*, not when it finishes: a first mine of a large
   * repository is minutes of model calls, and holding an HTTP request open for that is the wrong
   * shape — a client that times out would learn nothing about a run still spending money. Poll
   * `mineStatus` for progress.
   */
  mineRepo: t.procedure
    .input(z.object({ repoId: z.string(), full: z.boolean().optional() }))
    .output(z.object({ runId: z.string() }))
    .mutation(({ ctx, input }) => {
      try {
        return requireKnowledge(ctx).startMine(input.repoId, { full: input.full });
      } catch (err) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: (err as Error).message });
      }
    }),

  /** §13.6 — the measurable claim. Reports what it measured, including bad news. */
  conventionImpact: t.procedure
    .input(z.object({ repoId: z.string() }))
    .output(ConventionImpact)
    .query(async ({ ctx, input }) => {
      try {
        return await requireKnowledge(ctx).measure(input.repoId);
      } catch (err) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: (err as Error).message });
      }
    }),

  conventionList: t.procedure
    .input(z.object({ repoId: z.string() }))
    .output(z.array(ConventionView))
    .query(({ ctx, input }) => requireKnowledge(ctx).list(input.repoId)),

  /** §13.4 — one-click confirmation. The renderer shows the evidence beside the toggle. */
  conventionConfirm: t.procedure
    .input(z.object({ id: z.string() }))
    .output(z.object({ confirmed: z.boolean() }))
    .mutation(({ ctx, input }) => ({
      confirmed: requireKnowledge(ctx).confirm(input.id),
    })),

  conventionReject: t.procedure
    .input(z.object({ id: z.string(), reason: z.string().min(1) }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(({ ctx, input }) => {
      requireKnowledge(ctx).reject(input.id, input.reason);
      return { ok: true as const };
    }),

  /**
   * Quick notes — issue #19. "Noticed, not fixing yet", scoped to a repository.
   *
   * Read over tRPC rather than pushed: a note belongs to a repository, not to a task, and §5.4's
   * CDC poller re-reads a `TaskView` per `change_log` row. `convention` and `verify_plan` set
   * the precedent, and the renderer refetches after a write rather than patching local state.
   */
  noteList: t.procedure
    .input(z.object({ repoId: z.string().min(1) }))
    .output(z.array(QuickNoteView))
    .query(({ ctx, input }) => listNotes(ctx.db, input.repoId)),

  /** Only the open ones, oldest first — what `notesPrompt` puts in front of an agent. */
  noteListOpen: t.procedure
    .input(z.object({ repoId: z.string().min(1) }))
    .output(z.array(QuickNoteView))
    .query(({ ctx, input }) => listOpenNotes(ctx.db, input.repoId)),

  /** The reminder hook's lookup: is there an open note filed against this file? */
  noteForFile: t.procedure
    .input(z.object({ repoId: z.string().min(1), file: z.string().min(1) }))
    .output(QuickNoteView.nullable())
    .query(({ ctx, input }) => openNoteForFile(ctx.db, input.repoId, input.file)),

  noteCreate: t.procedure
    .input(
      z.object({
        repoId: z.string().min(1),
        text: z.string(),
        file: z.string().nullish(),
        line: z.number().int().min(1).nullish(),
      }),
    )
    .output(QuickNoteView)
    .mutation(({ ctx, input }) =>
      note(ctx, () =>
        createNote(
          ctx.db,
          {
            repoId: input.repoId,
            text: input.text,
            file: input.file ?? null,
            line: input.line ?? null,
          },
          ctx.now(),
        ),
      ),
    ),

  noteResolve: t.procedure
    .input(z.object({ id: z.string().min(1), resolved: z.boolean() }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(({ ctx, input }) => {
      note(ctx, () => setNoteResolved(ctx.db, input.id, input.resolved, ctx.now()));
      return { ok: true as const };
    }),

  noteEdit: t.procedure
    .input(z.object({ id: z.string().min(1), text: z.string() }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(({ ctx, input }) => {
      note(ctx, () => editNote(ctx.db, input.id, input.text));
      return { ok: true as const };
    }),

  noteDelete: t.procedure
    .input(z.object({ id: z.string().min(1) }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(({ ctx, input }) => {
      note(ctx, () => deleteNote(ctx.db, input.id));
      return { ok: true as const };
    }),
});

/**
 * Approval is not the write. `gate.branch_switch` already executed here; public GitHub
 * writes used to stop at `decide`, so a live M2 run would approve a PR that never opened.
 */
async function executeApprovedGate(ctx: DaemonContext, gateId: string): Promise<void> {
  const row = ctx.db
    .prepare('SELECT gate, payload_json, task_id FROM gate_request WHERE id = ?')
    .get(gateId) as { gate: string; payload_json: string; task_id: string } | undefined;
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'unknown gate' });

  const payload = JSON.parse(row.payload_json) as unknown;
  try {
    switch (row.gate) {
      case 'gate.branch_switch': {
        const branch = (payload as { branch: string }).branch;
        const task = getTask(ctx.db, row.task_id);
        if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'unknown task' });
        const repo = ctx.db.prepare('SELECT path FROM repo WHERE id = ?').get(task.repo_id) as
          | { path: string }
          | undefined;
        if (!repo) throw new TRPCError({ code: 'NOT_FOUND', message: 'unknown repo' });
        await checkoutBranch(taskCwd(task, repo.path), branch);
        ctx.db.prepare('UPDATE task SET branch = ? WHERE id = ?').run(branch, task.id);
        ctx.gates.markExecuted(gateId);
        return;
      }
      case 'gate.pr_open':
        await ctx.scmWrites.openPr(row.task_id, gateId, payload as OpenPrPayload);
        return;
      case 'gate.issue_comment':
      case 'gate.pr_comment': {
        const task = getTask(ctx.db, row.task_id);
        const fromIssue = issueNumberFromRef(task?.origin_ref ?? null);
        const fromPr = getTaskFacts(ctx.db, row.task_id)?.scm?.pr_number ?? null;
        const issueNumber = row.gate === 'gate.pr_comment' ? fromPr ?? fromIssue : fromIssue ?? fromPr;
        if (issueNumber == null) {
          throw new Error('no issue or pull request to comment on');
        }
        await ctx.scmWrites.comment(row.task_id, gateId, payload as CommentPayload, { issueNumber });
        return;
      }
      default:
        return;
    }
  } catch (err) {
    if (err instanceof TRPCError) throw err;
    throw new TRPCError({ code: 'BAD_REQUEST', message: (err as Error).message });
  }
}

function issueNumberFromRef(ref: string | null): number | null {
  if (!ref) return null;
  const match = /\/(?:issues|pull)\/(\d+)(?:\b|$)/u.exec(ref);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Mining is optional: a daemon with no model or no token configured serves every other procedure
 * normally. Saying so plainly beats a null dereference three frames down.
 */
function requireKnowledge(ctx: DaemonContext): Knowledge {
  if (!ctx.knowledge) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'this daemon has no knowledge service configured',
    });
  }
  return ctx.knowledge;
}

function requireRepoPath(ctx: DaemonContext, repoId: string): string {
  const repo = ctx.db.prepare('SELECT path FROM repo WHERE id = ?').get(repoId) as
    | { path: string }
    | undefined;
  if (!repo) throw new TRPCError({ code: 'NOT_FOUND', message: 'unknown repo' });
  return repo.path;
}

/**
 * Run a quick-note write, turning its refusal into something the composer can show.
 *
 * `NoteError` is always something the person can fix by typing something else — an empty note,
 * a note too long, an id that no longer exists — so `BAD_REQUEST` with the domain's own words.
 * `humanizeDaemonError` passes a short message through untouched, so "a note cannot be empty"
 * reaches the composer as itself rather than as a tRPC envelope.
 */
function note<T>(ctx: DaemonContext, run: () => T): T {
  try {
    return run();
  } catch (err) {
    if (!(err instanceof NoteError)) throw err;
    throw new TRPCError({ code: 'BAD_REQUEST', message: err.message });
  }
}

export type AppRouter = typeof appRouter;
