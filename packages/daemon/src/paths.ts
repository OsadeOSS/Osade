import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * OSADE.md §2.2 — INVARIANT: state containment.
 *
 * Everything Osade writes lives under `~/.osade/`, including Electron's `userData`. No
 * `~/Library/Application Support`, no `%APPDATA%`, ever. The whole system must be resettable
 * with `rm -rf ~/.osade`.
 *
 * Every path in the daemon comes from here so that invariant is checkable in one place rather
 * than trusted across a dozen call sites.
 */

export function osadeRoot(env: NodeJS.ProcessEnv = process.env): string {
  // Tests and the e2e harness point this elsewhere; nothing else should.
  return env.OSADE_HOME ?? join(homedir(), '.osade');
}

export interface OsadePaths {
  readonly root: string;
  readonly db: string;
  readonly configJson: string;
  readonly controlSocket: string;
  readonly logsDir: string;
  readonly runsDir: string;
  readonly reviewDir: string;
  readonly skillsDir: string;
  readonly worktreesDir: string;
  readonly electronUserData: string;
  /** Where the daemon writes its port so the CLI and the Electron app can find it. */
  readonly portFile: string;
}

export function osadePaths(env: NodeJS.ProcessEnv = process.env): OsadePaths {
  const root = osadeRoot(env);
  return {
    root,
    db: join(root, 'osade.db'),
    configJson: join(root, 'config.json'),
    controlSocket: join(root, 'osade.sock'),
    logsDir: join(root, 'logs'),
    runsDir: join(root, 'runs'),
    reviewDir: join(root, 'review'),
    skillsDir: join(root, 'skills'),
    worktreesDir: join(root, 'worktrees'),
    electronUserData: join(root, 'electron'),
    portFile: join(root, 'daemon.port'),
  };
}

/** `~/.osade/worktrees/<repo_slug>/<task_id>/` — §9. */
export function worktreePathFor(repoSlug: string, taskId: string, env = process.env): string {
  return join(osadePaths(env).worktreesDir, repoSlug, taskId);
}

/** `~/.osade/runs/<run_id>/` — §10.2. */
export function runDirFor(runId: string, env = process.env): string {
  return join(osadePaths(env).runsDir, runId);
}
