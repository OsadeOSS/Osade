import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdir, stat, symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const execFileAsync = promisify(execFile);

/**
 * The narrow set of git commands Osade runs itself — OSADE.md §1 carve-out and §9.
 *
 * the substrate owns worktree *lifecycle*: create, open, remove. Osade owns the read-only and
 * maintenance commands the substrate does not run, because there is no the substrate API for them and no git
 * event to subscribe to (§7.4):
 *
 *   - `worktree prune` before a create, which the substrate never does (§9 rule 3)
 *   - `status --porcelain` / `diff --stat`, because `GitStatusRefreshed` does not exist
 *   - `rev-parse` to pin a base commit before handing it to the substrate
 *
 * Nothing here creates, opens or removes a worktree. That would be a §1 violation.
 */

export async function git(cwd: string, args: string[], timeoutMs = 30_000): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    encoding: 'utf8',
  });
  return stdout;
}

/** §9 rule 3 — an interrupted removal leaves a registration behind and `add` then fails. */
/**
 * The repository root containing `path`, or null when there is none.
 *
 * `osade .` is typed from wherever you happen to be standing — usually a subdirectory — so the
 * path has to be resolved to the repository it belongs to rather than taken literally. Asking git
 * is the only correct way: worktrees, submodules and `.git` files are all things a hand-rolled
 * walk up looking for a `.git` directory gets wrong.
 */
export async function repoRoot(path: string): Promise<string | null> {
  try {
    const root = await git(path, ['rev-parse', '--show-toplevel']);
    return root.trim() || null;
  } catch {
    return null;
  }
}

export async function pruneWorktrees(repoPath: string): Promise<void> {
  await git(repoPath, ['worktree', 'prune']);
}

/** Pins the base commit so a moving `main` cannot change what the agent builds against. */
export async function resolveSha(repoPath: string, ref: string): Promise<string> {
  const out = await git(repoPath, ['rev-parse', '--verify', `${ref}^{commit}`]);
  return out.trim();
}

export async function currentBranch(repoPath: string): Promise<string> {
  // An unborn repo (`git init` and nothing else) has a symbolic HEAD but no revision, so
  // `rev-parse --abbrev-ref HEAD` dies with "ambiguous argument 'HEAD'". `osade .` from such a
  // folder — including a home directory that happens to be an empty git repo — must still open.
  try {
    const named = (await git(repoPath, ['symbolic-ref', '--short', 'HEAD'])).trim();
    if (named.length > 0) return named;
  } catch {
    // Detached HEAD is not a symbolic ref.
  }
  try {
    const out = (await git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    return out.length > 0 ? out : 'HEAD';
  } catch {
    return 'HEAD';
  }
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

export interface GitHubRemote {
  owner: string;
  name: string;
}

/**
 * Parses `owner/name` out of a GitHub remote URL.
 *
 * Handles the three shapes in the wild — HTTPS, SSH, and `git://` — because a repo cloned over
 * SSH is not a different repo, and requiring the user to tell Osade something git already knows
 * is the kind of friction that gets a tool abandoned.
 *
 * Returns null for non-GitHub remotes rather than guessing: §11 is GitHub-specific in v1, and a
 * wrong owner would send a pull request to a stranger.
 */
export function parseGitHubRemote(url: string): GitHubRemote | null {
  const trimmed = url.trim().replace(/\.git$/, '');

  // git@github.com:owner/name  |  ssh://git@github.com/owner/name
  const ssh = trimmed.match(/^(?:ssh:\/\/)?(?:[^@]+@)?github\.com[:/]([^/]+)\/([^/]+)$/i);
  if (ssh) return { owner: ssh[1]!, name: ssh[2]! };

  // https://github.com/owner/name  |  git://github.com/owner/name
  const web = trimmed.match(/^(?:https?|git):\/\/(?:[^@]+@)?github\.com\/([^/]+)\/([^/]+)$/i);
  if (web) return { owner: web[1]!, name: web[2]! };

  return null;
}

/** The GitHub identity of a checkout, from its `origin` remote. Null when there isn't one. */
export async function githubRemote(repoPath: string): Promise<GitHubRemote | null> {
  try {
    const url = await git(repoPath, ['remote', 'get-url', 'origin']);
    return parseGitHubRemote(url);
  } catch {
    // No origin, or not a git repo. Neither is an error: a local-only repo is a valid task
    // target, it just cannot open pull requests.
    return null;
  }
}

export async function repoWorkingStatus(repoPath: string): Promise<{
  branch: string;
  dirty: boolean;
  ahead: number | null;
  behind: number | null;
}> {
  const branch = await currentBranch(repoPath);
  const porcelain = await git(repoPath, ['status', '--porcelain', '--untracked-files=all']);
  let ahead: number | null = null;
  let behind: number | null = null;
  try {
    const counts = (await git(repoPath, ['rev-list', '--left-right', '--count', '@{u}...HEAD'])).trim();
    const [left, right] = counts.split(/\s+/);
    behind = Number(left);
    ahead = Number(right);
  } catch {
    // No upstream.
  }
  return { branch, dirty: porcelain.trim().length > 0, ahead, behind };
}

export async function listLocalBranches(repoPath: string): Promise<string[]> {
  const current = await currentBranch(repoPath);
  const out = await git(repoPath, ['branch', '--format=%(refname:short)']);
  const all = out.split('\n').map((line) => line.trim()).filter(Boolean);
  return [current, ...all.filter((name) => name !== current)];
}

export async function checkoutBranch(cwd: string, branch: string): Promise<void> {
  await git(cwd, ['checkout', branch]);
}

/** Local branch name the worktree should hold — `origin/feat` becomes `feat`. */
export function localCheckoutName(ref: string): string {
  return ref
    .replace(/^refs\/heads\//, '')
    .replace(/^refs\/remotes\/[^/]+\//, '')
    .replace(/^origin\//, '');
}

/** Git's exclusivity error. Null for any other worktree failure. */
export function parseAlreadyCheckedOut(message: string): { branch: string; path: string } | null {
  const match = message.match(/'([^']+)' is already checked out at '([^']+)'/i);
  return match ? { branch: match[1]!, path: match[2]! } : null;
}

/** Resolve a checkout ref, including a remote-tracking name with no local branch. */
export async function resolveCheckoutRef(
  repoPath: string,
  ref: string,
): Promise<{ local: string; sha: string }> {
  const attempts =
    ref.startsWith('origin/') || ref.startsWith('refs/') ? [ref] : [ref, `origin/${ref}`];
  let last: unknown;
  for (const candidate of attempts) {
    try {
      const sha = await resolveSha(repoPath, candidate);
      return { local: localCheckoutName(candidate), sha };
    } catch (err) {
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error(`unknown ref ${ref}`);
}

export async function listWorktreeCheckouts(
  repoPath: string,
): Promise<{ path: string; branch: string | null }[]> {
  const out = await git(repoPath, ['worktree', 'list', '--porcelain']);
  const rows: { path: string; branch: string | null }[] = [];
  let path = '';
  let branch: string | null = null;
  const flush = (): void => {
    if (path) rows.push({ path, branch });
    path = '';
    branch = null;
  };
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      flush();
      path = line.slice('worktree '.length).trim();
    } else if (line.startsWith('branch ')) {
      branch = localCheckoutName(line.slice('branch '.length).trim());
    } else if (line.trim() === '') {
      flush();
    }
  }
  flush();
  return rows;
}

export async function stashPush(cwd: string, message: string): Promise<void> {
  await git(cwd, ['stash', 'push', '-u', '-m', message]);
}

export async function stashRefByMessage(cwd: string, message: string): Promise<string | null> {
  const list = await git(cwd, ['stash', 'list', '--format=%gd:%gs']);
  for (const line of list.split('\n')) {
    const cut = line.indexOf(':');
    if (cut < 0) continue;
    if (line.slice(cut + 1).includes(message)) return line.slice(0, cut);
  }
  return null;
}

export async function stashApply(cwd: string, ref: string): Promise<void> {
  await git(cwd, ['stash', 'apply', ref]);
}

export async function stashDrop(cwd: string, ref: string): Promise<void> {
  await git(cwd, ['stash', 'drop', ref]);
}
