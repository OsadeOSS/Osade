/**
 * CLI wrapper around the boot drift check — OSADE.md §4.1.1.
 *
 * `pnpm herdr:drift [path-to-herdr]`
 *
 * Runs the same comparison the daemon runs at boot, so CI and a developer's shell exercise
 * one implementation rather than two that can disagree.
 *
 * Exit codes: 0 ok (including a warn-only superset), 1 fatal drift.
 */
import { assertNoDrift, HerdrDriftError } from './drift-check.js';

const binary = process.argv[2] ?? 'herdr';

try {
  const result = await assertNoDrift(binary);
  console.log(result.ok ? `ok: ${result.message}` : `warning: ${result.message}`);
} catch (err) {
  if (err instanceof HerdrDriftError) {
    console.error(`fatal: ${err.message}`);
  } else {
    console.error(`fatal: ${(err as Error).message}`);
  }
  process.exit(1);
}
