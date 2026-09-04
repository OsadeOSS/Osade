/**
 * The boot drift check — OSADE.md §4.1.1.
 *
 * herdr's version string is not a contract: two builds both report `0.8.2` with different
 * protocols and a ten-method gap (PRD-DELTA #1). So a herdr target is identified by
 * (protocol, method set), and this compares exactly that.
 *
 * Three assertions, in order:
 *   1. live.protocol === pinned protocol            → fatal
 *   2. methodSet(live) ⊇ methodSet(pinned)          → fatal
 *   3. methodSet(live) \ methodSet(pinned) is empty → warn only
 *
 * Assertion 3 must never block a boot, or every herdr upgrade becomes an outage.
 * The version string is deliberately never compared.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { HERDR_METHODS, HERDR_PIN } from './generated/index.js';

const execFileAsync = promisify(execFile);

/** How long we give `herdr api schema --json` before giving up. */
const SCHEMA_CAPTURE_TIMEOUT_MS = 10_000;

/** herdr's schema bundle prints ~265 KB; allow generous headroom. */
const SCHEMA_MAX_BUFFER = 8 * 1024 * 1024;

export interface DriftResult {
  ok: boolean;
  /** True when the daemon must refuse to start. */
  fatal: boolean;
  liveProtocol: number;
  liveMethodCount: number;
  /** Pinned methods the live binary does not have. Fatal when non-empty. */
  missing: string[];
  /** Methods the live binary has that the pin does not. Informational. */
  unexpected: string[];
  message: string;
}

export class HerdrDriftError extends Error {
  readonly result: DriftResult;
  constructor(result: DriftResult) {
    super(result.message);
    this.name = 'HerdrDriftError';
    this.result = result;
  }
}

/**
 * Reads the schema from the binary that is actually about to be used.
 *
 * Deliberately not from a cached copy: the point is to catch a user running a different herdr
 * than the one Osade pinned.
 */
export async function readLiveSchema(binaryPath: string): Promise<unknown> {
  const { stdout } = await execFileAsync(binaryPath, ['api', 'schema', '--json'], {
    timeout: SCHEMA_CAPTURE_TIMEOUT_MS,
    maxBuffer: SCHEMA_MAX_BUFFER,
    windowsHide: true,
  });
  return JSON.parse(stdout);
}

/** Pulls the method set out of a schema bundle's `request.oneOf`. */
export function extractMethods(schema: unknown): string[] {
  const request = (schema as { schemas?: { request?: unknown } })?.schemas?.request as
    | { oneOf?: unknown[]; anyOf?: unknown[] }
    | undefined;
  const variants = request?.oneOf ?? request?.anyOf ?? [];
  const methods: string[] = [];
  for (const variant of variants) {
    const constValue = (variant as { properties?: { method?: { const?: unknown } } })?.properties
      ?.method?.const;
    if (typeof constValue === 'string') methods.push(constValue);
  }
  return methods.sort();
}

function extractProtocol(schema: unknown): number {
  const protocol = (schema as { protocol?: unknown })?.protocol;
  return typeof protocol === 'number' ? protocol : Number.NaN;
}

/**
 * Pure comparison, so the interesting logic is testable without a subprocess.
 *
 * `binaryPath` only appears in the message.
 */
export function compareToPin(liveSchema: unknown, binaryPath: string): DriftResult {
  const liveProtocol = extractProtocol(liveSchema);
  const liveMethods = extractMethods(liveSchema);
  const live = new Set(liveMethods);
  const pinned = new Set<string>(HERDR_METHODS);

  const missing = [...pinned].filter((m) => !live.has(m)).sort();
  const unexpected = [...live].filter((m) => !pinned.has(m)).sort();

  const protocolMismatch = liveProtocol !== HERDR_PIN.protocol;
  const fatal = protocolMismatch || missing.length > 0;

  const summary = (list: string[]) =>
    list.length === 0
      ? '(none)'
      : list.length <= 6
        ? list.join(', ')
        : `${list.slice(0, 6).join(', ')}, +${list.length - 6}`;

  let message: string;
  if (protocolMismatch) {
    message =
      `herdr protocol mismatch: pinned ${HERDR_PIN.key} expects protocol ` +
      `${HERDR_PIN.protocol}, binary at ${binaryPath} reports ` +
      `${Number.isNaN(liveProtocol) ? 'no protocol field' : liveProtocol}.\n` +
      `missing methods: ${summary(missing)}   unexpected methods: ${summary(unexpected)}\n` +
      `re-pin with: herdr api schema --json > ` +
      `vendor/herdr/<version>-p<protocol>/api-schema.json`;
  } else if (missing.length > 0) {
    message =
      `herdr is missing ${missing.length} pinned method(s): ${summary(missing)}.\n` +
      `binary at ${binaryPath} reports protocol ${liveProtocol}, which matches the pin, ` +
      `so this is a build difference rather than a protocol bump.\n` +
      `re-pin with: herdr api schema --json > ` +
      `vendor/herdr/<version>-p<protocol>/api-schema.json`;
  } else if (unexpected.length > 0) {
    message =
      `herdr at ${binaryPath} has ${unexpected.length} method(s) beyond the pin ` +
      `(${summary(unexpected)}). This is a newer build; Osade will work, but schedule a re-pin.`;
  } else {
    message = `herdr ${HERDR_PIN.key} matches the pin (protocol ${liveProtocol}, ${liveMethods.length} methods).`;
  }

  return {
    ok: !fatal && unexpected.length === 0,
    fatal,
    liveProtocol,
    liveMethodCount: liveMethods.length,
    missing,
    unexpected,
    message,
  };
}

/**
 * Boot guard. Throws `HerdrDriftError` on a fatal mismatch; returns the result otherwise so
 * the caller can log a warning for an unexpected-method superset.
 */
export async function assertNoDrift(binaryPath: string): Promise<DriftResult> {
  let liveSchema: unknown;
  try {
    liveSchema = await readLiveSchema(binaryPath);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new HerdrDriftError({
      ok: false,
      fatal: true,
      liveProtocol: Number.NaN,
      liveMethodCount: 0,
      missing: [],
      unexpected: [],
      message:
        `could not read the herdr schema from ${binaryPath}: ${reason}\n` +
        `Osade cannot verify which herdr it is talking to, so it will not start.`,
    });
  }

  const result = compareToPin(liveSchema, binaryPath);
  if (result.fatal) throw new HerdrDriftError(result);
  return result;
}
