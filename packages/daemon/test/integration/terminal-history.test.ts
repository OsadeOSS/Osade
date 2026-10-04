import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import { TaskShells } from '../../src/domain/task-shell.js';

let dir: string;
let historyDir: string;
const live: TaskShells[] = [];

afterEach(() => {
  for (const shells of live.splice(0)) shells.closeAll();
  for (const path of [dir, historyDir]) {
    try {
      rmSync(path, { recursive: true, force: true, maxRetries: 8, retryDelay: 80 });
    } catch {
      // Windows keeps a just-killed powershell cwd locked; the temp sweeper takes it.
    }
  }
});

async function waitFor(shells: TaskShells, key: string, needle: string): Promise<void> {
  let seen = '';
  for (let i = 0; i < 160 && !seen.includes(needle); i++) {
    await new Promise((r) => setTimeout(r, 50));
    seen += shells.read(key);
  }
  expect(seen).toContain(needle);
}

function make(): TaskShells {
  const shells = new TaskShells({ historyDir });
  live.push(shells);
  return shells;
}

it('brings a terminal back with its output after the daemon restarts', async () => {
  dir = mkdtempSync(join(tmpdir(), 'osade-hist-'));
  historyDir = join(mkdtempSync(join(tmpdir(), 'osade-hist-store-')), 'terminals');

  const first = make();
  first.open('term:x', dir);
  first.write('term:x', 'echo OSADE_BEFORE_RESTART\r');
  await waitFor(first, 'term:x', 'OSADE_BEFORE_RESTART');
  first.closeAll(); // daemon shutdown: shells end, output is kept
  expect(readdirSync(historyDir)).toHaveLength(1);

  const second = make();
  second.open('term:x', dir);
  const replay = second.replay('term:x');
  expect(replay).toContain('OSADE_BEFORE_RESTART');
  expect(replay).toContain('Osade restarted');
});

it('forgets the output when the tab is closed', async () => {
  dir = mkdtempSync(join(tmpdir(), 'osade-hist-'));
  historyDir = join(mkdtempSync(join(tmpdir(), 'osade-hist-store-')), 'terminals');

  const shells = make();
  shells.open('term:y', dir);
  shells.write('term:y', 'echo OSADE_CLOSED_TAB\r');
  await waitFor(shells, 'term:y', 'OSADE_CLOSED_TAB');
  await new Promise((r) => setTimeout(r, 1_300)); // let the debounced save land
  expect(readdirSync(historyDir)).toHaveLength(1);

  shells.close('term:y');
  expect(existsSync(historyDir) ? readdirSync(historyDir) : []).toHaveLength(0);

  const again = make();
  again.open('term:y', dir);
  expect(again.replay('term:y')).not.toContain('OSADE_CLOSED_TAB');
});
