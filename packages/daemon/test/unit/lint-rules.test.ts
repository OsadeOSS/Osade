import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

/**
 * OSADE.md §20.1 — the lint rules are invariants, so they get tested like invariants.
 *
 * Flat config *replaces* a rule's options rather than merging them, so a config block naming
 * `no-restricted-syntax` a second time silently discards the first block's selectors. That
 * failure is invisible: the file lints clean and the invariant is simply gone. Each rule below
 * is therefore proved to fire against a snippet that violates it, in the scope it governs.
 */

const eslint = new ESLint({ cwd: new URL('../../../..', import.meta.url).pathname.slice(1) });

async function messagesFor(filePath: string, code: string): Promise<string[]> {
  const results = await eslint.lintText(code, { filePath, warnIgnored: false });
  return results.flatMap((r) => r.messages.map((m) => `${m.ruleId}: ${m.message}`));
}

const DOMAIN = 'packages/daemon/src/domain/probe.ts';
const DB = 'packages/daemon/src/db/probe.ts';
const RENDERER = 'apps/desktop/src/renderer/probe.ts';

describe('§20.1 lint boundaries actually fire', () => {
  it('§4.2 — the generated herdr client is off-limits outside daemon/src/herdr/**', async () => {
    const messages = await messagesFor(DOMAIN, "import '../herdr/generated/index.js';\n");
    expect(messages.join('\n')).toContain('§4.2');
  });

  it('§4.2 — raw socket access is off-limits outside daemon/src/herdr/**', async () => {
    const messages = await messagesFor(DOMAIN, "import net from 'node:net';\nexport const x = net;\n");
    expect(messages.join('\n')).toContain('raw socket access');
  });

  it('§11 — Octokit is off-limits outside daemon/src/scm/**', async () => {
    const messages = await messagesFor(DOMAIN, "import { Octokit } from 'octokit';\nexport const x = Octokit;\n");
    expect(messages.join('\n')).toContain('§11');
  });

  it('§20.1 — process.env destructuring', async () => {
    const messages = await messagesFor(DOMAIN, 'const { HOME } = process.env;\nexport const x = HOME;\n');
    expect(messages.join('\n')).toContain('§20.1');
  });

  it('§17 — a raw __orchestrator__ literal', async () => {
    const messages = await messagesFor(DOMAIN, "export const id = '__orchestrator__:r1';\n");
    expect(messages.join('\n')).toContain('§17');
  });

  it('§20.1 — console in the daemon outside cli.ts', async () => {
    const messages = await messagesFor(DOMAIN, "export function f() { console.log('x'); }\n");
    expect(messages.join('\n')).toContain('no-console');
  });

  it('§20.1 — process.exit in the daemon outside cli.ts', async () => {
    const messages = await messagesFor(DOMAIN, 'export function f() { process.exit(1); }\n');
    expect(messages.join('\n')).toContain('§20.1');
  });

  it('§6 — a status property in the db layer', async () => {
    const messages = await messagesFor(DB, "export const row = { status: 'implementing' };\n");
    expect(messages.join('\n')).toContain('§6');
  });

  it('§5.4 — a direct websocket emit outside the broadcaster', async () => {
    const messages = await messagesFor(
      DOMAIN,
      'export function f(socket: { send(s: string): void }) { socket.send("x"); }\n',
    );
    expect(messages.join('\n')).toContain('§5.4');
  });

  it('§18.1 — the renderer importing daemon internals', async () => {
    const messages = await messagesFor(RENDERER, "import '@osade/daemon';\n");
    expect(messages.join('\n')).toContain('§18.1');
  });

  it('§20.1 — no any', async () => {
    const messages = await messagesFor(DOMAIN, 'export const x: any = 1;\n');
    expect(messages.join('\n')).toContain('no-explicit-any');
  });
});

describe('the scopes that are deliberately exempt stay exempt', () => {
  it('daemon/src/herdr/** may import the generated client', async () => {
    const messages = await messagesFor(
      'packages/daemon/src/herdr/probe.ts',
      "import './generated/index.js';\n",
    );
    expect(messages.join('\n')).not.toContain('§4.2');
  });

  it('cli.ts may use console and process.exit — it is the one entry point', async () => {
    const messages = await messagesFor(
      'packages/daemon/src/cli.ts',
      "export function f() { console.log('x'); process.exit(0); }\n",
    );
    expect(messages.join('\n')).not.toContain('no-console');
    expect(messages.join('\n')).not.toContain('§20.1');
  });

  it('the CDC broadcaster may emit — that is its job', async () => {
    const messages = await messagesFor(
      'packages/daemon/src/server/cdc-broadcaster.ts',
      'export function f(socket: { send(s: string): void }) { socket.send("x"); }\n',
    );
    expect(messages.join('\n')).not.toContain('§5.4');
  });
});
