import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { Db } from '../db/index.js';
import { getTask } from '../db/task-repo.js';
import { osadePaths } from '../paths.js';
import { diffStat, git } from './git.js';
import { undoTurnNeedsHuman } from './gates.js';

/**
 * Turn checkpoints and undo — OSADE.md §9.1.
 *
 * A git ref snapshot on each launch and each `to_review` / `to_in_progress` transition, stored
 * as `turn_checkpoint` rows under `refs/osade/turns/<task_id>/<n>`.
 *
 * **All checkpoint capture is best-effort and never blocks the agent** (§9.1, §8.2 step 8). A
 * task whose checkpoint failed is a task with less undo history, not a failed task.
 */

export type CheckpointTrigger = 'launch' | 'to_review' | 'to_in_progress' | 'manual';

export interface Checkpoint {
  id: string;
  taskId: string;
  refName: string;
  sha: string;
  capturedAt: number;
  trigger: CheckpointTrigger;
}

export interface UndoPlan {
  /** The checkpoint the worktree would be reset to. */
  target: Checkpoint;
  filesChanged: number;
  /** §9.1 — its own gate when the diff is larger than N files. */
  needsGate: boolean;
  /** Set when the undo cannot proceed at all. */
  blockedBy: string | null;
}

export class CheckpointError extends Error {}

export interface CheckpointsOptions {
  now?: () => number;
  onWarning?: (message: string) => void;
}

export class Checkpoints {
  readonly #db: Db;
  readonly #now: () => number;
  readonly #onWarning: (message: string) => void;

  constructor(db: Db, options: CheckpointsOptions = {}) {
    this.#db = db;
    this.#now = options.now ?? Date.now;
    this.#onWarning = options.onWarning ?? (() => {});
  }

  list(taskId: string): Checkpoint[] {
    const rows = this.#db
      .prepare('SELECT * FROM turn_checkpoint WHERE task_id = ? ORDER BY captured_at')
      .all(taskId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string,
      taskId: r.task_id as string,
      refName: r.ref_name as string,
      sha: r.sha as string,
      capturedAt: r.captured_at as number,
      trigger: r.trigger as CheckpointTrigger,
    }));
  }

  /**
   * Captures a checkpoint. Never throws — §9.1 is explicit that this must not block the agent.
   *
   * Commits the worktree's current state to a ref *without* touching the index or HEAD, so an
   * agent mid-edit is unaffected: `write-tree` on a temporary index, then `commit-tree`. A
   * checkpoint that disturbed the working tree would be worse than no checkpoint.
   */
  async capture(taskId: string, trigger: CheckpointTrigger): Promise<Checkpoint | null> {
    const task = getTask(this.#db, taskId);
    if (!task) return null;

    try {
      const n = this.list(taskId).length;
      const refName = `refs/osade/turns/${taskId}/${n}`;
      const sha = await this.#commitWorktreeState(task.worktree_path, refName, taskId, trigger);

      const checkpoint: Checkpoint = {
        id: `c_${randomUUID().slice(0, 8)}`,
        taskId,
        refName,
        sha,
        capturedAt: this.#now(),
        trigger,
      };

      this.#db
        .prepare(
          `INSERT INTO turn_checkpoint (id, task_id, ref_name, sha, captured_at, trigger)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          checkpoint.id,
          taskId,
          checkpoint.refName,
          checkpoint.sha,
          checkpoint.capturedAt,
          trigger,
        );

      return checkpoint;
    } catch (err) {
      this.#onWarning(`checkpoint capture failed for ${taskId}: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Snapshots the working tree into a commit object nothing points at except our ref.
   *
   * `GIT_INDEX_FILE` redirects `add`/`write-tree` to a scratch index so the agent's staged
   * state is untouched. Undoing a turn is only safe if capturing one was invisible.
   *
   * The scratch index lives **outside the worktree** — under `~/.osade/` per §2.2. Writing it
   * inside made it an untracked file, so every capture dirtied `git status` under the agent:
   * the capture was disturbing exactly what it was written not to disturb.
   */
  async #commitWorktreeState(
    worktreePath: string,
    refName: string,
    taskId: string,
    trigger: CheckpointTrigger,
  ): Promise<string> {
    const scratchIndex = join(osadePaths().root, 'tmp', `checkpoint-index-${randomUUID()}`);
    await mkdir(dirname(scratchIndex), { recursive: true });
    const env = { ...process.env, GIT_INDEX_FILE: scratchIndex };

    await gitWithEnv(worktreePath, ['add', '-A'], env);
    const tree = (await gitWithEnv(worktreePath, ['write-tree'], env)).trim();
    const parent = await git(worktreePath, ['rev-parse', 'HEAD']).then(
      (s) => s.trim(),
      () => null,
    );

    const args = ['commit-tree', tree, '-m', `osade checkpoint (${trigger}) for ${taskId}`];
    if (parent) args.push('-p', parent);
    const sha = (await gitWithEnv(worktreePath, args, env)).trim();

    await git(worktreePath, ['update-ref', refName, sha]);
    await rm(scratchIndex, { force: true });
    return sha;
  }

  /**
   * Plans an undo without performing it — §9.1.
   *
   * Refuses while a pane is live in the task (stop the agent first), and reports whether the
   * diff is large enough to need `gate.undo_turn`. The caller decides; this only describes.
   */
  async planUndo(taskId: string): Promise<UndoPlan> {
    const task = getTask(this.#db, taskId);
    if (!task) throw new CheckpointError(`unknown task ${taskId}`);

    const checkpoints = this.list(taskId);
    const target = checkpoints.at(-2) ?? checkpoints.at(-1);
    if (!target) throw new CheckpointError(`task ${taskId} has no checkpoint to undo to`);

    // §9.1 — refuse while a pane is live. Resetting a worktree under a running agent is how
    // you lose work you cannot get back.
    const agent = this.#db
      .prepare('SELECT pane_alive FROM agent_fact WHERE task_id = ?')
      .get(taskId) as { pane_alive: number } | undefined;
    const blockedBy =
      agent?.pane_alive === 1 ? 'an agent is still live in this task; stop it first' : null;

    let filesChanged = 0;
    try {
      filesChanged = (await diffStat(task.worktree_path, target.sha)).filesChanged;
    } catch (err) {
      this.#onWarning(`could not diff ${taskId} against ${target.sha}: ${(err as Error).message}`);
    }

    return { target, filesChanged, needsGate: undoTurnNeedsHuman(filesChanged), blockedBy };
  }

  /**
   * Performs the undo — §9.1.
   *
   * **Stash-and-label rather than discard.** The whole point of undo is that a mistake is
   * recoverable; an undo that destroys the work it replaced just moves the mistake.
   */
  async undo(taskId: string, plan: UndoPlan): Promise<{ stashRef: string | null }> {
    const task = getTask(this.#db, taskId);
    if (!task) throw new CheckpointError(`unknown task ${taskId}`);
    if (plan.blockedBy) throw new CheckpointError(plan.blockedBy);

    let stashRef: string | null = null;
    const label = `osade-undo/${taskId}/${this.#now()}`;

    try {
      // Label the pre-undo state so it can be recovered, then reset onto the checkpoint.
      const preUndo = `refs/osade/undone/${taskId}/${this.#now()}`;
      await this.#commitWorktreeState(task.worktree_path, preUndo, taskId, 'manual');
      stashRef = preUndo;
    } catch (err) {
      throw new CheckpointError(
        `refusing to undo ${taskId}: could not preserve the current state first ` +
          `(${(err as Error).message})`,
      );
    }

    await git(task.worktree_path, ['reset', '--hard', plan.target.sha]);
    await git(task.worktree_path, ['clean', '-fd']);

    this.#onWarning(`undid ${taskId} to ${plan.target.sha.slice(0, 12)}; previous state at ${label}`);
    return { stashRef };
  }
}

/** `git` with an environment override, for the scratch-index trick above. */
async function gitWithEnv(
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const { stdout } = await run('git', args, {
    cwd,
    env,
    timeout: 30_000,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}
