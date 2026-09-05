import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Deriving a verification plan — OSADE.md §10.1.
 *
 * The point of verification is to make an agent's claim checkable **before** it costs a
 * maintainer anything. This is the largest single lever on the §0.1 goal.
 *
 * Built from **evidence, not guesses**: the repo's own CI config, its package manifests, and
 * its contributing docs. Every step carries `source` provenance so the UI can show where it
 * came from, and the plan is shown to the user and editable before first use — §10.1 is
 * explicit that an inferred command is never run silently the first time.
 */

export type VerifyStepSource = 'ci' | 'manifest' | 'doc' | 'user';

export interface VerifyStep {
  name: string;
  cmd: string;
  /** Relative to the worktree root. */
  cwd: string;
  timeoutSec: number;
  required: boolean;
  source: VerifyStepSource;
  /** What this was read from, so the UI can cite it. */
  evidence: string;
}

export interface VerifyPlan {
  steps: VerifyStep[];
  /** True until a human has looked at it. §10.1 — never run an inferred plan silently. */
  needsReview: boolean;
}

const DEFAULT_TIMEOUT_SEC = 600;

/** Script names worth running, in the order a contributor would run them. */
const INTERESTING_SCRIPTS: readonly { name: string; required: boolean }[] = [
  { name: 'typecheck', required: true },
  { name: 'lint', required: true },
  { name: 'test', required: true },
  { name: 'build', required: false },
];

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

/** Which package manager the repo actually uses, from its lockfile. */
async function detectPackageManager(root: string): Promise<'pnpm' | 'yarn' | 'npm'> {
  const entries = await readdir(root).catch(() => [] as string[]);
  if (entries.includes('pnpm-lock.yaml')) return 'pnpm';
  if (entries.includes('yarn.lock')) return 'yarn';
  return 'npm';
}

async function fromPackageJson(root: string): Promise<VerifyStep[]> {
  const pkg = await readJson(join(root, 'package.json'));
  const scripts = pkg?.scripts as Record<string, string> | undefined;
  if (!scripts) return [];

  const pm = await detectPackageManager(root);
  const run = pm === 'npm' ? 'npm run' : `${pm} run`;

  return INTERESTING_SCRIPTS.filter((s) => typeof scripts[s.name] === 'string').map((s) => ({
    name: s.name,
    cmd: `${run} ${s.name}`,
    cwd: '.',
    timeoutSec: DEFAULT_TIMEOUT_SEC,
    required: s.required,
    source: 'manifest' as const,
    evidence: `package.json scripts.${s.name}`,
  }));
}

async function fromCargo(root: string): Promise<VerifyStep[]> {
  if ((await readText(join(root, 'Cargo.toml'))) == null) return [];
  return [
    {
      name: 'cargo test',
      cmd: 'cargo test --locked',
      cwd: '.',
      timeoutSec: DEFAULT_TIMEOUT_SEC,
      required: true,
      source: 'manifest',
      evidence: 'Cargo.toml',
    },
    {
      name: 'clippy',
      cmd: 'cargo clippy --all-targets --locked -- -D warnings',
      cwd: '.',
      timeoutSec: DEFAULT_TIMEOUT_SEC,
      required: true,
      source: 'manifest',
      evidence: 'Cargo.toml',
    },
  ];
}

async function fromPython(root: string): Promise<VerifyStep[]> {
  if ((await readText(join(root, 'pyproject.toml'))) == null) return [];
  return [
    {
      name: 'pytest',
      cmd: 'pytest',
      cwd: '.',
      timeoutSec: DEFAULT_TIMEOUT_SEC,
      required: true,
      source: 'manifest',
      evidence: 'pyproject.toml',
    },
  ];
}

async function fromGo(root: string): Promise<VerifyStep[]> {
  if ((await readText(join(root, 'go.mod'))) == null) return [];
  return [
    {
      name: 'go test',
      cmd: 'go test ./...',
      cwd: '.',
      timeoutSec: DEFAULT_TIMEOUT_SEC,
      required: true,
      source: 'manifest',
      evidence: 'go.mod',
    },
  ];
}

/**
 * CI config is the strongest evidence there is: §13.2 rates it "mechanically enforced, so it
 * is definitionally true". Parsing every workflow YAML properly is M3 work; for now this
 * records that CI exists so the UI can say so, and marks the plan as needing review.
 */
async function ciEvidence(root: string): Promise<string[]> {
  const found: string[] = [];
  const workflows = await readdir(join(root, '.github', 'workflows')).catch(
    () => [] as string[],
  );
  for (const file of workflows) {
    if (file.endsWith('.yml') || file.endsWith('.yaml')) {
      found.push(`.github/workflows/${file}`);
    }
  }
  for (const file of ['justfile', 'Makefile', 'Taskfile.yml', '.gitlab-ci.yml']) {
    if ((await readText(join(root, file))) != null) found.push(file);
  }
  return found;
}

/**
 * Derives a plan for a repository.
 *
 * Returns `needsReview: true` whenever any step was inferred rather than chosen by a human —
 * which on a first run is always. §10.1: never run an inferred command silently the first time.
 */
export async function deriveVerifyPlan(repoRoot: string): Promise<VerifyPlan> {
  const steps = [
    ...(await fromPackageJson(repoRoot)),
    ...(await fromCargo(repoRoot)),
    ...(await fromPython(repoRoot)),
    ...(await fromGo(repoRoot)),
  ];

  const ci = await ciEvidence(repoRoot);
  if (ci.length > 0 && steps.length > 0) {
    // Not a step of its own: it raises confidence in the steps we already found, and the UI
    // shows it as corroboration.
    steps[0] = { ...steps[0]!, evidence: `${steps[0]!.evidence} (CI: ${ci.join(', ')})` };
  }

  return { steps, needsReview: steps.length > 0 };
}

/** A plan the user has edited or confirmed. Stored per repo; the override is recorded. */
export function confirmPlan(plan: VerifyPlan): VerifyPlan {
  return { ...plan, needsReview: false };
}
