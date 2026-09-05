import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { confirmPlan, deriveVerifyPlan } from '../../src/domain/verify-plan.js';
import { capLog, failureLoopPrompt } from '../../src/domain/verify-run.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'osade-plan-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function write(rel: string, content: string): void {
  const path = join(root, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

describe('§10.1 — the plan is derived from evidence, not guesses', () => {
  it('an empty directory yields no steps and nothing to review', async () => {
    const plan = await deriveVerifyPlan(root);
    expect(plan.steps).toEqual([]);
    expect(plan.needsReview).toBe(false);
  });

  it('reads package.json scripts and cites them', async () => {
    write(
      'package.json',
      JSON.stringify({ scripts: { test: 'vitest', lint: 'eslint .', unrelated: 'x' } }),
    );
    const plan = await deriveVerifyPlan(root);

    const names = plan.steps.map((s) => s.name);
    expect(names).toContain('test');
    expect(names).toContain('lint');
    // Only scripts a contributor would actually run for verification.
    expect(names).not.toContain('unrelated');

    for (const step of plan.steps) {
      expect(step.source).toBe('manifest');
      expect(step.evidence).toContain('package.json');
    }
  });

  it('uses the package manager the lockfile names, not a guess', async () => {
    write('package.json', JSON.stringify({ scripts: { test: 'vitest' } }));
    write('pnpm-lock.yaml', '');
    const plan = await deriveVerifyPlan(root);
    expect(plan.steps[0]!.cmd).toBe('pnpm run test');
  });

  it('falls back to npm when there is no recognised lockfile', async () => {
    write('package.json', JSON.stringify({ scripts: { test: 'vitest' } }));
    const plan = await deriveVerifyPlan(root);
    expect(plan.steps[0]!.cmd).toBe('npm run test');
  });

  it('recognises cargo, python and go without assuming node', async () => {
    write('Cargo.toml', '[package]\nname = "x"\n');
    const plan = await deriveVerifyPlan(root);
    expect(plan.steps.map((s) => s.name)).toEqual(['cargo test', 'clippy']);
    expect(plan.steps.every((s) => s.required)).toBe(true);
  });

  it('cites CI as corroboration — §13.2 rates it definitionally true', async () => {
    write('package.json', JSON.stringify({ scripts: { test: 'vitest' } }));
    write('.github/workflows/ci.yml', 'name: ci\n');
    const plan = await deriveVerifyPlan(root);
    expect(plan.steps[0]!.evidence).toContain('.github/workflows/ci.yml');
  });

  it('build is derived but not required — a failing build gates, a missing one does not', async () => {
    write('package.json', JSON.stringify({ scripts: { test: 'v', build: 'tsc' } }));
    const plan = await deriveVerifyPlan(root);
    const build = plan.steps.find((s) => s.name === 'build')!;
    expect(build.required).toBe(false);
  });

  it('INVARIANT: a derived plan needs review before it is ever run', async () => {
    write('package.json', JSON.stringify({ scripts: { test: 'vitest' } }));
    const plan = await deriveVerifyPlan(root);
    // §10.1 — never run an inferred command silently the first time.
    expect(plan.needsReview).toBe(true);
    expect(confirmPlan(plan).needsReview).toBe(false);
  });
});

describe('§10.2 — log capping keeps the legible parts', () => {
  it('leaves a small log alone', () => {
    expect(capLog('short')).toBe('short');
  });

  it('keeps the head and the tail, elides the middle', () => {
    const text = `START${'x'.repeat(5_000)}END`;
    const capped = capLog(text, 1_000, 400);
    expect(capped.startsWith('START')).toBe(true);
    expect(capped.endsWith('END')).toBe(true);
    expect(capped).toContain('bytes elided');
    expect(capped.length).toBeLessThan(text.length);
  });
});

describe('§10.2 — the failure loop', () => {
  it('sends the failing command and a bounded tail back to the agent', () => {
    const log = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
    const prompt = failureLoopPrompt(
      { runId: 'v1', stepName: 'test', exitCode: 1, required: true, logPath: '/x' },
      'pnpm test',
      log,
    );

    expect(prompt).toContain('pnpm test');
    expect(prompt).toContain('exited 1');
    expect(prompt).toContain('line 199');
    // Bounded: the agent gets enough to act on, not the whole log.
    expect(prompt).not.toContain('line 0\n');
    // §14 — the agent never performs a gated action on its own.
    expect(prompt).toContain('Do not push or open a pull request');
  });

  it('says plainly when a step timed out rather than pretending it failed cleanly', () => {
    const prompt = failureLoopPrompt(
      { runId: 'v1', stepName: 'test', exitCode: null, required: true, logPath: '/x' },
      'pnpm test',
      'stuck',
    );
    expect(prompt).toContain('timed out');
  });
});
