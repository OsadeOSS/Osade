#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

/**
 * Fetch the substrate's source into `backend/` — OSADE.md §4.1, ADR 0002.
 *
 * `backend/` stays committed (ADR 0002); this restores it if it is deleted, and is how the pin
 * moves at the next substrate bump. Nothing builds on it.
 *
 * Pinned to the commit `backend/` **is**, so running this reproduces the tree Osade's `file:line`
 * citations were written against rather than shifting them.
 *
 * **Pinned to a commit, not a tag.** A tag can be moved; a commit sha is the content. GitHub's
 * codeload serves an archive for any sha, so asking for the sha *is* the verification — there is
 * no tarball checksum here because a tarball hash would be a hash of GitHub's compression
 * settings, which they explicitly decline to keep stable.
 *
 *   node scripts/fetch-substrate-source.mjs [--force]
 */

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const BACKEND = join(ROOT, 'backend');

/**
 * `owner/name` of the repository `backend/` is fetched from, from the runtime pin.
 */
function upstreamRepository() {
  const pinDir = join(ROOT, 'vendor', 'runtime');
  const [key] = readdirSync(pinDir).sort().reverse();
  const pin = JSON.parse(readFileSync(join(pinDir, key, 'pin.json'), 'utf8'));
  return new URL(pin.license.upstream_repository).pathname.replace(/^\/|\/$/g, '');
}

/** Where the upstream repository is recorded, rather than repeating it in backend/OSADE-PIN.json. */
const UPSTREAM_RECORD = 'vendor/runtime/<pin>/pin.json (license.upstream_repository)';

/** The substrate Osade reads. Bump alongside `vendor/runtime/<version>-p<protocol>/`. */
const PIN = {
  repository: upstreamRepository(),
  // The commit `backend/` actually is — established by comparing every tracked blob hash
  // against the upstream tree (all 1766 identical). Not the v0.8.2 tag: the source is ahead of
  // the binary, which is pinned separately in vendor/runtime/0.8.2-p20.
  commit: '94f6d9c0d9bb',
  committedAt: '2026-09-02',
};

function log(message) {
  process.stdout.write(`${message}\n`);
}

function main() {
  const force = process.argv.includes('--force');

  if (existsSync(BACKEND) && readdirSync(BACKEND).length > 0) {
    if (!force) {
      log(`backend/ already exists. Nothing to do — pass --force to replace it.`);
      log(`  pinned: ${PIN.repository}@${PIN.commit.slice(0, 12)} (${PIN.committedAt})`);
      return;
    }
    log('removing the existing backend/ …');
    rmSync(BACKEND, { recursive: true, force: true });
  }

  const url = `https://codeload.github.com/${PIN.repository}/tar.gz/${PIN.commit}`;
  const staging = join(ROOT, '.substrate-src');
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });

  const archive = join(staging, 'source.tar.gz');
  log(`fetching ${PIN.repository}@${PIN.commit.slice(0, 12)} …`);
  execFileSync('curl', ['-sSL', '--fail', '-o', archive, url], { stdio: 'inherit' });

  log('extracting …');
  execFileSync('tar', ['-xzf', archive, '-C', staging], { stdio: 'inherit' });

  // codeload names the top directory <repo>-<sha>.
  const extracted = readdirSync(staging).find((entry) => entry.startsWith(`${PIN.repository.split('/')[1]}-`));
  if (!extracted) throw new Error('the archive did not contain the expected top-level directory');

  renameSync(join(staging, extracted), BACKEND);
  rmSync(staging, { recursive: true, force: true });

  // The one change backend/ carries, applied to every fetch so a restored tree matches the
  // committed one.
  execFileSync(process.execPath, [join(ROOT, 'scripts', 'rebrand-source.mjs'), 'backend'], {
    stdio: 'inherit',
  });

  // A marker, so anyone looking at a checkout can tell what they have without re-deriving it.
  writeFileSync(
    join(BACKEND, 'OSADE-PIN.json'),
    `${JSON.stringify({ upstream: UPSTREAM_RECORD, commit: PIN.commit, committed_at: PIN.committedAt, fetched_at: new Date().toISOString().slice(0, 10), modified_by: 'scripts/rebrand-source.mjs' }, null, 2)}\n`,
  );

  log(`backend/ is ${PIN.repository}@${PIN.commit.slice(0, 12)} (${PIN.committedAt}).`);
  log('Renamed by scripts/rebrand-source.mjs; otherwise the upstream tree. Do not hand-edit it.');
}

main();
