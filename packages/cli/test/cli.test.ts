import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDb, type Db } from '@osade/daemon/src/db/index.js';
import type { Gates } from '@osade/daemon/src/domain/gates.js';
import { LaunchTask } from '@osade/daemon/src/domain/launch-task.js';
import type { Triage } from '@osade/daemon/src/domain/triage.js';
import type { VerifyRunner } from '@osade/daemon/src/domain/verify-run.js';
import type { ScmPoller } from '@osade/daemon/src/scm/poller.js';
import type { ScmWrites } from '@osade/daemon/src/scm/writes.js';
import { startDaemonServer, type RunningDaemon } from '@osade/daemon/src/server/index.js';

import { main, type Io } from '../src/cli.js';
import { looksLikePath } from '../src/open.js';
import { daemonBaseUrl, OsadeCliError } from '../src/client.js';

/**
 * `osade` against a real daemon — OSADE.md §17.
 *
 * DECISION: agents coordinate by driving this CLI, exactly as a human would. That symmetry is
 * only worth anything if the CLI actually works, so these drive it end to end over HTTP against
 * the real router rather than mocking the client: the interesting failures in a thin CLI are all
 * at the seams — how the port file is found, how arguments are parsed, what the daemon does with
 * what was sent.
 */

const NOW = 1_756_000_000_000;

let db: Db;
let daemon: RunningDaemon;
let home: string;

/** Captures what a user would have seen. */
function capture(): Io & { out: (t: string) => void; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    out: (text: string) => void stdout.push(text),
    err: (text: string) => void stderr.push(text),
  };
}

function seedTask(id: string, title: string, overrides: Record<string, unknown> = {}): void {
  db.prepare(
    `INSERT INTO task (id, repo_id, title, intent, origin_kind, base_ref, base_sha, branch,
                       worktree_path, created_at)
     VALUES (?, 'r1', ?, 'do it', 'manual', 'main', 'headsha', 'osade/x', '/wt', ?)`,
  ).run(id, title, NOW);

  if (Object.keys(overrides).length > 0) {
    db.prepare('INSERT INTO agent_fact (task_id) VALUES (?)').run(id);
    for (const [column, value] of Object.entries(overrides)) {
      db.prepare(`UPDATE agent_fact SET ${column} = ? WHERE task_id = ?`).run(value, id);
    }
  }
}

const stub = {} as never;

/**
 * A launcher that records what it was asked for.
 *
 * The interesting claim in `task read` is *which* task id reached the daemon, so the transcript
 * call has to be observable. Returning null makes it answer NOT_FOUND, which is what a task with
 * no live pane really does.
 */
let transcriptCalls: { taskId: string; lines: number }[] = [];
const recordingLauncher = {
  readTranscript: async (taskId: string, lines: number) => {
    transcriptCalls.push({ taskId, lines });
    return null;
  },
} as unknown as LaunchTask;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'osade-cli-'));
  process.env.OSADE_HOME = home;
  delete process.env.OSADE_DAEMON_URL;
  delete process.env.OSADE_TASK_ID;

  transcriptCalls = [];
  db = openDb(':memory:');
  db.prepare('INSERT INTO repo (id, path, default_branch, created_at) VALUES (?,?,?,?)').run(
    'r1',
    '/repo',
    'main',
    NOW,
  );

  // `repoOpen` delegates to the real registration path, so the real launcher is what is under
  // test. It never reaches the substrate for this, which is why the client and subscriber can be stubs.
  const launcher = Object.assign(
    new LaunchTask(db, stub, stub, { now: () => NOW }),
    { readTranscript: recordingLauncher.readTranscript },
  ) as unknown as LaunchTask;

  daemon = await startDaemonServer({
    db,
    launcher,
    gates: stub as Gates,
    verifier: stub as VerifyRunner,
    triage: stub as Triage,
    scmWrites: stub as ScmWrites,
    poller: stub as ScmPoller,
    now: () => NOW,
  });
});

afterEach(async () => {
  await daemon.close();
  db.close();
  delete process.env.OSADE_HOME;
  delete process.env.OSADE_TASK_ID;
  rmSync(home, { recursive: true, force: true });
});

/** Calls a procedure the way the CLI does, without going through argv parsing. */
async function trpc(path: string, input: unknown): Promise<unknown> {
  const res = await fetch(`http://127.0.0.1:${daemon.port}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = (await res.json()) as {
    result?: { data?: unknown };
    error?: { json?: { message?: string }; message?: string };
  };
  if (body.error) throw new Error(body.error.json?.message ?? body.error.message ?? 'daemon error');
  return body.result?.data;
}

describe('finding the daemon', () => {
  it('reads the port the daemon wrote, without being told', () => {
    expect(daemonBaseUrl()).toBe(`http://127.0.0.1:${daemon.port}`);
  });

  it('says the daemon is not running rather than failing at a socket', () => {
    process.env.OSADE_HOME = join(home, 'nowhere');
    expect(() => daemonBaseUrl()).toThrow(OsadeCliError);
    expect(() => daemonBaseUrl()).toThrow(/does not appear to be running/);
  });

  it('never leaves loopback — §2.1, there is no remote mode in v1', () => {
    expect(daemonBaseUrl()).toMatch(/^http:\/\/127\.0\.0\.1:/);
  });
});

describe('osade task list', () => {
  it('says what to do next when there is nothing yet', async () => {
    const io = capture();
    expect(await main(['task', 'list'], io)).toBe(0);
    expect(io.stdout.join('')).toContain('osade task create');
  });

  it('renders a row per task, with its derived status', async () => {
    seedTask('t_one', 'fix the thing');
    const io = capture();

    expect(await main(['task', 'list'], io)).toBe(0);
    const output = io.stdout.join('');
    expect(output).toContain('t_one');
    expect(output).toContain('fix the thing');
    // §6 — a task with no agent facts and no workspace is queued. Derived, never stored.
    expect(output).toContain('queued');
  });

  it('separates the needs-you set with one blank line — §19.3', async () => {
    seedTask('t_block', 'blocked one', { substrate_state: 'blocked', pane_alive: 1 });
    seedTask('t_quiet', 'quiet one');

    const io = capture();
    await main(['task', 'list'], io);
    const lines = io.stdout.join('').split('\n');

    expect(lines[0]).toContain('needs_input');
    expect(lines[1]).toBe('');
    expect(lines[2]).toContain('t_quiet');
  });

  it('does not emit a leading blank line when everything needs you', async () => {
    seedTask('t_block', 'blocked one', { substrate_state: 'blocked', pane_alive: 1 });

    const io = capture();
    await main(['task', 'list'], io);
    expect(io.stdout.join('').startsWith('\n')).toBe(false);
  });

  it('does not emit a blank line when nothing needs you', async () => {
    seedTask('t_a', 'one');
    seedTask('t_b', 'two');

    const io = capture();
    await main(['task', 'list'], io);
    expect(io.stdout.join('')).not.toContain('\n\n');
  });
});

describe('osade task show', () => {
  it('prints one task’s facts and its derived status', async () => {
    seedTask('t_one', 'fix the thing');
    const io = capture();

    expect(await main(['task', 'show', 't_one'], io)).toBe(0);
    const output = io.stdout.join('');
    expect(output).toContain('t_one  fix the thing');
    expect(output).toContain('status       queued');
    expect(output).toContain('branch       osade/x');
  });

  it('marks a task that needs you', async () => {
    seedTask('t_one', 'blocked', { substrate_state: 'blocked', pane_alive: 1 });
    const io = capture();

    await main(['task', 'show', 't_one'], io);
    expect(io.stdout.join('')).toContain('(needs you)');
  });

  it('exits non-zero for a task that does not exist', async () => {
    const io = capture();
    expect(await main(['task', 'show', 't_missing'], io)).toBe(1);
    expect(io.stderr.join('')).toContain('no such task');
  });
});

describe('the task id an agent does not have to pass — §17', () => {
  it('falls back to OSADE_TASK_ID, which every lane has', async () => {
    seedTask('t_lane', 'in a lane');
    process.env.OSADE_TASK_ID = 't_lane';

    const io = capture();
    expect(await main(['task', 'show'], io)).toBe(0);
    expect(io.stdout.join('')).toContain('t_lane');
  });

  it('an explicit id wins over the environment', async () => {
    seedTask('t_lane', 'in a lane');
    seedTask('t_other', 'somewhere else');
    process.env.OSADE_TASK_ID = 't_lane';

    const io = capture();
    await main(['task', 'show', 't_other'], io);
    expect(io.stdout.join('')).toContain('somewhere else');
  });

  it('explains itself when there is neither', async () => {
    await expect(main(['task', 'show'], capture())).rejects.toThrow(/OSADE_TASK_ID is not set/);
  });
});

describe('osade task read', () => {
  it('passes the task id through when --lines is absent', async () => {
    // This dropped the id before 2026-09-10: with no `--lines`, `indexOf` returns -1 and the
    // positional filter excluded index 0 — the task id itself.
    seedTask('t_one', 'one');

    await expect(main(['task', 'read', 't_one'], capture())).rejects.toThrow(/no live pane/);
    expect(transcriptCalls).toEqual([{ taskId: 't_one', lines: 200 }]);
  });

  it('does not silently fall back to another task', async () => {
    seedTask('t_one', 'one');
    process.env.OSADE_TASK_ID = 't_env';

    // The bug: the id was dropped, so this read t_env's transcript instead — the wrong task's
    // output, with nothing on screen to indicate the substitution.
    await expect(main(['task', 'read', 't_one'], capture())).rejects.toThrow();
    expect(transcriptCalls[0]?.taskId).toBe('t_one');
  });

  it('passes --lines through when it is given', async () => {
    seedTask('t_one', 'one');

    await expect(main(['task', 'read', 't_one', '--lines', '50'], capture())).rejects.toThrow();
    expect(transcriptCalls).toEqual([{ taskId: 't_one', lines: 50 }]);
  });

  it('keeps the id when --lines comes first', async () => {
    seedTask('t_one', 'one');

    await expect(main(['task', 'read', '--lines', '50', 't_one'], capture())).rejects.toThrow();
    expect(transcriptCalls).toEqual([{ taskId: 't_one', lines: 50 }]);
  });

  it('rejects --lines without a number instead of sending NaN to the daemon', async () => {
    seedTask('t_one', 'one');
    const io = capture();

    expect(await main(['task', 'read', 't_one', '--lines'], io)).toBe(2);
    expect(io.stderr.join('')).toContain('--lines');
  });

  it('rejects a --lines value that is not a number', async () => {
    seedTask('t_one', 'one');
    const io = capture();

    expect(await main(['task', 'read', 't_one', '--lines', 'lots'], io)).toBe(2);
  });
});

describe('osade task send', () => {
  it('refuses an empty message rather than prompting the agent with nothing', async () => {
    process.env.OSADE_TASK_ID = 't_lane';
    const io = capture();

    expect(await main(['task', 'send'], io)).toBe(2);
    expect(io.stderr.join('')).toContain('usage:');
  });

  it('treats a leading task id as an id, not as the first word of the message', async () => {
    seedTask('t_one', 'one');
    expect(await main(['task', 'send', 't_one', 'hello there'], capture())).toBe(0);
    const sent = db
      .prepare(`SELECT task_id, text FROM chat_turn WHERE text = 'hello there'`)
      .all() as { task_id: string; text: string }[];
    expect(sent).toEqual([{ task_id: 't_one', text: 'hello there' }]);
  });
});

describe('argument handling', () => {
  it('prints help with no arguments, and exits zero', async () => {
    const io = capture();
    expect(await main([], io)).toBe(0);
    expect(io.stdout.join('')).toContain('osade task list');
  });

  it('prints help for --help, -h and help', async () => {
    for (const flag of ['--help', '-h', 'help']) {
      const io = capture();
      expect(await main([flag], io)).toBe(0);
      expect(io.stdout.join('')).toContain('Usage:');
    }
  });

  it('exits 2 for an unknown group, and says which', async () => {
    const io = capture();
    expect(await main(['frobnicate'], io)).toBe(2);
    expect(io.stderr.join('')).toContain('frobnicate');
  });

  it('exits 2 for an unknown task command', async () => {
    const io = capture();
    expect(await main(['task', 'frobnicate'], io)).toBe(2);
    expect(io.stderr.join('')).toContain('frobnicate');
  });

  it('exits 2 for `task` with no command at all', async () => {
    const io = capture();
    expect(await main(['task'], io)).toBe(2);
  });

  it('requires both a repo and a title to create', async () => {
    const io = capture();
    expect(await main(['task', 'create', '/only/a/repo'], io)).toBe(2);
    expect(io.stderr.join('')).toContain('usage:');
  });
});

const BACKSLASH = String.fromCharCode(92);

/** One separator, so a Windows path and a posix one can be compared for sameness. */
function slashes(path: string): string {
  return path.split(String.fromCharCode(92)).join('/');
}

describe('osade . — opening a repository', () => {
  it('treats a path as a path and a command as a command', () => {
    const commands = ['task', 'help'];

    expect(looksLikePath('.', commands)).toBe(true);
    expect(looksLikePath('..', commands)).toBe(true);
    expect(looksLikePath('/srv/widget', commands)).toBe(true);
    expect(looksLikePath(`C:${BACKSLASH}code${BACKSLASH}widget`, commands)).toBe(true);
    expect(looksLikePath('./widget', commands)).toBe(true);
    expect(looksLikePath('~/code/widget', commands)).toBe(true);

    // The disambiguation that matters: a command name is never a path, even when a directory of
    // that name exists beside you.
    expect(looksLikePath('task', commands)).toBe(false);
    expect(looksLikePath('help', commands)).toBe(false);
    expect(looksLikePath('nonsense', commands)).toBe(false);
  });

  it('resolves a subdirectory to the repository root', async () => {
    // `osade .` is typed from wherever you are standing, which is usually not the root.
    const root = resolve(join(import.meta.dirname, '..', '..', '..'));
    const result = await trpc('repoOpen', { path: join(root, 'docs') });

    expect(slashes((result as { path: string }).path)).toBe(slashes(root));
  });

  it('reports the checkout HEAD as currentBranch, not origin/HEAD', async () => {
    const root = resolve(join(import.meta.dirname, '..', '..', '..'));
    const head = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
    const result = (await trpc('repoOpen', { path: root })) as {
      currentBranch: string;
      defaultBranch: string;
    };
    expect(result.currentBranch).toBe(head);
  });

  it('refuses a directory that is not in a git repository', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'osade-nongit-'));
    // A dummy `.git` stops git walking up into a parent repo (this machine's %USERPROFILE% is one).
    writeFileSync(join(dir, '.git'), 'not a repository\n');
    try {
      await expect(trpc('repoOpen', { path: dir })).rejects.toThrow(/not inside a git/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is idempotent — opening twice is opening once', async () => {
    const root = resolve(join(import.meta.dirname, '..', '..', '..'));
    const first = (await trpc('repoOpen', { path: root })) as { repoId: string };
    const second = (await trpc('repoOpen', { path: root })) as { repoId: string };

    expect(second.repoId).toBe(first.repoId);

    // One row for that path, however many times it is opened. The fixture seeds another repo, so
    // count this one rather than the table.
    const rows = db.prepare('SELECT COUNT(*) AS n FROM repo WHERE id = ?').get(first.repoId) as {
      n: number;
    };
    expect(rows.n).toBe(1);
  });
});
