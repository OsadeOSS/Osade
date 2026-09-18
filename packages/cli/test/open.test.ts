import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { looksLikePath, openRepo, type AppLaunch } from '../src/open.js';
import type { Io } from '../src/cli.js';

function capture(): Io & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    out: (text) => void stdout.push(text),
    err: (text) => void stderr.push(text),
  };
}

const BACKSLASH = String.fromCharCode(92);

describe('looksLikePath', () => {
  const commands = ['task', 'help'];

  it('treats a path as a path and a command as a command', () => {
    expect(looksLikePath('.', commands)).toBe(true);
    expect(looksLikePath('..', commands)).toBe(true);
    expect(looksLikePath('/srv/widget', commands)).toBe(true);
    expect(looksLikePath(`C:${BACKSLASH}code${BACKSLASH}widget`, commands)).toBe(true);
    expect(looksLikePath('./widget', commands)).toBe(true);
    expect(looksLikePath('~/code/widget', commands)).toBe(true);
    expect(looksLikePath('task', commands)).toBe(false);
    expect(looksLikePath('help', commands)).toBe(false);
    expect(looksLikePath('nonsense', commands)).toBe(false);
  });
});

describe('osade .', () => {
  it('launches the app and returns without talking to the daemon', async () => {
    const launched: { command: string; args: string[]; repo: string }[] = [];
    const fake: AppLaunch = { command: 'electron', args: ['/app'] };
    const io = capture();

    const code = await openRepo('.', io, {
      findApp: () => fake,
      spawnApp: (app, repo) => {
        launched.push({ command: app.command, args: [...app.args, `--repo=${repo}`], repo });
      },
    });

    expect(code).toBe(0);
    expect(io.stdout).toEqual([]);
    expect(io.stderr).toEqual([]);
    expect(launched).toHaveLength(1);
    expect(launched[0]!.args.at(-1)).toBe(`--repo=${resolve('.')}`);
  });

  it('passes --repo as one token so a second instance keeps the path', async () => {
    let flag: string | undefined;
    await openRepo('.', capture(), {
      findApp: () => ({ command: 'electron', args: ['/app'] }),
      spawnApp: (_app, repo) => {
        flag = `--repo=${repo}`;
      },
    });
    expect(flag?.startsWith('--repo=')).toBe(true);
    expect(flag).toBe(`--repo=${resolve('.')}`);
  });

  it('exits 2 when the path does not exist', async () => {
    const io = capture();
    const missing = join(tmpdir(), `osade-nope-${process.pid}`);
    expect(await openRepo(missing, io, { findApp: () => ({ command: 'x', args: [] }) })).toBe(2);
    expect(io.stderr.join('')).toContain('does not exist');
  });

  it('exits 1 when the app is not built', async () => {
    const io = capture();
    expect(await openRepo('.', io, { findApp: () => null })).toBe(1);
    expect(io.stderr.join('')).toContain('install-cli.mjs');
  });

  it('does not hold the caller — spawnApp returns before openRepo does', async () => {
    let spawned = false;
    await openRepo('.', capture(), {
      findApp: () => ({ command: 'electron', args: [] }),
      spawnApp: () => {
        spawned = true;
      },
    });
    expect(spawned).toBe(true);
  });
});
