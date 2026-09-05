import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDb, type Db } from '../../src/db/index.js';
import { CheckpointError, Checkpoints } from '../../src/domain/checkpoints.js';

/**
 * §9.1 — these rules are hard-won: Kanban destroyed user work by getting them wrong. So this
 * runs against a real git repository rather than a mock, and asserts on the filesystem.
 */

const NOW = 1_756_000_000_000;

let dir: string;
let worktree: string;
let db: Db;
let clock = NOW;

/** Git on Windows may rewrite line endings on checkout; compare content, not CRLF. */
function read(rel: string): string {
  return readFileSync(join(worktree, rel), 'utf8').split('\r\n').join('\n');
}

function sh(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
}

function checkpoints(): Checkpoints {
  return new Checkpoints(db, { now: () => clock++ });
}

function seedTask(): void {
  db.prepare('INSERT INTO org (id, name, created_at) VALUES (?,?,?)').run('o1', 'a', NOW);
  db.prepare(
    'INSERT INTO repo (id, org_id, path, default_branch, created_at) VALUES (?,?,?,?,?)',
  ).run('r1', 'o1', worktree, 'main', NOW);
  db.prepare(
    `INSERT INTO task (id, repo_id, title, intent, origin_kind, base_ref, base_sha, branch,
                       worktree_path, created_at)
     VALUES ('t1','r1','x','x','manual','main',?,'b',?,?)`,
  ).run(sh(worktree, ['rev-parse', 'HEAD']), worktree, NOW);
  db.prepare("INSERT INTO agent_fact (task_id, pane_alive) VALUES ('t1', 0)").run();
}

beforeEach(() => {
  clock = NOW;
  dir = mkdtempSync(join(tmpdir(), 'osade-cp-'));
  worktree = join(dir, 'wt');
  sh(dir, ['init', '-q', '-b', 'main', 'wt']);
  writeFileSync(join(worktree, 'a.txt'), 'original\n');
  sh(worktree, ['add', '-A']);
  sh(worktree, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init']);

  db = openDb(':memory:');
  seedTask();
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('§9.1 — capture', () => {
  it('records a checkpoint under refs/osade/turns/<task>/<n>', async () => {
    const cp = await checkpoints().capture('t1', 'launch');
    expect(cp).not.toBe(null);
    expect(cp!.refName).toBe('refs/osade/turns/t1/0');
    expect(sh(worktree, ['rev-parse', cp!.refName])).toBe(cp!.sha);
  });

  it('numbers checkpoints in order', async () => {
    const c = checkpoints();
    await c.capture('t1', 'launch');
    await c.capture('t1', 'to_review');
    expect(c.list('t1').map((x) => x.refName)).toEqual([
      'refs/osade/turns/t1/0',
      'refs/osade/turns/t1/1',
    ]);
  });

  it('captures uncommitted work — that is the point', async () => {
    writeFileSync(join(worktree, 'a.txt'), 'edited by the agent\n');
    writeFileSync(join(worktree, 'new.txt'), 'brand new\n');

    const cp = await checkpoints().capture('t1', 'to_review');
    const tree = sh(worktree, ['ls-tree', '-r', '--name-only', cp!.sha]).split('\n').sort();
    expect(tree).toContain('a.txt');
    expect(tree).toContain('new.txt');
    expect(sh(worktree, ['show', `${cp!.sha}:a.txt`])).toBe('edited by the agent');
  });

  it('INVARIANT: capturing does not disturb the agent — index and HEAD are untouched', async () => {
    writeFileSync(join(worktree, 'staged.txt'), 'staged\n');
    sh(worktree, ['add', 'staged.txt']);
    writeFileSync(join(worktree, 'unstaged.txt'), 'unstaged\n');

    const headBefore = sh(worktree, ['rev-parse', 'HEAD']);
    const statusBefore = sh(worktree, ['status', '--porcelain']);

    await checkpoints().capture('t1', 'to_review');

    // A checkpoint that moved HEAD or restaged files would corrupt an agent mid-edit.
    expect(sh(worktree, ['rev-parse', 'HEAD'])).toBe(headBefore);
    expect(sh(worktree, ['status', '--porcelain'])).toBe(statusBefore);
  });

  it('never throws — §8.2 step 8, a capture failure never fails a launch', async () => {
    db.prepare("UPDATE task SET worktree_path = '/does/not/exist' WHERE id = 't1'").run();
    const warnings: string[] = [];
    const c = new Checkpoints(db, { now: () => clock++, onWarning: (m) => warnings.push(m) });

    await expect(c.capture('t1', 'launch')).resolves.toBe(null);
    expect(warnings.join()).toContain('checkpoint capture failed');
  });

  it('returns null for an unknown task rather than throwing', async () => {
    await expect(checkpoints().capture('nope', 'launch')).resolves.toBe(null);
  });
});

describe('§9.1 — undo', () => {
  it('refuses while a pane is live in the task', async () => {
    const c = checkpoints();
    await c.capture('t1', 'launch');
    await c.capture('t1', 'to_review');
    db.prepare("UPDATE agent_fact SET pane_alive = 1 WHERE task_id = 't1'").run();

    const plan = await c.planUndo('t1');
    expect(plan.blockedBy).toContain('stop it first');
    await expect(c.undo('t1', plan)).rejects.toThrow(CheckpointError);
  });

  it('needs its own gate when the diff is large — §9.1', async () => {
    const c = checkpoints();
    await c.capture('t1', 'launch');
    for (let i = 0; i < 25; i++) writeFileSync(join(worktree, `f${i}.txt`), `${i}\n`);
    await c.capture('t1', 'to_review');

    const plan = await c.planUndo('t1');
    expect(plan.filesChanged).toBeGreaterThan(20);
    expect(plan.needsGate).toBe(true);
  });

  it('a small diff does not need a gate', async () => {
    const c = checkpoints();
    await c.capture('t1', 'launch');
    writeFileSync(join(worktree, 'a.txt'), 'one small change\n');
    await c.capture('t1', 'to_review');

    const plan = await c.planUndo('t1');
    expect(plan.needsGate).toBe(false);
  });

  it('restores the previous turn', async () => {
    const c = checkpoints();
    await c.capture('t1', 'launch');

    writeFileSync(join(worktree, 'a.txt'), 'the agent broke it\n');
    writeFileSync(join(worktree, 'junk.txt'), 'junk\n');
    await c.capture('t1', 'to_review');

    const plan = await c.planUndo('t1');
    await c.undo('t1', plan);

    expect(read('a.txt')).toBe('original\n');
    expect(existsSync(join(worktree, 'junk.txt'))).toBe(false);
  });

  it('INVARIANT: stash-and-label, never discard — the undone work is recoverable', async () => {
    const c = checkpoints();
    await c.capture('t1', 'launch');
    writeFileSync(join(worktree, 'a.txt'), 'work worth keeping\n');
    await c.capture('t1', 'to_review');

    const plan = await c.planUndo('t1');
    const { stashRef } = await c.undo('t1', plan);

    // The working tree is rolled back…
    expect(read('a.txt')).toBe('original\n');
    // …but what was undone is still reachable. An undo that destroys work just moves the
    // mistake somewhere less visible.
    expect(stashRef).not.toBe(null);
    expect(sh(worktree, ['show', `${stashRef}:a.txt`])).toBe('work worth keeping');
  });

  it('refuses when there is nothing to undo to', async () => {
    await expect(checkpoints().planUndo('t1')).rejects.toThrow(/no checkpoint/);
  });
});
