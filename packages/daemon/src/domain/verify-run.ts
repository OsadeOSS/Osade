import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Db } from '../db/index.js';
import { getTask } from '../db/task-repo.js';
import type { HerdrClient } from '../herdr/client.js';
import { runDirFor } from '../paths.js';
import type { VerifyPlan, VerifyStep } from './verify-plan.js';

/**
 * Running verification — OSADE.md §10.2.
 *
 * Runs execute **in the task worktree, in the `verify` lane** (a herdr tab), so the user can
 * watch and interrupt. One `verify_run` row per step. Output goes to `~/.osade/runs/<run_id>/`,
 * capped with head+tail retention.
 *
 * On failure the tail plus the failing command goes back into the agent lane. That closed loop
 * — *agent acts, environment answers, agent adapts* — is the thing the product is organised
 * around, and it is the demo.
 */

/** §10.2 — capped at 2 MiB with head+tail retention. */
const LOG_CAP_BYTES = 2 * 1024 * 1024;
const LOG_HEAD_BYTES = 512 * 1024;

/** How much of a failure the agent is shown. Enough to act on, not enough to drown in. */
const FAILURE_TAIL_LINES = 60;

export interface VerifyOutcome {
  runId: string;
  stepName: string;
  exitCode: number | null;
  required: boolean;
  logPath: string;
}

export interface VerifyReport {
  headSha: string;
  outcomes: VerifyOutcome[];
  /** True when every required step for this head exited 0. */
  passed: boolean;
}

export interface VerifyRunnerOptions {
  now?: () => number;
  onWarning?: (message: string) => void;
  /**
   * Closes the loop — §10.2. On failure the tail plus the failing command goes back into the
   * agent lane. Injected rather than imported so the runner does not depend on the launcher,
   * which already depends on plenty.
   */
  sendToAgent?: (taskId: string, text: string) => Promise<void>;
}

export class VerifyRunner {
  readonly #db: Db;
  readonly #herdr: HerdrClient;
  readonly #now: () => number;
  readonly #onWarning: (message: string) => void;
  readonly #sendToAgent: ((taskId: string, text: string) => Promise<void>) | null;

  constructor(db: Db, herdr: HerdrClient, options: VerifyRunnerOptions = {}) {
    this.#db = db;
    this.#herdr = herdr;
    this.#now = options.now ?? Date.now;
    this.#onWarning = options.onWarning ?? (() => {});
    this.#sendToAgent = options.sendToAgent ?? null;
  }

  /**
   * Runs a plan against a task's current head.
   *
   * `headSha` scopes every row: §6 makes `verify_failed` stale the moment the head moves, so a
   * run that is not tagged with the commit it verified cannot gate anything correctly.
   */
  async run(taskId: string, plan: VerifyPlan, headSha: string): Promise<VerifyReport> {
    const task = getTask(this.#db, taskId);
    if (!task) throw new Error(`unknown task ${taskId}`);
    if (plan.needsReview) {
      // §10.1 — an inferred plan is never run silently the first time.
      throw new Error(
        `the verification plan for ${taskId} has not been reviewed. ` +
          `Show it to the user and confirm it before running.`,
      );
    }

    const paneId = await this.#ensureVerifyLane(taskId, task.herdr_workspace_id);
    const outcomes: VerifyOutcome[] = [];

    for (const step of plan.steps) {
      const outcome = await this.#runStep(taskId, step, headSha, paneId);
      outcomes.push(outcome);

      // §10.2 — stop at the first required failure and hand it straight back. Running the
      // remaining steps would bury the thing the agent actually has to fix, and every step
      // after a failed typecheck is going to fail for the same reason anyway.
      if (outcome.required && outcome.exitCode !== 0) {
        await this.#closeTheLoop(taskId, step, outcome);
        break;
      }
    }

    const passed = outcomes.every((o) => !o.required || o.exitCode === 0);
    return { headSha, outcomes, passed };
  }

  /**
   * *Agent acts, environment answers, agent adapts* — §10.2.
   *
   * This is the loop the whole product is organised around, and it is the demo. A failure that
   * only lands in a log file is a failure the agent never sees.
   */
  async #closeTheLoop(taskId: string, step: VerifyStep, outcome: VerifyOutcome): Promise<void> {
    if (!this.#sendToAgent) {
      this.#onWarning(
        `verification failed for ${taskId} but no agent channel is wired; the agent was not told`,
      );
      return;
    }

    let log = '';
    try {
      log = await readFile(outcome.logPath, 'utf8');
    } catch {
      // The prompt is still worth sending without the log: the failing command is the
      // load-bearing half.
    }

    try {
      await this.#sendToAgent(taskId, failureLoopPrompt(outcome, step.cmd, log));
    } catch (err) {
      // A prompt that cannot be delivered is a degraded loop, not a failed verification: the
      // run rows are already durable and §6 row 7 will show `verify_failed` regardless.
      this.#onWarning(
        `could not send the verification failure to ${taskId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * The `verify` lane is created on first use — §8.2 step 4.
   *
   * Environment can only be set when a tab is created (§8.2), so the lane carries
   * `OSADE_TASK_ID` from birth exactly as the agent lane does.
   */
  async #ensureVerifyLane(taskId: string, workspaceId: string | null): Promise<string | null> {
    if (!workspaceId) return null;

    const existing = this.#db
      .prepare("SELECT value FROM task_lane WHERE task_id = ? AND lane = 'verify'")
      .get(taskId) as { value: string } | undefined;
    if (existing) return existing.value;

    try {
      const tab = await this.#herdr.request<
        'tab.create',
        { tab: { tab_id: string }; root_pane: { pane_id: string } }
      >('tab.create', {
        workspace_id: workspaceId,
        label: 'verify',
        focus: false,
        env: { OSADE_TASK_ID: taskId },
      });
      const paneId = tab.root_pane.pane_id;
      this.#db
        .prepare("INSERT OR REPLACE INTO task_lane (task_id, lane, value) VALUES (?, 'verify', ?)")
        .run(taskId, paneId);
      return paneId;
    } catch (err) {
      // A missing lane degrades the experience — the user cannot watch — but it must not stop
      // verification from running.
      this.#onWarning(`could not create the verify lane for ${taskId}: ${(err as Error).message}`);
      return null;
    }
  }

  async #runStep(
    taskId: string,
    step: VerifyStep,
    headSha: string,
    paneId: string | null,
  ): Promise<VerifyOutcome> {
    const runId = `v_${randomUUID().slice(0, 8)}`;
    const logDir = runDirFor(runId);
    const logPath = join(logDir, 'output.log');
    await mkdir(logDir, { recursive: true });

    // The row is written *before* the command runs, with `finished_at` null — that is what
    // §6 row 8 reads as `verifying`. A row written only on completion would make a running
    // verification invisible.
    this.#db
      .prepare(
        `INSERT INTO verify_run (id, task_id, step_name, cmd, started_at, required, head_sha, log_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(runId, taskId, step.name, step.cmd, this.#now(), step.required ? 1 : 0, headSha, logPath);

    const { exitCode, output } = await this.#execute(step, paneId, taskId);
    await writeFile(logPath, capLog(output), 'utf8');

    this.#db
      .prepare('UPDATE verify_run SET finished_at = ?, exit_code = ? WHERE id = ?')
      .run(this.#now(), exitCode, runId);

    return { runId, stepName: step.name, exitCode, required: step.required, logPath };
  }

  /**
   * Executes one step in the verify lane.
   *
   * herdr owns process execution (§1), so this drives the lane rather than spawning: the user
   * can watch it and interrupt it, which is the whole reason §10.2 puts runs in a lane.
   *
   * An exit code is recovered by echoing it — herdr's API has no "run and give me the status"
   * method, and inventing one in Osade would be reimplementing what herdr already owns.
   */
  async #execute(
    step: VerifyStep,
    paneId: string | null,
    taskId: string,
  ): Promise<{ exitCode: number | null; output: string }> {
    if (!paneId) {
      return { exitCode: null, output: `no verify lane for ${taskId}; step was not run` };
    }

    const sentinel = `__osade_verify_${randomUUID().slice(0, 8)}__`;
    // Portable across POSIX shells and PowerShell: both expand $? / $LASTEXITCODE poorly in
    // common, so the marker carries the code inline and is matched back out of the transcript.
    const command =
      process.platform === 'win32'
        ? `${step.cmd}; Write-Output "${sentinel}:$LASTEXITCODE"`
        : `${step.cmd}; echo "${sentinel}:$?"`;

    await this.#herdr.request('pane.send_input', { pane_id: paneId, text: `${command}\r` });

    const deadline = this.#now() + step.timeoutSec * 1000;
    let output = '';
    while (this.#now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      output = await this.#readLane(paneId);
      const match = output.match(new RegExp(`${sentinel}:(-?\\d+)`));
      if (match) return { exitCode: Number(match[1]), output };
    }

    // A timeout is a fact, not a pass. Null exit code reads as failure in §6 row 7.
    this.#onWarning(`verify step "${step.name}" timed out after ${step.timeoutSec}s`);
    return { exitCode: null, output };
  }

  async #readLane(paneId: string): Promise<string> {
    try {
      const result = await this.#herdr.request<'pane.read', { read: { text: string } }>(
        'pane.read',
        { pane_id: paneId, source: 'recent', lines: 1000, format: 'text', strip_ansi: true },
        10_000,
      );
      return result.read.text;
    } catch {
      return '';
    }
  }
}

/**
 * §10.2 — head + tail retention rather than a plain truncation.
 *
 * A build failure is usually legible from its start (what ran) and its end (what broke); the
 * middle is the part nobody reads.
 */
export function capLog(text: string, cap = LOG_CAP_BYTES, head = LOG_HEAD_BYTES): string {
  if (Buffer.byteLength(text, 'utf8') <= cap) return text;
  const tailBytes = cap - head;
  const headText = text.slice(0, head);
  const tailText = text.slice(-tailBytes);
  return `${headText}\n\n… ${Buffer.byteLength(text, 'utf8') - cap} bytes elided …\n\n${tailText}`;
}

/**
 * The failure message sent back into the agent lane — §10.2.
 *
 * Deliberately the failing command plus a bounded tail, in the interface's voice: state what
 * broke and the command that broke it, never apologise (§19.4).
 */
export function failureLoopPrompt(outcome: VerifyOutcome, cmd: string, log: string): string {
  const tail = log.split('\n').slice(-FAILURE_TAIL_LINES).join('\n');
  return [
    `Verification failed: \`${cmd}\` exited ${outcome.exitCode ?? 'without a status (timed out)'}.`,
    '',
    'Last output:',
    '```',
    tail,
    '```',
    '',
    'Fix this in the worktree, then say so. Do not push or open a pull request.',
  ].join('\n');
}
