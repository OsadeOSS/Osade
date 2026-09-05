import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDb, type Db } from '../../src/db/index.js';
import {
  GATES,
  GATE_TTL_MS,
  GateError,
  Gates,
  gatePolicy,
  hashPayload,
  undoTurnNeedsHuman,
} from '../../src/domain/gates.js';

const NOW = 1_756_000_000_000;

let db: Db;
let clock = NOW;

function seed(): void {
  db.prepare('INSERT INTO org (id, name, created_at) VALUES (?,?,?)').run('o1', 'a', NOW);
  db.prepare(
    'INSERT INTO repo (id, org_id, path, default_branch, created_at) VALUES (?,?,?,?,?)',
  ).run('r1', 'o1', '/repo', 'main', NOW);
  db.prepare(
    `INSERT INTO task (id, repo_id, title, intent, origin_kind, base_ref, base_sha, branch,
                       worktree_path, created_at)
     VALUES ('t1','r1','x','x','manual','main','h','b','/wt', ?)`,
  ).run(NOW);
}

function gates(policies?: Record<string, string>): Gates {
  return new Gates(db, { now: () => clock, policies: policies as never });
}

beforeEach(() => {
  clock = NOW;
  db = openDb(':memory:');
  seed();
});

afterEach(() => db.close());

describe('§14.1 — the gate list', () => {
  it('every public write defaults to human approval', () => {
    for (const gate of [
      'gate.push',
      'gate.pr_open',
      'gate.pr_comment',
      'gate.issue_comment',
      'gate.review_submit',
      'gate.force_push',
      'gate.branch_delete',
    ] as const) {
      expect(gatePolicy(gate).def, `${gate} must default to human`).toBe('human');
    }
  });

  it('force_push and file_write_outside_worktree can never be downgraded by policy', () => {
    expect(gatePolicy('gate.force_push').overridable).toBe(false);
    expect(gatePolicy('gate.file_write_outside_worktree').overridable).toBe(false);
  });

  it('a policy downgrade is recorded in decided_by, never silent', () => {
    const id = gates({ 'gate.pr_comment': 'trusted-repo' }).request({
      taskId: 't1',
      gate: 'gate.pr_comment',
      payload: { body: 'hi' },
    });
    const row = db.prepare('SELECT * FROM gate_request WHERE id = ?').get(id) as {
      decision: string;
      decided_by: string;
    };
    expect(row.decision).toBe('approve');
    // §14.1 — the audit trail never loses who decided.
    expect(row.decided_by).toBe('policy:trusted-repo');
  });

  it('a policy cannot downgrade force_push', () => {
    const id = gates({ 'gate.force_push': 'yolo' }).request({
      taskId: 't1',
      gate: 'gate.force_push',
      payload: { ref: 'main' },
    });
    const row = db.prepare('SELECT decided_at FROM gate_request WHERE id = ?').get(id) as {
      decided_at: number | null;
    };
    expect(row.decided_at).toBe(null);
  });
});

describe('§11.2 — payload hashing binds an approval to exact bytes', () => {
  it('hashing is stable across key order', () => {
    expect(hashPayload({ a: 1, b: 2 })).toBe(hashPayload({ b: 2, a: 1 }));
  });

  it('hashing distinguishes different content', () => {
    expect(hashPayload({ body: 'LGTM' })).not.toBe(hashPayload({ body: 'LGTM ' }));
  });

  it('an approved gate executes against the approved payload', () => {
    const g = gates();
    const payload = { body: 'Thanks — fixed in 3f2a1b.' };
    const id = g.request({ taskId: 't1', gate: 'gate.pr_comment', payload });
    g.decide(id, 'approve');
    expect(() => g.assertExecutable(id, payload)).not.toThrow();
  });

  it('THE invariant: a changed payload aborts execution', () => {
    const g = gates();
    const approved = { body: 'Thanks — fixed in 3f2a1b.' };
    const id = g.request({ taskId: 't1', gate: 'gate.pr_comment', payload: approved });
    g.decide(id, 'approve');

    // The human approved one comment; something now wants to post a different one.
    expect(() => g.assertExecutable(id, { body: 'Merging this myself.' })).toThrow(GateError);
    expect(() => g.assertExecutable(id, { body: 'Merging this myself.' })).toThrow(
      /payload changed after approval/,
    );
  });

  it('edit-and-approve re-hashes, so the edit is what is bound', () => {
    const g = gates();
    const id = g.request({ taskId: 't1', gate: 'gate.pr_comment', payload: { body: 'orig' } });
    g.editAndApprove(id, { body: 'edited' });

    expect(() => g.assertExecutable(id, { body: 'edited' })).not.toThrow();
    expect(() => g.assertExecutable(id, { body: 'orig' })).toThrow(/payload changed/);
  });

  it('a denied gate never executes', () => {
    const g = gates();
    const payload = { body: 'x' };
    const id = g.request({ taskId: 't1', gate: 'gate.pr_comment', payload });
    g.decide(id, 'deny');
    expect(() => g.assertExecutable(id, payload)).toThrow(/was deny, not approved/);
  });

  it('an undecided gate never executes', () => {
    const g = gates();
    const payload = { body: 'x' };
    const id = g.request({ taskId: 't1', gate: 'gate.pr_comment', payload });
    expect(() => g.assertExecutable(id, payload)).toThrow(/has not been decided/);
  });

  it('a gate executes at most once', () => {
    const g = gates();
    const payload = { body: 'x' };
    const id = g.request({ taskId: 't1', gate: 'gate.pr_comment', payload });
    g.decide(id, 'approve');
    g.assertExecutable(id, payload);
    g.markExecuted(id);
    expect(() => g.assertExecutable(id, payload)).toThrow(/already executed/);
  });

  it('a decided gate cannot be decided twice', () => {
    const g = gates();
    const id = g.request({ taskId: 't1', gate: 'gate.pr_comment', payload: { body: 'x' } });
    g.decide(id, 'approve');
    expect(() => g.decide(id, 'deny')).toThrow(/already decided/);
  });
});

describe('§14.2 — expiry', () => {
  it('an undecided gate expires after 24h, and expiry is not a denial', () => {
    const g = gates();
    const id = g.request({ taskId: 't1', gate: 'gate.push', payload: {} });

    clock = NOW + GATE_TTL_MS + 1;
    expect(g.expireStale()).toBe(1);

    const row = db.prepare('SELECT * FROM gate_request WHERE id = ?').get(id) as {
      decision: string;
      decided_by: string;
    };
    expect(row.decision).toBe('expired');
    expect(row.decision).not.toBe('deny');
    expect(row.decided_by).toBe('policy:ttl');
  });

  it('an approval that sat too long will not execute', () => {
    const g = gates();
    const payload = { ref: 'main' };
    const id = g.request({ taskId: 't1', gate: 'gate.push', payload });
    g.decide(id, 'approve');

    clock = NOW + GATE_TTL_MS + 1;
    expect(() => g.assertExecutable(id, payload)).toThrow(/expired/);
  });

  it('a decided gate is left alone by expiry', () => {
    const g = gates();
    const id = g.request({ taskId: 't1', gate: 'gate.push', payload: {} });
    g.decide(id, 'approve');
    clock = NOW + GATE_TTL_MS + 1;
    expect(g.expireStale()).toBe(0);
    const row = db.prepare('SELECT decision FROM gate_request WHERE id = ?').get(id) as {
      decision: string;
    };
    expect(row.decision).toBe('approve');
  });
});

describe('§6 row 3 — an open gate reaches the ledger', () => {
  it('an undecided gate is visible as an open gate; a decided one is not', () => {
    const g = gates();
    const id = g.request({ taskId: 't1', gate: 'gate.push', payload: {} });

    const open = () =>
      (
        db
          .prepare('SELECT COUNT(*) c FROM gate_request WHERE task_id = ? AND decided_at IS NULL')
          .get('t1') as { c: number }
      ).c;

    expect(open()).toBe(1);
    g.decide(id, 'approve');
    expect(open()).toBe(0);
  });
});

describe('§9.1 — undo_turn is conditional', () => {
  it('a small diff is automatic, a large one needs a human', () => {
    expect(undoTurnNeedsHuman(3)).toBe(false);
    expect(undoTurnNeedsHuman(20)).toBe(false);
    expect(undoTurnNeedsHuman(21)).toBe(true);
  });

  it('every gate in §14.1 is represented', () => {
    expect(GATES.length).toBeGreaterThanOrEqual(12);
    expect(new Set(GATES.map((g) => g.gate)).size).toBe(GATES.length);
  });
});
