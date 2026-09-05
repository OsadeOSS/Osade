import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { openDb, type Db } from '../../src/db/index.js';
import { getAgentFact, getTaskFacts } from '../../src/db/task-repo.js';
import { Checkpoints } from '../../src/domain/checkpoints.js';
import { deriveStatus } from '../../src/domain/derive-status.js';
import { Gates } from '../../src/domain/gates.js';
import { LaunchTask } from '../../src/domain/launch-task.js';
import { confirmPlan, deriveVerifyPlan } from '../../src/domain/verify-plan.js';
import { VerifyRunner } from '../../src/domain/verify-run.js';
import { HerdrClient } from '../../src/herdr/client.js';
import { assertNoDrift } from '../../src/herdr/drift-check.js';
import { HerdrEventSubscriber } from '../../src/herdr/event-subscriber.js';
import { herdrSessionDir } from '../../src/herdr/socket-path.js';

/**
 * The M1 acceptance test — OSADE.md §21.
 *
 * > A task runs `implementing → verifying → verify_failed → implementing → awaiting_review`
 * > without a human touching it, and the commit is blocked until approved.
 *
 * Real herdr, real git, a real failing test, and a real agent fixing it. This is the demo the
 * product is organised around (§10.2): *agent acts, environment answers, agent adapts*.
 *
 * Skipped unless `OSADE_E2E=1`.
 */

const E2E = process.env.OSADE_E2E === '1';
const SESSION = 'osade-m1';
const HERDR_BIN = process.env.OSADE_HERDR_BIN ?? 'herdr';

let workdir: string;
let repoPath: string;
let db: Db;
let herdr: HerdrClient;
let server: ChildProcess | null = null;
let subscriber: HerdrEventSubscriber;
let launcher: LaunchTask;
let verifier: VerifyRunner;
let gates: Gates;
let checkpoints: Checkpoints;
const warnings: string[] = [];

function sh(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  ms: number,
  what: string,
): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out after ${ms}ms waiting for ${what}`);
}

/**
 * A repository whose test suite fails until a file says `42`.
 *
 * Deliberately trivial to fix and unmistakable in the output: the loop under test is whether
 * the failure reaches the agent at all, not whether the agent can solve something hard.
 */
function writeFixture(root: string): void {
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'fixture', private: true, scripts: { test: 'node check.mjs' } }, null, 2),
  );
  writeFileSync(
    join(root, 'check.mjs'),
    [
      "import { readFileSync } from 'node:fs';",
      "let answer = '';",
      "try { answer = readFileSync('answer.txt', 'utf8').trim(); } catch {}",
      "if (answer !== '42') {",
      "  console.error('FAIL: answer.txt must exist and contain exactly 42, got ' + JSON.stringify(answer));",
      '  process.exit(1);',
      '}',
      "console.log('PASS');",
      '',
    ].join('\n'),
  );
}

beforeAll(async () => {
  if (!E2E) return;

  workdir = mkdtempSync(join(tmpdir(), 'osade-m1-'));
  process.env.OSADE_HOME = join(workdir, 'osade-home');

  repoPath = join(workdir, 'repo');
  sh(workdir, ['init', '-q', '-b', 'main', 'repo']);
  writeFixture(repoPath);
  sh(repoPath, ['add', '-A']);
  sh(repoPath, ['-c', 'user.email=e2e@osade', '-c', 'user.name=e2e', 'commit', '-qm', 'init']);

  await assertNoDrift(HERDR_BIN);

  const env: NodeJS.ProcessEnv = { ...process.env, HERDR_SESSION: SESSION };
  delete env.HERDR_STARTUP_CWD;
  server = spawn(HERDR_BIN, ['server'], { env, stdio: 'ignore' });

  herdr = new HerdrClient({ session: SESSION });
  await waitFor(() => herdr.isRunning(1_000), 20_000, 'herdr to accept connections');

  db = openDb(join(workdir, 'osade.db'));
  const onWarning = (m: string) => warnings.push(m);
  subscriber = new HerdrEventSubscriber(db, herdr, { onWarning });
  gates = new Gates(db);
  checkpoints = new Checkpoints(db, { onWarning });
  launcher = new LaunchTask(db, herdr, subscriber, {
    defaultAgent: 'claude',
    onWarning,
    checkpoints,
  });
  verifier = new VerifyRunner(db, herdr, {
    onWarning,
    // §10.2 — the closed loop.
    sendToAgent: (taskId, text) => launcher.prompt(taskId, text, false),
  });
  await subscriber.start();
}, 90_000);

afterAll(async () => {
  if (!E2E) return;
  subscriber?.stop();
  try {
    await new HerdrClient({ session: SESSION }).request('server.stop', {}, 5_000);
  } catch {
    // already gone
  }
  server?.kill();
  db?.close();
  for (const dir of [herdrSessionDir(SESSION), workdir]) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // leave it for the OS temp sweeper
    }
  }
  delete process.env.OSADE_HOME;
}, 30_000);

describe.skipIf(!E2E)('M1 acceptance — the failure loop turns once, for real', () => {
  let taskId: string;
  let worktree: string;

  it('launches a task', async () => {
    taskId = await launcher.createTask({
      repoPath,
      title: 'm1 acceptance',
      intent:
        'A test is failing in this worktree. When you are told what failed, fix it and say done.',
    });
    const result = await launcher.launch(taskId);
    worktree = result.worktreePath;

    // §8.2 step 8 — launch captures its own checkpoint. Exactly one, because there is one
    // implementation of checkpointing rather than two.
    expect(checkpoints.list(taskId)).toHaveLength(1);
    expect(checkpoints.list(taskId)[0]!.trigger).toBe('launch');
  }, 240_000);

  it('derives a plan from the repo and refuses to run it unreviewed — §10.1', async () => {
    const plan = await deriveVerifyPlan(worktree);

    expect(plan.steps.map((s) => s.name)).toContain('test');
    expect(plan.steps[0]!.cmd).toBe('npm run test');
    expect(plan.steps[0]!.evidence).toContain('package.json');
    expect(plan.needsReview).toBe(true);

    // An inferred command is never run silently the first time.
    await expect(verifier.run(taskId, plan, 'head')).rejects.toThrow(/has not been reviewed/);
  });

  it('runs verification in the verify lane and records a real exit code', async () => {
    const plan = confirmPlan(await deriveVerifyPlan(worktree));
    const head = getTaskFacts(db, taskId)!.task.base_sha;

    const report = await verifier.run(taskId, plan, head);

    // The sentinel-based exit-code recovery is the weakest seam in M1; this is what proves it
    // works against a real pane rather than a mock.
    expect(report.passed).toBe(false);
    const failing = report.outcomes.find((o) => o.stepName === 'test')!;
    expect(failing.exitCode).toBe(1);

    // The log captured what actually broke.
    const log = readFileSync(failing.logPath, 'utf8');
    expect(log).toContain('answer.txt must exist and contain exactly 42');

    // §6 row 8 wrote a row before the command ran, and row 7 now reads verify_failed.
    const facts = getTaskFacts(db, taskId)!;
    expect(deriveStatus(facts, Date.now())).toBe('verify_failed');
  }, 240_000);

  it('THE LOOP: the failure reached the agent, and the agent fixed it', async () => {
    // `verifier.run` already sent the tail into the agent lane via sendToAgent (§10.2).
    // Nothing below touches the agent — this is the "without a human touching it" clause.
    await waitFor(
      () => {
        try {
          return readFileSync(join(worktree, 'answer.txt'), 'utf8').trim() === '42';
        } catch {
          return false;
        }
      },
      240_000,
      'the agent to fix the failing test from the verification output alone',
    );

    // …and the agent went back to work when it was told, which is §6 row 11.
    const fact = getAgentFact(db, taskId)!;
    expect(fact.herdr_state).not.toBe(null);
  }, 300_000);

  it('re-verification passes and the row reaches awaiting_review', async () => {
    const plan = confirmPlan(await deriveVerifyPlan(worktree));
    const head = getTaskFacts(db, taskId)!.task.base_sha;

    const report = await verifier.run(taskId, plan, head);
    expect(report.passed).toBe(true);
    expect(report.outcomes.find((o) => o.stepName === 'test')!.exitCode).toBe(0);

    // The agent finishes its turn; herdr reports `done`, which is the only thing that
    // produces `to_review` (§6.1).
    await waitFor(
      () => getAgentFact(db, taskId)?.last_event === 'to_review',
      240_000,
      'the agent to finish its turn',
    );

    const facts = getTaskFacts(db, taskId)!;
    expect(deriveStatus(facts, Date.now())).toBe('awaiting_review');

    // §6 — and none of that was stored.
    const columns = (db.prepare('PRAGMA table_info(task)').all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(columns).not.toContain('status');
  }, 300_000);

  it('the commit is blocked until approved — §14', async () => {
    const payload = { message: 'fix: make the check pass', files: ['answer.txt'] };
    const gateId = gates.request({ taskId, gate: 'gate.push', payload });

    // §6 row 3 — an undecided gate is the loudest thing in the ledger.
    let facts = getTaskFacts(db, taskId)!;
    expect(deriveStatus(facts, Date.now())).toBe('awaiting_approval');

    // …and it will not execute while undecided.
    expect(() => gates.assertExecutable(gateId, payload)).toThrow(/has not been decided/);

    gates.decide(gateId, 'approve');
    expect(() => gates.assertExecutable(gateId, payload)).not.toThrow();

    // §11.2 — the approval is bound to these exact bytes.
    expect(() => gates.assertExecutable(gateId, { ...payload, message: 'something else' })).toThrow(
      /payload changed after approval/,
    );

    facts = getTaskFacts(db, taskId)!;
    expect(deriveStatus(facts, Date.now())).toBe('awaiting_review');
  });

  it('tears down cleanly', async () => {
    await launcher.teardown(taskId, { force: true });
    const facts = getTaskFacts(db, taskId)!;
    expect(facts.task.herdr_workspace_id).toBe(null);
    // §5.2 — teardown is not a death certificate.
    expect(facts.agent?.terminated).toBe(false);
  }, 120_000);
});
