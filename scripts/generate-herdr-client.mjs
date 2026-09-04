#!/usr/bin/env node
/**
 * Generates the typed herdr client from the PINNED schema.
 *
 * OSADE.md §4.1 — INVARIANT: `vendor/herdr/<version>-p<protocol>/api-schema.json` is the only
 * permitted codegen source. `backend/` is reference reading for behaviour and is never read
 * here. Method names are never hand-written; everything below is derived from the schema.
 *
 * Output: packages/daemon/src/herdr/generated/{types.ts,methods.ts,pin.ts,index.ts}
 *
 * Usage: node scripts/generate-herdr-client.mjs [--check]
 *        --check  fail if the generated output would change (for CI)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'json-schema-to-typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'packages/daemon/src/herdr/generated');
const CHECK_ONLY = process.argv.includes('--check');

/** The five top-level schemas in herdr's bundle, and the TS module each becomes. */
const SCHEMA_KEYS = [
  'request',
  'success_response',
  'error_response',
  'event',
  'subscription_event',
];

function findPin() {
  const vendorDir = join(ROOT, 'vendor/herdr');
  if (!existsSync(vendorDir)) {
    throw new Error(`no vendored herdr at ${vendorDir} — see OSADE.md §4.1`);
  }
  const targets = readdirSync(vendorDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  if (targets.length === 0) throw new Error(`no pinned herdr target in ${vendorDir}`);
  if (targets.length > 1) {
    throw new Error(
      `multiple pinned herdr targets (${targets.join(', ')}); exactly one must be pinned`,
    );
  }
  const dir = join(vendorDir, targets[0]);
  return {
    key: targets[0],
    dir,
    schema: JSON.parse(readFileSync(join(dir, 'api-schema.json'), 'utf8')),
    pin: JSON.parse(readFileSync(join(dir, 'pin.json'), 'utf8')),
  };
}

/**
 * herdr's bundle uses non-standard refs (`#/schemas/request/$defs/X`). Rewrite them to local
 * `#/$defs/X` so each top-level schema stands alone.
 */
function localiseRefs(node, schemaKey) {
  if (Array.isArray(node)) return node.map((n) => localiseRefs(n, schemaKey));
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref' && typeof v === 'string') {
        out[k] = v.replace(`#/schemas/${schemaKey}/$defs/`, '#/$defs/');
      } else {
        out[k] = localiseRefs(v, schemaKey);
      }
    }
    return out;
  }
  return node;
}

function pascal(key) {
  return key
    .split('_')
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join('');
}

/** Walk request.oneOf collecting {method, paramsRef} — the authoritative method list. */
function extractMethods(requestSchema) {
  const variants = requestSchema.oneOf ?? requestSchema.anyOf ?? [];
  const methods = [];
  for (const v of variants) {
    const method = v?.properties?.method?.const;
    if (typeof method !== 'string') continue;
    const ref = v?.properties?.params?.$ref;
    const params = typeof ref === 'string' ? ref.split('/').pop() : null;
    methods.push({ method, params });
  }
  methods.sort((a, b) => a.method.localeCompare(b.method));
  return methods;
}

const BANNER = (pinKey) => `/**
 * GENERATED — DO NOT EDIT.
 *
 * Source: vendor/herdr/${pinKey}/api-schema.json
 * Regenerate: pnpm herdr:codegen
 *
 * OSADE.md §4.1 — the pinned schema is the only codegen source. Never hand-write a herdr
 * method name, and never derive one from backend/.
 */
`;

async function main() {
  const { key, schema, pin } = findPin();
  const methods = extractMethods(schema.schemas.request);

  if (methods.length !== pin.herdr.method_count) {
    throw new Error(
      `pin.json says ${pin.herdr.method_count} methods, schema has ${methods.length}`,
    );
  }

  // ---- types.ts -----------------------------------------------------------
  let types = BANNER(key) + '\n/* eslint-disable */\n';
  for (const schemaKey of SCHEMA_KEYS) {
    const raw = schema.schemas[schemaKey];
    if (!raw) continue;
    const localised = localiseRefs(raw, schemaKey);
    localised.title = pascal(schemaKey);
    const ts = await compile(localised, pascal(schemaKey), {
      bannerComment: '',
      additionalProperties: false,
      declareExternallyReferenced: true,
      unreachableDefinitions: true,
      style: { singleQuote: true, printWidth: 100 },
    });
    types += `\n// ── ${schemaKey} ${'─'.repeat(Math.max(0, 62 - schemaKey.length))}\n\n${ts}`;
  }

  // ---- methods.ts ---------------------------------------------------------
  const methodNames = methods.map((m) => `  | '${m.method}'`).join('\n');
  const paramsEntries = methods
    .map((m) => `  '${m.method}': ${m.params ? `T.${m.params}` : 'Record<string, never>'};`)
    .join('\n');

  const methodsTs =
    BANNER(key) +
    `import type * as T from './types.js';

/** Every method name in the pinned schema. Derived, never typed by hand. */
export type HerdrMethod =
${methodNames};

/** Method name → params type, from the request schema's oneOf. */
export interface HerdrMethodParams {
${paramsEntries}
}

/** Runtime list, for the drift check and for tests. */
export const HERDR_METHODS: readonly HerdrMethod[] = Object.freeze([
${methods.map((m) => `  '${m.method}',`).join('\n')}
]) as readonly HerdrMethod[];
`;

  // ---- pin.ts -------------------------------------------------------------
  const pinTs =
    BANNER(key) +
    `/** Identity of the pinned herdr target. The version string is NOT a contract (§4.1). */
export const HERDR_PIN = Object.freeze({
  key: ${JSON.stringify(pin.identity.key)},
  version: ${JSON.stringify(pin.herdr.version)},
  protocol: ${pin.herdr.protocol},
  schemaVersion: ${pin.herdr.schema_version},
  methodCount: ${methods.length},
});
`;

  const indexTs =
    BANNER(key) +
    `export * from './methods.js';
export * from './pin.js';
export type * as HerdrSchema from './types.js';
`;

  const files = {
    'types.ts': types,
    'methods.ts': methodsTs,
    'pin.ts': pinTs,
    'index.ts': indexTs,
  };

  if (CHECK_ONLY) {
    let drifted = [];
    for (const [name, content] of Object.entries(files)) {
      const path = join(OUT_DIR, name);
      const existing = existsSync(path) ? readFileSync(path, 'utf8') : null;
      if (existing !== content) drifted.push(name);
    }
    if (drifted.length) {
      console.error(
        `generated herdr client is stale: ${drifted.join(', ')}\nrun: pnpm herdr:codegen`,
      );
      process.exit(1);
    }
    console.log(`herdr client is current (${key}, ${methods.length} methods)`);
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(OUT_DIR, name), content);
  }
  console.log(
    `generated ${Object.keys(files).length} files from ${key} — ${methods.length} methods`,
  );
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
