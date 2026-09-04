import type { AgentEvent, AgentFact, HerdrAgentStatus } from '@osade/contract';

/**
 * OSADE.md §6.1 — the narrow event vocabulary, and §5.4.1 — the monotonic fact gate.
 *
 * Pure. `(facts, event) -> factPatch`. No I/O.
 */

/** A herdr `pane.agent_status_changed` event, reduced to what Osade actually consumes. */
export interface StatusChangedInput {
  kind: 'status';
  status: HerdrAgentStatus;
  /**
   * `AgentInfo.state_change_seq`, or `PaneInfo.revision` where that is what the payload
   * carries. §5.4.1 — writes are gated on this being strictly greater than what is stored.
   */
  seq: number;
  at: number;
  /** `terminal_title_stripped` when herdr sent one. Display only. */
  activityText?: string | null;
}

/** A herdr `pane.exited`. §5.2 — pane death is not agent termination unless it was explicit. */
export interface PaneExitedInput {
  kind: 'pane_exited';
  seq: number;
  at: number;
  /** True only for an observed process exit, never for a dropped event or a failed probe. */
  explicit: boolean;
}

/**
 * An `AgentInfo.agent_session` binding, for resume after a herdr restart (§8.2.1).
 *
 * Deliberately carries no `seq`: a session binding is not a state change, so it must not
 * advance `state_change_seq`. See `reduceAgentInput` for why that distinction is load-bearing.
 */
export interface SessionBoundInput {
  kind: 'session';
  at: number;
  agentSessionId: string;
}

export type AgentInput = StatusChangedInput | PaneExitedInput | SessionBoundInput;

export type AgentFactPatch = Partial<AgentFact>;

export interface ReduceResult {
  /** Null when the input was dropped. */
  patch: AgentFactPatch | null;
  /** Why it was dropped, for logging. Never surfaced to the UI. */
  dropped?: 'stale_seq';
}

/**
 * INVARIANT (§6.1): exactly three internal events, and `idle` is never a transition.
 *
 * herdr reports `done` when a pane is idle **and unseen**, `idle` once seen — the difference is
 * about the viewer, not the agent (`backend/src/app/api_helpers.rs:100-106`). So opening a task
 * in herdr flips `done → idle` for the same agent in the same state. If `idle` mapped to
 * `to_in_progress` that would silently clear the task's `awaiting_review`; if it mapped to
 * `to_review` a freshly launched, never-prompted agent would land in the needs-you set at once.
 * Both were live bugs in the original §7 table. `idle` is therefore inert in both directions.
 */
export function eventForStatus(status: HerdrAgentStatus): AgentEvent | null {
  switch (status) {
    case 'working':
      return 'to_in_progress';
    case 'done':
      return 'to_review';
    case 'blocked':
    case 'idle':
    case 'unknown':
      return null;
  }
}

/**
 * Applies one herdr input to the stored fact.
 *
 * §5.4.1 — INVARIANT: herdr's event stream replays the ring buffer on connect and can drop
 * silently, and its envelopes carry no sequence number. So a **state change** whose `seq` is
 * not strictly greater than the stored `state_change_seq` is dropped, not merged. This is what
 * stops a replayed `working` from clobbering a live `done`.
 *
 * The caller must write `patch` and `state_change_seq` in one transaction. A fact stored
 * without advancing the counter, or a counter advanced without the fact, reintroduces the bug.
 *
 * **Only state changes participate in the gate.** A session binding carries no state, so it
 * neither consults nor advances the counter. Letting it advance the watermark would make the
 * fold order-dependent: a session binding stamped with a high `seq` would swallow every
 * status event below it and leave the fact stuck at whatever it happened to hold — which is
 * the exact class of bug the gate exists to prevent, reintroduced from the other side. The
 * ordering property test in `test/unit/derive-status.test.ts` pins this down.
 */
export function reduceAgentInput(current: AgentFact | null, input: AgentInput): ReduceResult {
  if (input.kind === 'session') {
    // Idempotent and independent of the status fold, so it converges under any ordering.
    return { patch: { agent_session_id: input.agentSessionId } };
  }

  const storedSeq = current?.state_change_seq ?? -1;
  if (input.seq <= storedSeq) return { patch: null, dropped: 'stale_seq' };

  const base: AgentFactPatch = { state_change_seq: input.seq };

  switch (input.kind) {
    case 'status': {
      const event = eventForStatus(input.status);
      const patch: AgentFactPatch = {
        ...base,
        herdr_state: input.status,
        pane_alive: true,
        // An agent reporting status is alive; a prior probe failure is no longer interesting.
        probe_failures: 0,
      };
      if (event != null) {
        patch.last_event = event;
        patch.last_event_at = input.at;
      }
      if (input.activityText !== undefined) {
        patch.activity_text = input.activityText;
        // §6.1 — `activity` is never a transition; it only updates the display string.
        if (event == null) {
          patch.last_event = 'activity';
          patch.last_event_at = input.at;
        }
      }
      return { patch };
    }

    case 'pane_exited': {
      return {
        patch: {
          ...base,
          pane_alive: false,
          herdr_state: 'unknown',
          // §5.2 — `terminated` is set only by an explicit exit. A pane vanishing because herdr
          // restarted is not a death: §8.2.1 relaunches into the restored pane.
          ...(input.explicit ? { terminated: true } : {}),
        },
      };
    }

  }
}

/** A fresh fact row for a task whose agent lane exists but has not reported yet. */
export function emptyAgentFact(taskId: string): AgentFact {
  return {
    task_id: taskId,
    herdr_pane_id: null,
    herdr_state: null,
    last_event: null,
    last_event_at: null,
    activity_text: null,
    tool_name: null,
    final_message: null,
    agent_session_id: null,
    pane_alive: false,
    last_probe_at: null,
    probe_failures: 0,
    terminated: false,
    state_change_seq: 0,
    controller_generation: 0,
  };
}
