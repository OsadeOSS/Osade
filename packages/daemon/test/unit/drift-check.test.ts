import { describe, expect, it } from 'vitest';

import { HERDR_METHODS, HERDR_PIN } from '../../src/herdr/generated/index.js';
import { compareToPin, extractMethods } from '../../src/herdr/drift-check.js';

/**
 * OSADE.md §4.1.1. The interesting logic is the comparison, so it is pure and tested here;
 * `test/integration/herdr-live.test.ts` runs it against a real binary.
 */

function schemaWith(protocol: number, methods: readonly string[]): unknown {
  return {
    protocol,
    schemas: {
      request: {
        oneOf: methods.map((m) => ({
          properties: { method: { const: m }, params: { $ref: '#/x' } },
        })),
      },
    },
  };
}

const PINNED = [...HERDR_METHODS];

describe('drift check — §4.1.1', () => {
  it('extracts the method set from a schema bundle', () => {
    expect(extractMethods(schemaWith(20, ['b', 'a']))).toEqual(['a', 'b']);
  });

  it('an exact match is ok and not fatal', () => {
    const r = compareToPin(schemaWith(HERDR_PIN.protocol, PINNED), '/herdr');
    expect(r.ok).toBe(true);
    expect(r.fatal).toBe(false);
    expect(r.missing).toEqual([]);
    expect(r.unexpected).toEqual([]);
  });

  it('assertion 1 — a protocol mismatch is fatal', () => {
    const r = compareToPin(schemaWith(HERDR_PIN.protocol + 2, PINNED), '/herdr');
    expect(r.fatal).toBe(true);
    expect(r.message).toContain('protocol mismatch');
    expect(r.message).toContain(String(HERDR_PIN.protocol));
  });

  it('assertion 2 — a missing pinned method is fatal and is named', () => {
    const short = PINNED.filter((m) => m !== 'agent.start');
    const r = compareToPin(schemaWith(HERDR_PIN.protocol, short), '/herdr');
    expect(r.fatal).toBe(true);
    expect(r.missing).toEqual(['agent.start']);
    expect(r.message).toContain('agent.start');
  });

  it('assertion 3 — a superset warns but never blocks the boot', () => {
    // This is the real 0.8.2 source-vs-binary gap (PRD-DELTA #1): a newer herdr has methods
    // the pin does not. Every herdr upgrade would be an outage if this were fatal.
    const richer = [...PINNED, 'pane.scroll', 'command.invoke'];
    const r = compareToPin(schemaWith(HERDR_PIN.protocol, richer), '/herdr');
    expect(r.fatal).toBe(false);
    expect(r.ok).toBe(false);
    expect(r.unexpected).toEqual(['command.invoke', 'pane.scroll']);
    expect(r.message).toContain('schedule a re-pin');
  });

  it('never gates on the version string', () => {
    // Two builds share `0.8.2` with different protocols, so the version is decorative.
    const a = compareToPin(schemaWith(HERDR_PIN.protocol, PINNED), '/herdr');
    expect(a.message).not.toContain('version');
  });

  it('a schema with no protocol field is fatal, and says so legibly', () => {
    const r = compareToPin({ schemas: { request: { oneOf: [] } } }, '/herdr');
    expect(r.fatal).toBe(true);
    expect(r.message).toContain('no protocol field');
  });
});

describe('generated client', () => {
  it('carries the pinned identity', () => {
    expect(HERDR_PIN.protocol).toBe(20);
    expect(HERDR_PIN.key).toBe('0.8.2-p20');
    expect(HERDR_METHODS.length).toBe(HERDR_PIN.methodCount);
  });

  it('contains the methods M0 depends on', () => {
    for (const m of [
      'ping',
      'session.snapshot',
      'worktree.create',
      'worktree.remove',
      'tab.create',
      'agent.start',
      'agent.prompt',
      'agent.list',
      'events.subscribe',
      'pane.read',
      'pane.send_keys',
      'pane.wait_for_output',
    ] as const) {
      expect(HERDR_METHODS, `${m} missing from the pinned schema`).toContain(m);
    }
  });

  it('does NOT contain the methods absent from this target (PRD-DELTA #1)', () => {
    // Present in backend/src, absent from the shipped binary. If one of these ever appears,
    // the pin moved and §4.4.1's "no selection, no scroll" reasoning needs revisiting.
    for (const m of ['pane.selection.read', 'pane.scroll', 'pane.edit_scrollback']) {
      expect(HERDR_METHODS as readonly string[]).not.toContain(m);
    }
  });
});
