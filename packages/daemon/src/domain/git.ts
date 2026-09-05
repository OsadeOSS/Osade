import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdir, stat, symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const execFileAsync = promisify(execFile);

/**
 * The narrow set of git commands Osade runs itself — OSADE.md §1 carve-out and §9.
 *
 * herdr owns worktree *lifecycle*: create, open, remove. Osade owns the read-only and
 * maintenance commands herdr does not run, because there is no herdr API for them and no git
 * event to subscribe to (§7.4):
 *
 *   - `worktree prune` before a create, which herdr never does (§9 rule 3)
 *   - `status --porcelain` / `diff --stat`, because `GitStatusRefreshed` does not exist
 *   - `rev-parse` to pin a base commit before handing it to herdr
 *
 * Nothing here creates, opens or removes a worktree. That would be a §1 violation.
 */

export async function git(cwd: string, args: string[], timeoutMs = 30_000): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

/** §9 rule 3 — an interrupted removal leaves a registration behind and `add` then fails. */
export async function pruneWorktrees(repoPath: string): Promise<void> {
  await git(repoPath, ['worktree', 'prune']);
}

/** Pins the base commit so a moving `main` cannot change what the agent builds against. */
export async function resolveSha(repoPath: string, ref: string): Promise<string> {
  const out = await git(repoPath, ['rev-parse', '--verify', `${ref}^{commit}`]);
  return out.trim();
}

export async function currentBranch(repoPath: string): Promise<string> {
  const out = await git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return out.trim();
}

export async function defaultBranch(repoPath: string): Promise<string> {
  // origin/HEAD when the remote has one, else whatever is checked out. Deliberately does not
  // guess "main": a repo that uses `master` or `trunk` is not an error.
  try {
    const out = await git(repoPath, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
    const name = out.trim();
    const slash = name.lastIndexOf('/');
    if (slash >= 0) return name.slice(slash + 1);
  } catch {
    // no origin/HEAD; fall through
  }
  return currentBranch(repoPath);
}

export interface DiffStat {
  /** Tracked changes plus untracked files. What an undo would actually touch. */
  filesChanged: number;
  /** Tracked-only, for display next to insertions/deletions. */
  trackedChanged: number;
  untracked: number;
  insertions: number;
  deletions: number;
  dirty: boolean;
}

/**
 * §7.4 — there is no `GitStatusRefreshed` event, so Osade reads this itself, debounced and
 * triggered by verification runs and by `pane.agent_status_changed → done`.
 */
export async function diffStat(worktreePath: string, baseSha: string): Promise<DiffStat> {
  const [porcelain, numstat] = await Promise.all([
    git(worktreePath, ['status', '--porcelain', '--untracked-files=all']),
    git(worktreePath, ['diff', '--numstat', baseSha]),
  ]);

  let insertions = 0;
  let deletions = 0;
  let trackedChanged = 0;
  for (const line of numstat.split('\n')) {
    if (!line.trim()) continue;
    const [added, removed] = line.split('\t');
    trackedChanged++;
    insertions += Number(added) || 0;
    deletions += Number(removed) || 0;
  }

  // `git diff` only sees tracked files, so an agent that created 30 new files reads as a diff
  // of zero. Undo deletes those files (`clean -fd`), so they have to count towards the size
  // that decides whether `gate.undo_turn` needs a human (§9.1).
  const untracked = porcelain
    .split('\n')
    .filter((line) => line.startsWith('?? ')).length;

  return {
    filesChanged: trackedChanged + untracked,
    trackedChanged,
    untracked,
    insertions,
    deletions,
    dirty: porcelain.trim().length > 0,
  };
}

/**
 * §9 rule 5 — mirror gitignored-but-needed paths into a fresh worktree.
 *
 * Without this, half of real repos will not boot in a worktree: `.env`, local tool configs and
 * the like are gitignored by design, so `git worktree add` never brings them across.
 *
 * Symlink where possible; copy where the tool resolves symlinks or the platform refuses one
 * (Windows without developer mode). A path that does not exist in the source is skipped
 * silently — `mirror_paths` is a wish list, not a manifest.
 */
export async function mirrorPaths(
  sourceRepo: string,
  worktreePath: string,
  paths: readonly string[],
): Promise<string[]> {
  const mirrored: string[] = [];

  for (const relative of paths) {
    const from = join(sourceRepo, relative);
    const to = join(worktreePath, relative);

    try {
      await stat(from);
    } catch {
      continue;
    }

    await mkdir(dirname(to), { recursive: true });

    try {
      const info = await stat(from);
      await symlink(from, to, info.isDirectory() ? 'junction' : 'file');
      mirrored.push(relative);
    } catch {
      try {
        await copyFile(from, to);
        mirrored.push(relative);
      } catch {
        // Neither worked — a missing mirror is a degraded worktree, not a failed launch.
      }
    }
  }

  return mirrored;
}

/** Default mirror list when a repo has not configured one. */
export const DEFAULT_MIRROR_PATHS: readonly string[] = [
  '.env',
  '.env.local',
  '.env.development.local',
  '.npmrc',
  '.tool-versions',
];
