import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { currentBranch } from '../../src/domain/git.js';

describe('currentBranch', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('names the branch in a repo that has no commits yet', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'osade-unborn-'));
    dirs.push(dir);
    execFileSync('git', ['init'], { cwd: dir, windowsHide: true });

    await expect(currentBranch(dir)).resolves.toMatch(/^(main|master)$/u);
  });
});
