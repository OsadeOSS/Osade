import { describe, expect, it } from 'vitest';

import type { AgentFact, GateRequest, ScmFact, Task, TaskFacts, VerifyRun } from '@osade/contract';
import { TaskStatus } from '@osade/contract';

import { deriveStatus } from '../../src/domain/derive-status.js';
import {
  emptyAgentFact,
  reduceAgentInput,
  type AgentInput,
} from '../../src/domain/agent-reducer.js';

const NOW = 1_756_000_000_000;
const HEAD = 'aaaaaaa';

function task(over: Partial<Task> = {}): Task {
  return {
    id: 't1',
    repo_id: 'r1',
    title: 'fix the thing',
    intent: 'fix the thing',
    origin_kind: 'manual',
    origin_ref: null,
    agent_id: null,
    base_ref: 'main',
    base_sha: HEAD,
    branch: 'osade/fix-thing-t1',
    worktree_path: '/wt/t1',
    herdr_workspace_id: null,
    archived_at: null,
    created_at: NOW - 1000,
    ...over,
  };
}

function agent(over: Partial<AgentFact> = {}): AgentFact {
  return { ...emptyAgentFact('t1'), ...over };
}

function scm(over: Partial<ScmFact> = {}): ScmFact {
  return {
    task_id: 't1',
    pr_number: null,
    pr_url: null,
    pr_state: null,
    pr_head_sha: null,
    pr_draft: null,
    checks_state: null,
    review_state: null,
    unresolved_threads: 0,
    mergeable: null,
    fetched_at: NOW,
    fetch_failed_at: null,
    ...over,
  };
}

function gate(over: Partial<GateRequest> = {}): GateRequest {
  return {
    id: 'g1',
    task_id: 't1',
    gate: 'gate.pr_open',
    payload_json: '{}',
    payload_hash: 'h',
    requested_at: NOW,
    decided_at: null,
    decision: null,
    decided_by: null,
    executed_at: null,
    execution_error: null,
    ...over,
  };
}

function run(over: Partial<VerifyRun> = {}): VerifyRun {
  return {
    id: 'v1',
    task_id: 't1',
    step_name: 'test',
    cmd: 'pnpm test',
    started_at: NOW - 100,
    finished_at: NOW,
    exit_code: 0,
    required: true,
    head_sha: HEAD,
    log_path: '/runs/v1',
    ...over,
  };
}

function facts(over: Partial<TaskFacts> = {}): TaskFacts {
  return { task: task(), agent: null, scm: null, openGates: [], verifyRuns: [], ...over };
}

describe('deriveStatus — the §6 table, row by row', () => {
  it('1. merged outranks everything, including an open gate', () => {
    expect(
      deriveStatus(
        facts({ scm: scm({ pr_state: 'merged' }), openGates: [gate()] }),
        NOW,
      ),
    ).toBe('merged');
  });

  it('2. archived outranks live agent signals', () => {
    expect(
      deriveStatus(
        facts({ task: task({ archived_at: NOW }), agent: agent({ herdr_state: 'working' }) }),
        NOW,
      ),
    ).toBe('archived');
  });

  it('3. an undecided gate outranks a blocked agent', () => {
    expect(
      deriveStatus(
        facts({ openGates: [gate()], agent: agent({ herdr_state: 'blocked' }) }),
        NOW,
      ),
    ).toBe('awaiting_approval');
  });

  it('3. a decided gate does not gate', () => {
    expect(
      deriveStatus(
        facts({ openGates: [gate({ decided_at: NOW, decision: 'approve' })] }),
        NOW,
      ),
    ).toBe('queued');
  });

  it('4. blocked → needs_input', () => {
    expect(deriveStatus(facts({ agent: agent({ herdr_state: 'blocked' }) }), NOW)).toBe(
      'needs_input',
    );
  });

  it('5. changes_requested and unresolved threads both → review_changes_requested', () => {
    expect(deriveStatus(facts({ scm: scm({ review_state: 'changes_requested' }) }), NOW)).toBe(
      'review_changes_requested',
    );
    expect(deriveStatus(facts({ scm: scm({ unresolved_threads: 2 }) }), NOW)).toBe(
      'review_changes_requested',
    );
  });

  it('6. ci failure', () => {
    expect(deriveStatus(facts({ scm: scm({ checks_state: 'failure' }) }), NOW)).toBe('ci_failed');
  });

  it('7. a failed required run against the current head gates', () => {
    expect(deriveStatus(facts({ verifyRuns: [run({ exit_code: 1 })] }), NOW)).toBe('verify_failed');
  });

  it('7. a failed run against an OLDER head is stale and does not gate', () => {
    expect(
      deriveStatus(facts({ verifyRuns: [run({ exit_code: 1, head_sha: 'older' })] }), NOW),
    ).toBe('queued');
  });

  it('7. a failed optional run does not gate', () => {
    expect(
      deriveStatus(facts({ verifyRuns: [run({ exit_code: 1, required: false })] }), NOW),
    ).toBe('queued');
  });

  it('7. a later passing run for the same step supersedes an earlier failure', () => {
    const failed = run({ id: 'v1', exit_code: 1, started_at: NOW - 200 });
    const passed = run({ id: 'v2', exit_code: 0, started_at: NOW - 100 });
    expect(deriveStatus(facts({ verifyRuns: [failed, passed] }), NOW)).toBe('queued');
    // and order of the array must not matter
    expect(deriveStatus(facts({ verifyRuns: [passed, failed] }), NOW)).toBe('queued');
  });

  it('8. an open run → verifying', () => {
    expect(
      deriveStatus(facts({ verifyRuns: [run({ finished_at: null, exit_code: null })] }), NOW),
    ).toBe('verifying');
  });

  it('9. an open PR with nothing wrong', () => {
    expect(deriveStatus(facts({ scm: scm({ pr_state: 'open' }) }), NOW)).toBe('pr_open');
  });

  it('10. to_review → awaiting_review', () => {
    expect(
      deriveStatus(
        facts({ agent: agent({ last_event: 'to_review', pane_alive: true }) }),
        NOW,
      ),
    ).toBe('awaiting_review');
  });

  it('10. a newer to_in_progress supersedes to_review', () => {
    expect(
      deriveStatus(
        facts({
          agent: agent({ last_event: 'to_in_progress', herdr_state: 'working', pane_alive: true }),
        }),
        NOW,
      ),
    ).toBe('implementing');
  });

  it('11. working → implementing', () => {
    expect(
      deriveStatus(facts({ agent: agent({ herdr_state: 'working', pane_alive: true }) }), NOW),
    ).toBe('implementing');
  });

  it('12. explicit termination → stopped', () => {
    expect(
      deriveStatus(
        facts({ agent: agent({ terminated: true, pane_alive: true, herdr_state: 'idle' }) }),
        NOW,
      ),
    ).toBe('stopped');
  });

  it('13. no agent → queued', () => {
    expect(deriveStatus(facts(), NOW)).toBe('queued');
  });

  it('13. a restored herdr pane with no bound agent is queued, not idle (PRD-DELTA #11)', () => {
    // herdr restores panes but not agent processes: the workspace is back, the pane is alive,
    // and `agent`/`agent_status` come back null. That is work to start, and never a death.
    const restored = facts({
      task: task({ herdr_workspace_id: 'w3' }),
      agent: agent({ pane_alive: true, herdr_state: null, herdr_pane_id: 'w3:p2' }),
    });
    expect(deriveStatus(restored, NOW)).toBe('queued');
    expect(restored.agent?.terminated).toBe(false);
  });

  it('14. alive, bound and quiet → idle', () => {
    expect(
      deriveStatus(
        facts({
          task: task({ herdr_workspace_id: 'w3' }),
          agent: agent({ pane_alive: true, herdr_state: 'idle' }),
        }),
        NOW,
      ),
    ).toBe('idle');
  });

  it('probe_failures never appear in the table (§5.2)', () => {
    const flaky = facts({
      task: task({ herdr_workspace_id: 'w3' }),
      agent: agent({ pane_alive: true, herdr_state: 'working', probe_failures: 99 }),
    });
    // A flaky liveness check must not kill a live agent. This is the specific AO bug.
    expect(deriveStatus(flaky, NOW)).toBe('implementing');
  });
});

describe('deriveStatus — properties (§20.2)', () => {
  const statuses = new Set(TaskStatus.options);

  /** A small, exhaustive-ish space of fact combinations. */
  function* factSpace(): Generator<TaskFacts> {
    const archived = [null, NOW];
    const prStates = [null, 'open', 'closed', 'merged'] as const;
    const agentStates = [null, 'idle', 'working', 'blocked', 'done', 'unknown'] as const;
    const events = [null, 'to_in_progress', 'to_review', 'activity'] as const;
    const gates = [[], [gate()], [gate({ decided_at: NOW, decision: 'deny' })]];

    for (const a of archived)
      for (const pr of prStates)
        for (const st of agentStates)
          for (const ev of events)
            for (const g of gates)
              yield facts({
                task: task({ archived_at: a, herdr_workspace_id: 'w3' }),
                agent: agent({ herdr_state: st, last_event: ev, pane_alive: true }),
                scm: pr == null ? null : scm({ pr_state: pr }),
                openGates: g,
              });
  }

  it('every fact set yields exactly one valid status', () => {
    let n = 0;
    for (const f of factSpace()) {
      const s = deriveStatus(f, NOW);
      expect(statuses.has(s)).toBe(true);
      n++;
    }
    expect(n).toBeGreaterThan(500);
  });

  it('is a pure function — same input, same output, no clock dependence', () => {
    for (const f of factSpace()) {
      const a = deriveStatus(f, NOW);
      const b = deriveStatus(structuredClone(f), NOW + 86_400_000);
      expect(b).toBe(a);
    }
  });

  it('no ordering of fact writes changes the final status', () => {
    // §20.2 — the property that matters: the reducer is order-independent given sequence
    // numbers, so replay and reordering land on the same place as an in-order stream.
    const inputs: AgentInput[] = [
      { kind: 'status', status: 'working', seq: 1, at: NOW - 300 },
      { kind: 'status', status: 'blocked', seq: 2, at: NOW - 200 },
      { kind: 'status', status: 'working', seq: 3, at: NOW - 100 },
      { kind: 'status', status: 'done', seq: 4, at: NOW },
      { kind: 'session', seq: 5, at: NOW, agentSessionId: 'sess-1' },
    ];

    const inOrder = applyAll(inputs);
    for (const permutation of permutations(inputs)) {
      const shuffled = applyAll(permutation);
      expect(shuffled.herdr_state).toBe(inOrder.herdr_state);
      expect(shuffled.last_event).toBe(inOrder.last_event);
      expect(shuffled.state_change_seq).toBe(inOrder.state_change_seq);
      expect(deriveStatus(facts({ agent: shuffled }), NOW)).toBe(
        deriveStatus(facts({ agent: inOrder }), NOW),
      );
    }
  });
});

function applyAll(inputs: readonly AgentInput[]): AgentFact {
  let fact = emptyAgentFact('t1');
  for (const input of inputs) {
    const { patch } = reduceAgentInput(fact, input);
    if (patch != null) fact = { ...fact, ...patch };
  }
  return fact;
}

function* permutations<T>(items: readonly T[]): Generator<T[]> {
  if (items.length <= 1) {
    yield [...items];
    return;
  }
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permutations(rest)) yield [items[i]!, ...p];
  }
}
