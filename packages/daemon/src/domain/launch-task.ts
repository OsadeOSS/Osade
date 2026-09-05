import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { platform } from 'node:os';
import { basename, join } from 'node:path';

import type { Db } from '../db/index.js';
import { getTask } from '../db/task-repo.js';
import { HerdrApiError, type HerdrClient } from '../herdr/client.js';
import type { HerdrEventSubscriber } from '../herdr/event-subscriber.js';
import { worktreePathFor } from '../paths.js';
import { agentEntry, hasCapability } from './agent-catalog.js';
import {
  DEFAULT_MIRROR_PATHS,
  defaultBranch,
  mirrorPaths,
  pruneWorktrees,
  resolveSha,
} from './git.js';

/**
 * The launch sequence — OSADE.md §8.2.
 *
 * The ordering here is load-bearing and is not the ordering the spec originally had.
 * `agent.start` does not spawn a process: it resolves `kind` to a fixed executable, appends
 * args, and **types the command line into an existing idle shell pane**
 * (`backend/src/app/agents.rs:145-225`). Three consequences:
 *
 *   - the lane must exist and be at a shell prompt before the agent starts;
 *   - **environment cannot be set at `agent.start`** — it is set when the workspace or tab is
 *     created, so `OSADE_TASK_ID` is decided at lane creation;
 *   - a pane hosts at most one agent.
 */

/** A repo-level lock, per §9 rule 2: herdr has no cross-call lock and concurrent creates race. */
const repoLocks = new Map<string, Promise<unknown>>();

async function withRepoLock<T>(repoPath: string, fn: () => Promise<T>): Promise<T> {
  const previous = repoLocks.get(repoPath) ?? Promise.resolve();
  // Chain rather than reject: a queued launch should wait, not fail.
  const next = previous.then(fn, fn);
  repoLocks.set(
    repoPath,
    next.catch(() => {}),
  );
  try {
    return await next;
  } finally {
    if (repoLocks.get(repoPath) === next) repoLocks.delete(repoPath);
  }
}

export interface CreateTaskInput {
  repoPath: string;
  title: string;
  intent: string;
  agentId?: string | undefined;
  baseRef?: string | undefined;
}

export interface LaunchResult {
  workspaceId: string;
  tabId: string;
  paneId: string;
  worktreePath: string;
  /** `<worktree>/.osade/CONTEXT.md` — §8.2 step 5. */
  contextPath: string;
  /** False on platforms where herdr cannot pass args to agent.start. See #agentStartArgs. */
  argsSupported: boolean;
  /** True when the first-run trust prompt fired and was resolved (§8.3). */
  resolvedTrustPrompt: boolean;
}

export interface LaunchTaskOptions {
  now?: () => number;
  defaultAgent?: string;
  onWarning?: (message: string) => void;
}

/**
 * Timeouts. Note that `agent.start` is NOT a readiness barrier — it can return success with
 * `launch_pending: true` — so AGENT_SETTLE_TIMEOUT_MS is the one that actually matters.
 */
const AGENT_START_TIMEOUT_MS = 60_000;
const AGENT_SETTLE_TIMEOUT_MS = 90_000;

/**
 * §8.3 — Claude and Codex ask "do you trust this folder?" and Osade's cwd is a freshly created
 * worktree every single time, so this fires constantly. Matched narrowly on purpose: any other
 * `blocked` is §6 row 4, and answering that for the user is the one thing this must not do.
 */
const TRUST_PROMPT_MATCHES: readonly string[] = [
  'Is this a project you created',
  'Do you trust the files in this folder',
  'do you trust this folder',
];

/** How many times a visible trust prompt is answered before we stop and let a human see it. */
const MAX_TRUST_PROMPT_ANSWERS = 3;

export class LaunchTask {
  readonly #db: Db;
  readonly #herdr: HerdrClient;
  readonly #subscriber: HerdrEventSubscriber;
  readonly #now: () => number;
  readonly #defaultAgent: string;
  readonly #onWarning: (message: string) => void;

  constructor(
    db: Db,
    herdr: HerdrClient,
    subscriber: HerdrEventSubscriber,
    options: LaunchTaskOptions = {},
  ) {
    this.#db = db;
    this.#herdr = herdr;
    this.#subscriber = subscriber;
    this.#now = options.now ?? Date.now;
    this.#defaultAgent = options.defaultAgent ?? 'claude';
    this.#onWarning = options.onWarning ?? (() => {});
  }

  /** Registers a repo and a task row. No herdr calls, no worktree — that is `launch`. */
  async createTask(input: CreateTaskInput): Promise<string> {
    const repoId = await this.#ensureRepo(input.repoPath);
    const repo = this.#db.prepare('SELECT * FROM repo WHERE id = ?').get(repoId) as {
      path: string;
      default_branch: string;
    };

    const baseRef = input.baseRef ?? repo.default_branch;
    const baseSha = await resolveSha(repo.path, baseRef);

    const taskId = `t_${randomUUID().slice(0, 8)}`;
    const slug = slugify(input.title);
    const branch = `osade/${slug}-${taskId.slice(2)}`;
    const worktreePath = worktreePathFor(basename(repo.path), taskId);

    this.#db
      .prepare(
        `INSERT INTO task (id, repo_id, title, intent, origin_kind, agent_id, base_ref, base_sha,
                           branch, worktree_path, created_at)
         VALUES (?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        taskId,
        repoId,
        input.title,
        input.intent,
        input.agentId ?? null,
        baseRef,
        baseSha,
        branch,
        worktreePath,
        this.#now(),
      );

    return taskId;
  }

  /** The §8.2 sequence. Serialized per repo, because herdr has no cross-call lock. */
  async launch(taskId: string): Promise<LaunchResult> {
    const task = getTask(this.#db, taskId);
    if (!task) throw new Error(`unknown task ${taskId}`);

    const repo = this.#db.prepare('SELECT * FROM repo WHERE id = ?').get(task.repo_id) as {
      path: string;
      default_agent: string | null;
    };

    const agentId = task.agent_id ?? repo.default_agent ?? this.#defaultAgent;
    const entry = agentEntry(agentId);
    if (!entry) throw new Error(`no catalog entry for agent ${agentId}`);

    return withRepoLock(repo.path, async () => {
      // 2. prune → worktree → mirror, all before anything is spawned.
      await pruneWorktrees(repo.path);

      // 3. One call gives the git worktree AND its workspace. The root pane is the shell lane.
      const created = await this.#herdr.request<
        'worktree.create',
        { workspace: { workspace_id: string }; root_pane: { pane_id: string } }
      >(
        'worktree.create',
        {
          cwd: repo.path,
          branch: task.branch,
          base: task.base_sha,
          path: task.worktree_path,
          label: task.title,
          focus: false,
        },
        60_000,
      );

      const workspaceId = created.workspace.workspace_id;
      this.#db
        .prepare('UPDATE task SET herdr_workspace_id = ? WHERE id = ?')
        .run(workspaceId, taskId);

      // §9 rule 5 — after the worktree exists, before the agent starts. Without this, half of
      // real repos will not even boot in a worktree.
      const mirrored = await mirrorPaths(repo.path, task.worktree_path, DEFAULT_MIRROR_PATHS);
      if (mirrored.length > 0) {
        this.#onWarning(`mirrored into worktree: ${mirrored.join(', ')}`);
      }

      // 4. The agent lane. This is the ONLY opportunity to set environment (§8.2).
      const tab = await this.#herdr.request<
        'tab.create',
        { tab: { tab_id: string }; root_pane: { pane_id: string } }
      >('tab.create', {
        workspace_id: workspaceId,
        label: 'agent',
        focus: false,
        env: {
          OSADE_TASK_ID: taskId,
          OSADE_REPO_PATH: repo.path,
        },
      });

      const paneId = tab.root_pane.pane_id;
      const tabId = tab.tab.tab_id;

      // Ensure the fact row exists so the subscriber can bind the pane to the task.
      this.#db.prepare('INSERT OR IGNORE INTO agent_fact (task_id) VALUES (?)').run(taskId);

      // 6. Subscribe BEFORE starting, so the launch transition is not missed.
      this.#subscriber.watchPane(taskId, paneId);

      // 5. Render the launch context (§8.2 step 5, §13.5). Always written, because it is the
      //    delivery mechanism whenever system-prompt args are unavailable.
      const contextPath = await this.#writeContext(task.worktree_path, task.intent, task.base_sha);

      // 7. Build args from the catalog. herdr picks the executable itself (§8.1).
      const args = this.#agentStartArgs(entry);

      // `agent.start` is not a reliable readiness signal in either direction, verified against
      // herdr 0.8.2-p20:
      //   - it can return **success** immediately with `launch_pending: true` and
      //     `agent_status: unknown`, before the agent has rendered anything;
      //   - it can return **`agent_not_ready`** when its own detector saw `blocked` during
      //     startup, which for a fresh worktree is almost always the trust prompt (§8.3).
      // So the call is made, its outcome is recorded rather than trusted, and readiness is
      // established afterwards by `#awaitAgentReady`.
      let startError: HerdrApiError | null = null;
      try {
        await this.#herdr.request(
          'agent.start',
          {
            name: `osade-${taskId}`,
            kind: entry.id,
            pane_id: paneId,
            args,
            timeout_ms: AGENT_START_TIMEOUT_MS,
          },
          AGENT_START_TIMEOUT_MS + 10_000,
        );
      } catch (err) {
        if (err instanceof HerdrApiError && err.code === 'agent_not_ready') {
          startError = err;
        } else {
          throw err;
        }
      }

      const ready = await this.#awaitAgentReady(paneId, AGENT_SETTLE_TIMEOUT_MS);
      if (!ready.interactive) {
        throw (
          startError ??
          new Error(
            `pane ${paneId}: ${entry.id} started but never became interactive. ` +
              `Last pane output:\n${ready.lastOutput.slice(-800)}`,
          )
        );
      }
      const resolvedTrustPrompt = ready.resolvedTrustPrompt;

      // 8. Best-effort checkpoint. §9.1 — a capture failure never fails a launch.
      this.#captureCheckpoint(taskId, task.base_sha, 'launch');

      return {
        workspaceId,
        tabId,
        paneId,
        worktreePath: task.worktree_path,
        contextPath,
        argsSupported: agentStartArgsSupported(),
        resolvedTrustPrompt,
      };
    });
  }

  /**
   * Args for `agent.start`, or none on a platform where herdr cannot pass them.
   *
   * **Windows limitation, verified against herdr 0.8.2-p20.** With no args, herdr submits
   * `& claude` and the agent starts. With args it submits
   * `Start-Process -FilePath claude -ArgumentList '...' -NoNewWindow -Wait -PassThru`, and
   * PowerShell's `Start-Process` cannot execute an extensionless npm shim — the pane shows
   * `%1 is not a valid Win32 application` and no agent ever appears. Since most agent CLIs on
   * Windows are npm shims, passing args there is a silent launch failure.
   *
   * So on Windows the agent starts bare and the launch context is delivered through
   * `<worktree>/.osade/CONTEXT.md` (§13.5 already provides for agents with no system-prompt
   * flag). Mode args such as `--permission-mode` are lost, which is a real capability
   * reduction and is reported rather than hidden.
   */
  #agentStartArgs(entry: ReturnType<typeof agentEntry> & object): string[] {
    if (!agentStartArgsSupported()) {
      this.#onWarning(
        `agent.start args are unsupported on this platform; starting ${entry.id} bare and ` +
          `delivering context through .osade/CONTEXT.md (mode args are not applied)`,
      );
      return [];
    }
    const args = [...entry.autonomousArgs];
    if (entry.systemPromptFlag && hasCapability(entry, 'system-prompt-injection')) {
      args.push(entry.systemPromptFlag, `@.osade/CONTEXT.md`);
    }
    return args;
  }

  /**
   * The opening prompt — §13.5.
   *
   * When system-prompt args could not be passed, the context file is referenced here instead,
   * which is exactly what §13.5 prescribes for agents without system-prompt injection.
   */
  openingPrompt(intent: string, argsSupported: boolean): string {
    if (argsSupported) return intent;
    return `First read .osade/CONTEXT.md in this worktree, then: ${intent}`;
  }

  /**
   * Waits until herdr reports the pane's agent as interactive, answering the first-run trust
   * prompt if it appears while we wait.
   *
   * This exists because `agent.start` is not a readiness signal (see the call site). The two
   * outcomes are interleaved rather than sequenced: the prompt may already be on screen when
   * the call returns, or may appear a second later, so both are handled in one loop with a
   * single deadline.
   *
   * A bounded launch handshake, not a status feed: once per launch, hard deadline, never
   * drives the UI. Live status comes from the pane subscription (§7.2), already open by now.
   */
  async #awaitAgentReady(
    paneId: string,
    timeoutMs: number,
  ): Promise<{ interactive: boolean; resolvedTrustPrompt: boolean; lastOutput: string }> {
    const deadline = this.#now() + timeoutMs;
    let resolvedTrustPrompt = false;
    let answerAttempts = 0;
    let lastOutput = '';

    while (this.#now() < deadline) {
      try {
        const info = await this.#herdr.request<
          'agent.get',
          { agent: { interactive_ready?: boolean; launch_pending?: boolean } }
        >('agent.get', { target: paneId }, 5_000);
        if (info.agent.interactive_ready === true && info.agent.launch_pending !== true) {
          return { interactive: true, resolvedTrustPrompt, lastOutput };
        }
      } catch {
        // Not yet a named agent — herdr is still detecting. Keep waiting.
      }

      lastOutput = await this.#readPane(paneId);

      // §8.3 — matched narrowly on purpose. Any other blocked state is §6 row 4, and
      // answering that on the user's behalf is the one thing this must not do.
      //
      // Re-answered while the prompt is still on screen rather than latched after one attempt:
      // keystrokes sent in the window between the text rendering and the selector accepting
      // input are simply dropped, which showed up as an intermittent 90s launch timeout.
      // Bounded so a prompt we are misreading cannot turn into an infinite keystroke loop.
      if (
        answerAttempts < MAX_TRUST_PROMPT_ANSWERS &&
        TRUST_PROMPT_MATCHES.some((m) => lastOutput.includes(m))
      ) {
        // "❯ No, exit" is selected by default, so Down then Enter picks the trust option.
        await this.#herdr.request('pane.send_keys', { pane_id: paneId, keys: ['Down'] });
        await this.#herdr.request('pane.send_keys', { pane_id: paneId, keys: ['Enter'] });
        answerAttempts++;
        resolvedTrustPrompt = true;
        // Give the TUI time to repaint before deciding whether the prompt is really gone.
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        continue;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return { interactive: false, resolvedTrustPrompt, lastOutput };
  }

  async #readPane(paneId: string): Promise<string> {
    try {
      const result = await this.#herdr.request<'pane.read', { read: { text: string } }>(
        'pane.read',
        { pane_id: paneId, source: 'visible', lines: 60, format: 'text', strip_ansi: true },
        5_000,
      );
      return result.read.text;
    } catch {
      return '';
    }
  }

  /**
   * Tears a task's herdr workspace down — §9 rule 6.
   *
   * Order matters and is not obvious: **every pane must be closed before the worktree is
   * removed.** A live shell holds its cwd open, and on Windows that makes the directory
   * undeletable — `worktree.remove` fails with `Permission denied` even with `force: true`.
   * herdr's own rule ("no live pane in the task's workspace") is therefore a hard prerequisite
   * rather than a courtesy.
   *
   * `force` still means what §9 rule 6 says: it overrides *uncommitted changes*, not live
   * panes, and belongs behind a typed confirmation in the UI.
   */
  async teardown(taskId: string, options: { force?: boolean } = {}): Promise<void> {
    const task = getTask(this.#db, taskId);
    if (!task?.herdr_workspace_id) return;

    const paneId = this.#paneFor(taskId);
    if (paneId) this.#subscriber.unwatchPane(paneId);

    const panes = await this.#herdr
      .request<'pane.list', { panes: { pane_id: string }[] }>('pane.list', {
        workspace_id: task.herdr_workspace_id,
      })
      .catch(() => ({ panes: [] as { pane_id: string }[] }));

    // Close every pane but one. `worktree.remove` is addressed by workspace id, and herdr
    // closes a workspace when its last pane goes — so closing them all leaves nothing to
    // address and the call fails with `workspace_not_found`. One pane has to survive the
    // removal.
    const [survivor, ...doomed] = panes.panes;
    for (const pane of doomed) {
      await this.#herdr.request('pane.close', { pane_id: pane.pane_id }).catch(() => {});
    }

    // …and that survivor must not be sitting in the directory about to be deleted. A shell
    // holds its working directory open, which on Windows makes the checkout undeletable and
    // surfaces as `Permission denied` from `worktree.remove` even with force. `cd ~` is valid
    // in both POSIX shells and PowerShell.
    if (survivor) {
      await this.#herdr
        .request('pane.send_input', { pane_id: survivor.pane_id, text: 'cd ~\r' })
        .catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 750));
    }

    await this.#herdr.request('worktree.remove', {
      workspace_id: task.herdr_workspace_id,
      force: options.force ?? false,
    });

    this.#db.prepare('UPDATE task SET herdr_workspace_id = NULL WHERE id = ?').run(taskId);
    this.#db
      .prepare('UPDATE agent_fact SET pane_alive = 0, herdr_pane_id = NULL WHERE task_id = ?')
      .run(taskId);
  }

  async prompt(taskId: string, text: string, wait: boolean): Promise<void> {
    const paneId = this.#paneFor(taskId);
    if (!paneId) throw new Error(`task ${taskId} has no live agent pane`);

    // §4.2 — prefer one blocking call over prompt-then-poll: each connection is a herdr thread.
    await this.#herdr.request(
      'agent.prompt',
      wait
        ? { target: paneId, text, wait: { until: ['idle', 'done', 'blocked'], timeout_ms: 300_000 } }
        : { target: paneId, text },
      wait ? 310_000 : 30_000,
    );
  }

  /** §4.4.1 — the only screen content the pinned schema exposes. On demand, at most 1 Hz. */
  async readTranscript(
    taskId: string,
    lines: number,
  ): Promise<{ text: string; revision: number; truncated: boolean } | null> {
    const paneId = this.#paneFor(taskId);
    if (!paneId) return null;
    // `pane_read` wraps its payload: { type: 'pane_read', read: PaneReadResult }.
    const result = await this.#herdr.request<
      'pane.read',
      { read: { text: string; revision: number; truncated: boolean } }
    >('pane.read', {
      pane_id: paneId,
      source: 'recent',
      lines,
      format: 'text',
      strip_ansi: true,
    });
    return {
      text: result.read.text,
      revision: result.read.revision,
      truncated: result.read.truncated,
    };
  }

  /**
   * §8.2.1 — relaunch after a herdr restart.
   *
   * herdr restores panes but not agent processes, so a restored pane is back at a shell prompt
   * and `agent_pane_busy` will not fire. Never sets `terminated`: the task is queued.
   */
  async relaunchAfterRestart(taskId: string): Promise<void> {
    const task = getTask(this.#db, taskId);
    if (!task) return;
    const fact = this.#db
      .prepare('SELECT herdr_pane_id, agent_session_id FROM agent_fact WHERE task_id = ?')
      .get(taskId) as { herdr_pane_id: string | null; agent_session_id: string | null } | undefined;
    if (!fact?.herdr_pane_id) return;

    const repo = this.#db.prepare('SELECT default_agent FROM repo WHERE id = ?').get(task.repo_id) as
      | { default_agent: string | null }
      | undefined;
    const entry = agentEntry(task.agent_id ?? repo?.default_agent ?? this.#defaultAgent);
    if (!entry) return;

    const args = [...entry.autonomousArgs];
    if (fact.agent_session_id && hasCapability(entry, 'resume')) args.push(...entry.resumeArgs);

    this.#subscriber.watchPane(taskId, fact.herdr_pane_id);
    await this.#herdr.request(
      'agent.start',
      {
        name: `osade-${taskId}`,
        kind: entry.id,
        pane_id: fact.herdr_pane_id,
        args,
        timeout_ms: AGENT_START_TIMEOUT_MS,
      },
      AGENT_START_TIMEOUT_MS + 10_000,
    );
  }

  #paneFor(taskId: string): string | null {
    const row = this.#db
      .prepare('SELECT herdr_pane_id FROM agent_fact WHERE task_id = ?')
      .get(taskId) as { herdr_pane_id: string | null } | undefined;
    return row?.herdr_pane_id ?? null;
  }

  #captureCheckpoint(taskId: string, sha: string, trigger: string): void {
    try {
      this.#db
        .prepare(
          `INSERT INTO turn_checkpoint (id, task_id, ref_name, sha, captured_at, trigger)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          `c_${randomUUID().slice(0, 8)}`,
          taskId,
          `refs/osade/turns/${taskId}/0`,
          sha,
          this.#now(),
          trigger,
        );
    } catch (err) {
      this.#onWarning(`checkpoint capture failed for ${taskId}: ${(err as Error).message}`);
    }
  }

  /**
   * §8.2 step 5 / §13.5 — render the launch context into the worktree.
   *
   * Minimal in M0; the conventions miner fills it out in M3, capped at 40 rules and ~2000
   * tokens because a 200-rule context file is worse than none.
   */
  async #writeContext(worktreePath: string, intent: string, baseSha: string): Promise<string> {
    const dir = join(worktreePath, '.osade');
    const path = join(dir, 'CONTEXT.md');
    const body = [
      '# Working in this repository through Osade',
      '',
      '## What you are working on',
      `- ${intent}`,
      `- base: ${baseSha}`,
      '',
      '## Rules',
      '- Work only inside this worktree.',
      '- Do not push, open a pull request, or comment on GitHub. Those actions are gated and',
      '  performed by Osade after human approval.',
      '',
    ].join('\n');
    await mkdir(dir, { recursive: true });
    await writeFile(path, body, 'utf8');
    return path;
  }

  async #ensureRepo(repoPath: string): Promise<string> {
    const existing = this.#db.prepare('SELECT id FROM repo WHERE path = ?').get(repoPath) as
      | { id: string }
      | undefined;
    if (existing) return existing.id;

    const branch = await defaultBranch(repoPath);
    const repoId = `r_${randomUUID().slice(0, 8)}`;
    this.#db
      .prepare(
        'INSERT INTO repo (id, path, default_branch, created_at) VALUES (?, ?, ?, ?)',
      )
      .run(repoId, repoPath, branch, this.#now());
    return repoId;
  }
}

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'task'
  );
}

/**
 * Whether `agent.start` can carry args on this platform.
 *
 * See `LaunchTask.#agentStartArgs` for the Windows failure this guards, verified against
 * herdr 0.8.2-p20.
 */
export function agentStartArgsSupported(): boolean {
  return platform() !== 'win32';
}
