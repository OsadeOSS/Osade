import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import { TaskShells } from '../../src/domain/task-shell.js';

let dir: string;
let shells: TaskShells;

afterEach(() => {
  shells?.closeAll();
  if (dir) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 80 });
    } catch {
      // Windows keeps a just-killed powershell cwd locked; the temp sweeper takes it.
    }
  }
});

async function until<T>(read: () => Promise<T>, ok: (value: T) => boolean): Promise<T> {
  let last = await read();
  for (let i = 0; i < 60 && !ok(last); i++) {
    await new Promise((r) => setTimeout(r, 500));
    last = await read();
  }
  return last;
}

it('sees an agent started by hand in a shell, and sees it leave', async () => {
  dir = mkdtempSync(join(tmpdir(), 'osade-agents-'));
  const bin = join(dir, 'node_modules', 'cline', 'bin');
  mkdirSync(bin, { recursive: true });
  // Stands in for `cline`: a Node CLI under its own package, alive until stdin closes.
  writeFileSync(join(bin, 'cline'), "setTimeout(() => {}, 60000);\n");

  shells = new TaskShells();
  shells.open('term:a', dir);
  shells.open('term:b', dir);
  await new Promise((r) => setTimeout(r, 1500));
  expect((await shells.agents()).size).toBe(0);

  shells.write('term:a', `node "${join(bin, 'cline')}"\r`);
  const seen = await until(
    () => shells.agents(),
    (found) => found.has('term:a'),
  );
  expect(seen.get('term:a')).toEqual({ id: 'cline', name: 'Cline' });
  expect(seen.has('term:b')).toBe(false);

  shells.write('term:a', '\x03');
  const gone = await until(
    () => shells.agents(),
    (found) => !found.has('term:a'),
  );
  expect(gone.has('term:a')).toBe(false);
}, 60_000);
