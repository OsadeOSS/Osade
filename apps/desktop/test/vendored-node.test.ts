import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { vendoredNodePaths } from '../src/main/supervisor/daemon.js';

const TARGET = `${process.platform}-${process.arch}`;

/**
 * The vendored Node has to be findable from a source checkout.
 *
 * This is a regression test for a bug that cost every developer on a checkout a broken launch:
 * `vendoredNodePaths` counted four `..` from a `__dirname` that is one level deeper than the
 * count assumed, resolved to `apps/vendor/node/…` instead of the repo root, found nothing, and
 * let `nodeBinary` fall through to the machine's Node. On Node 24 the daemon then died on an ABI
 * mismatch and the app reported "did not become healthy within 30s" — which says nothing about
 * the real cause, thirty seconds into every launch.
 *
 * Asserted structurally rather than by checking the file exists, because the runtime is only
 * present after `node scripts/fetch-node-runtime.mjs` and this suite must pass without it.
 */
describe('vendoredNodePaths', () => {
  it('reaches the repository root, whichever directory depth this file sits at', () => {
    const repoRoot = resolve(__dirname, '..', '..', '..', '..');
    const name = process.platform === 'win32' ? 'node.exe' : 'node';
    const paths = vendoredNodePaths(name);

    expect(paths).toContain(join(repoRoot, 'vendor', 'node', TARGET, name));
  });

  it('does not stop at the apps directory, which is where counting landed', () => {
    const appsDir = resolve(__dirname, '..', '..', '..');
    const name = process.platform === 'win32' ? 'node.exe' : 'node';
    const paths = vendoredNodePaths(name);

    // Present is fine — walking up passes through it. What matters is that it is not the *last*
    // candidate, or the first existing one, or the only one.
    expect(paths.length).toBeGreaterThan(1);
    expect(paths).not.toEqual([join(appsDir, 'vendor', 'node', TARGET, name)]);
  });
});
