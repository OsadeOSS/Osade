import type { TaskFacts, TaskStatus, VerifyRun } from '@osade/contract';

/**
 * OSADE.md §6 — THE core invariant.
 *
 * Status is a pure function over facts, recomputed on every read. It is never stored, never
 * cached in the database, and never sent from the client. This is AO's central invariant and
 * the single most important rule in the project: it is what stops a flaky probe from killing a
 * live agent, and what stops the ledger from drifting out of sync with reality.
 *
 * Pure. No I/O. No clock reads except the injected `now`.
 *
 * Rows are evaluated in order and the first match wins. The order is deliberate — see the
 * table in §6. Do not reorder without changing the spec first.
 */
export function deriveStatus(f: TaskFacts, now: number): TaskStatus {
  void now; // Reserved for gate expiry (§14.2); no row consults the clock yet.

  const { task, agent, scm } = f;

  // 1. Merged wins over everything, including an undecided gate: the work is done and any
  //    outstanding request against it is moot.
  if (scm?.pr_state === 'merged') return 'merged';

  // 2. Archived is a user decision and outranks live signals.
  if (task.archived_at != null) return 'archived';

  // 3–5 and 10 are the needs-you set. The ledger sorts on it.

  // 3. An undecided gate is the loudest thing in the product.
  if (f.openGates.some((g) => g.decided_at == null)) return 'awaiting_approval';

  // 4. herdr says the agent is waiting on a human.
  if (agent?.herdr_state === 'blocked') return 'needs_input';

  // 5. A human reviewer wants something.
  if (scm?.review_state === 'changes_requested') return 'review_changes_requested';
  if ((scm?.unresolved_threads ?? 0) > 0) return 'review_changes_requested';

  // 6. CI failed.
  if (scm?.checks_state === 'failure') return 'ci_failed';

  // 7. Local verification failed against the *current* head. A failure against an older commit
  //    is stale and must not gate — that is what `head_sha` on `verify_run` is for.
  if (failedRequiredRunForCurrentHead(f)) return 'verify_failed';

  // 8. A verification run is open.
  if (f.verifyRuns.some((r) => r.finished_at == null)) return 'verifying';

  // 9. There is an open PR and nothing above needs attention.
  if (scm?.pr_state === 'open') return 'pr_open';

  // 10. The agent finished a turn and nothing has restarted it. herdr's `done`, and only
  //     `done`, produces `to_review` — see §6.1 on why `idle` is inert.
  if (agent?.last_event === 'to_review') return 'awaiting_review';

  // 11. Working.
  if (agent?.herdr_state === 'working') return 'implementing';

  // 12. Explicitly stopped. §5.2 — only an explicit process exit or user action sets this;
  //     never a failed probe and never a dropped event.
  if (agent?.terminated === true) return 'stopped';

  // 13. Not started yet. Also covers the herdr-restart case (§6, PRD-DELTA #11): herdr restores
  //     panes but not agent processes, so a restored task has a live workspace and a pane with
  //     no agent bound. That is work to start, not an idle task — and not a death.
  if (!agent || agent.pane_alive === false) return 'queued';
  if (task.herdr_workspace_id != null && agent.herdr_state == null) return 'queued';

  // 14. Alive, bound, and quiet.
  return 'idle';
}

/**
 * True when the newest required run for the task's current head failed.
 *
 * Scoped to `head_sha` per §6. Multiple runs may exist for one step across retries, so this
 * takes the latest run per step and asks whether that one failed.
 */
function failedRequiredRunForCurrentHead(f: TaskFacts): boolean {
  const head = currentHeadSha(f);
  if (head == null) return false;

  const latestByStep = new Map<string, VerifyRun>();
  for (const run of f.verifyRuns) {
    if (!run.required) continue;
    if (run.head_sha !== head) continue;
    if (run.finished_at == null) continue;
    const existing = latestByStep.get(run.step_name);
    if (existing == null || run.started_at >= existing.started_at) {
      latestByStep.set(run.step_name, run);
    }
  }

  for (const run of latestByStep.values()) {
    if (run.exit_code !== 0) return true;
  }
  return false;
}

/**
 * What "current head" means for verification scoping.
 *
 * The PR head when there is one, else the pinned base — a task with no commits yet has nothing
 * newer to verify against.
 */
function currentHeadSha(f: TaskFacts): string | null {
  return f.scm?.pr_head_sha ?? f.task.base_sha ?? null;
}
