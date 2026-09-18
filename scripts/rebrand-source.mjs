#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

/**
 * Rename the substrate source in `backend/` into Osade's name.
 *
 * `backend/` is an Apache-2.0 upstream tree. The licence permits modifying and renaming it; what it
 * requires is that the licence and attribution travel with it (THIRD-PARTY-NOTICES.md,
 * vendor/runtime/<pin>/LICENSE) and that changed files say they were changed. This script *is*
 * that statement of change: it is the only edit ever made to `backend/`, it is deterministic, and
 * `backend/OSADE-PIN.json` records that it ran. Running it twice changes nothing, and
 * `scripts/fetch-substrate-source.mjs` applies it to every fresh fetch.
 *
 *   node scripts/rebrand-source.mjs [dir]      (default: backend; absolute paths accepted)
 *
 * Every name it works with is read from its record rather than written here: the upstream
 * repository and website from the runtime's pin.json, Osade's repository from package.json.

 *
 * What changes — the tree becomes a self-consistent Osade fork:
 *   - The upstream project name, in every case, in text and in file and directory names. A word
 *     swap of equal length keeps every line where it was, so `backend/…:line` citations hold.
 *   - Where the project lives — the repository, issues, pull requests, discussions, files in it,
 *     workflow repository guards, the website's home and documentation — points at Osade's
 *     repository.
 *   - Its release, install and update addresses are Osade's too: release links and release file
 *     names name Osade's GitHub releases, the package-registry lookup names Osade's package, and a
 *     website address serving a file this tree has (release manifests, install scripts, the agent
 *     guide, the agent-detection catalog) becomes that file's raw copy in Osade's repository.
 *     Osade itself does not use any of them: it ships its own pinned, checksummed runtime
 *     (vendor/runtime/<pin>/pin.json), which is untouched.
 *   - The website's own infrastructure (the plugin marketplace worker) names Osade's
 *     organisation's GitHub Pages host, which only that organisation can publish to.
 *   - Test fixtures naming other repositories after the project are renamed with it; the owner
 *     part is never touched.
 *   - The release manifests keep only the pinned release.
 *
 * What does not:
 *   - The vendored patches' provenance: the issue and pull-request links that say why each patch to
 *     a third-party library exists, and the author addresses in their headers. Rewritten, they would
 *     misstate who wrote those patches and why.
 *   - The upstream organisation's bare name and its other repositories, which renamed would invent
 *     organisations and repositories someone else could register.
 *   - Two environment variables that would collide: HOME and SESSION would take names Osade
 *     itself sets, so a runtime built from this source would read Osade's own home directory as
 *     its own. They take an OSADE_RUNTIME_ prefix instead.
 *   - `OSADE-PIN.json`, the provenance record. Binary files, and build output.
 */

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const requested = process.argv[2] ?? 'backend';
const target = /^(?:[A-Za-z]:)?[\\/]/.test(requested) ? requested : join(ROOT, requested);

const SKIP_DIRS = new Set(['.git', 'target', 'node_modules', 'zig-pkg', 'zig-cache', '.zig-cache', 'zig-out']);
const SKIP_FILES = new Set(['OSADE-PIN.json']);
const MAX_BYTES = 20 * 1024 * 1024;

// ---- names, from their records ---------------------------------------------------------------

function runtimePin() {
  const dir = join(ROOT, 'vendor', 'runtime');
  const keys = readdirSync(dir).filter((key) => existsSync(join(dir, key, 'pin.json'))).sort();
  return JSON.parse(readFileSync(join(dir, keys[keys.length - 1], 'pin.json'), 'utf8'));
}

const pin = runtimePin();
const [OWNER, NAME] = new URL(pin.license.upstream_repository).pathname.split('/').filter(Boolean);
const WEBSITE_HOST = new URL(pin.license.upstream_website).host.toLowerCase();

const osadeRepository = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).repository;
const OSADE_SLUG = new URL(String(osadeRepository.url ?? osadeRepository).replace(/\.git$/, ''))
  .pathname.split('/')
  .filter(Boolean)
  .slice(0, 2)
  .join('/');
const OSADE_REPO = `https://github.com/${OSADE_SLUG}`;
const OSADE_RAW = `https://raw.githubusercontent.com/${OSADE_SLUG}/main`;
const OSADE_PAGES = `https://${OSADE_SLUG.split('/')[0].toLowerCase()}.github.io`;
/** Where this tree sits inside Osade's repository. */
const IN_OSADE = 'backend';

const LOWER = NAME.toLowerCase();
const UPPER = LOWER.toUpperCase();
const TITLE = LOWER[0].toUpperCase() + LOWER.slice(1);
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const W = escape(LOWER);
const SLUG = escape(`${OWNER}/${NAME}`);
const MENTIONS = new RegExp(W, 'i');

/** The file being rewritten, relative to the tree — some rules depend on where a mention sits. */
let currentFile = '';

function swap(text) {
  return text.split(UPPER).join('OSADE').split(TITLE).join('Osade').split(LOWER).join('osade');
}

/** Does this tree have the file, under either name? Contents are rewritten before paths are renamed. */
function treeHas(relativePath) {
  return existsSync(join(target, relativePath)) || existsSync(join(target, swap(relativePath)));
}

// ---- addresses ------------------------------------------------------------------------------

const URL_PATTERN = /https?:\/\/[^\s"'`<>)\]]+/g;
/** Sentence punctuation and escaped newlines that trail a URL in prose and string literals. */
const TRAILING = /(?:\\n|[.,;:!?])+$/;
/** Hosts that are placeholders by definition, so a URL on one points nowhere real. */
const DUMMY_HOST = /^(example\.(com|org|net)|[\w-]+\.(example|test|invalid|localhost)|localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i;

function hostOf(url) {
  const authority = url.replace(/^https?:\/\//i, '').split(/[/?#]/)[0].replace(/^[^@]*@/, '');
  return authority.replace(/:[^:\]]*$/, '').toLowerCase();
}

/**
 * What a URL mentioning the project becomes: itself (kept), an address of Osade's, or null when it
 * is on a dummy host and is renamed like any other text.
 */
function mapUrl(url) {
  const host = hostOf(url);
  if (DUMMY_HOST.test(host)) return null;
  const path = url.replace(/^https?:\/\/[^/?#]*/i, '');

  if (host === 'github.com' || host === 'www.github.com') {
    const repo = path.match(new RegExp(`^/${SLUG}(?=$|[/?#.])(.*)$`, 'i'));
    if (!repo) {
      // Another repository. The upstream organisation's other repositories are real and theirs;
      // anyone else's named after the project is a test fixture, renamed with its owner untouched.
      const [, owner = '', ...rest] = path.split('/');
      if (owner.toLowerCase() === OWNER.toLowerCase()) return url;
      return `https://github.com/${owner}/${swap(rest.join('/'))}`;
    }
    const rest = repo[1];
    if (rest === '' || rest === '/' || rest === '.git') return OSADE_REPO;
    // Releases are Osade's: the links and the file names they serve.
    if (/^\/releases\b/i.test(rest)) return OSADE_REPO + swap(rest);
    // The vendored patches' provenance — why each patch to a third-party library exists — stays.
    if (currentFile.startsWith('vendor/') && /^\/(?:issues|pull|commit|compare)\b/i.test(rest)) return url;
    if (/^\/(?:issues|pull|commit|compare|discussions|security)\b/i.test(rest)) return OSADE_REPO + rest;
    const file = rest.match(/^\/(blob|tree)\/[^/]+\/(.+)$/);
    if (file) return `${OSADE_REPO}/${file[1]}/main/${IN_OSADE}/${swap(file[2])}`;
    return url;
  }

  // A raw file from the repository: if this tree has that file, it is Osade's file now.
  if (host === 'raw.githubusercontent.com') {
    const raw = path.match(new RegExp(`^/${SLUG}/[^/]+/(.+)$`, 'i'));
    if (raw && treeHas(raw[1])) return `${OSADE_RAW}/${IN_OSADE}/${swap(raw[1])}`;
    return url;
  }

  // Package registries: the updater asks about the package under Osade's name.
  if (host === 'formulae.brew.sh') return `https://formulae.brew.sh${swap(path)}`;

  if (host === WEBSITE_HOST || host.endsWith(`.${WEBSITE_HOST}`)) {
    // The website's own infrastructure: Osade's organisation's GitHub Pages host.
    if (currentFile.startsWith('workers/')) return OSADE_PAGES + path;
    // The plugin marketplace is a live service with no Osade equivalent; a repository page in its
    // place would hand its client HTML.
    if (/^\/api\//i.test(path)) return url;
    // The website serves files this tree has. Those addresses become the files' raw copies.
    const served = path.replace(/^\//, '').split(/[?#]/)[0];
    if (/\.\w+$/.test(served) && treeHas(join('distribution', served))) {
      return `${OSADE_RAW}/${IN_OSADE}/distribution/${swap(served)}`;
    }
    return OSADE_REPO;
  }

  return url;
}

// ---- text -----------------------------------------------------------------------------------

/** Held verbatim: author addresses in the vendored patches' headers. */
const KEPT = [new RegExp(`[\\w.+-]+@(?:[\\w-]+\\.)*${escape(WEBSITE_HOST)}\\b`, 'gi')];

/** The website and repository named without a URL: Osade's repository. */
const RELINKED = [
  [new RegExp(`\\b(?:[a-z0-9-]+\\.)*${escape(WEBSITE_HOST)}\\b`, 'gi'), `github.com/${OSADE_SLUG}`],
  [new RegExp(`\\b${SLUG}\\b`, 'gi'), OSADE_SLUG],
];

/** The organisation's bare name. Renamed, it would invent one someone else could register. */
const KEPT_OWNER = new RegExp(`\\b${escape(OWNER)}\\b`, 'gi');

const COLLIDING = [
  [new RegExp(`\\b${UPPER}_HOME\\b`, 'g'), 'OSADE_RUNTIME_HOME'],
  [new RegExp(`\\b${UPPER}_SESSION\\b`, 'g'), 'OSADE_RUNTIME_SESSION'],
];

const stats = { files: 0, replaced: 0, kept: 0, relinked: 0, renamed: 0, trimmed: 0 };

function rebrandText(text) {
  // A private-use character marks a held token: it cannot occur in the source text, and unlike
  // NUL it is not a control character.
  const vault = [];
  const hold = (token) => `${vault.push(token) - 1}`;

  let out = text.replace(URL_PATTERN, (match) => {
    if (!MENTIONS.test(match)) return match;
    const tail = (match.match(TRAILING) ?? [''])[0];
    const url = tail ? match.slice(0, -tail.length) : match;
    const mapped = mapUrl(url);
    if (mapped === null) return match;
    if (mapped === url) stats.kept += 1;
    else stats.relinked += 1;
    return hold(mapped) + tail;
  });

  for (const pattern of KEPT) {
    out = out.replace(pattern, (match) => {
      stats.kept += 1;
      return hold(match);
    });
  }
  for (const [pattern, replacement] of RELINKED) {
    out = out.replace(pattern, () => {
      stats.relinked += 1;
      return hold(replacement);
    });
  }
  out = out.replace(KEPT_OWNER, (match) => {
    stats.kept += 1;
    return hold(match);
  });

  for (const [pattern, replacement] of COLLIDING) out = out.replace(pattern, replacement);
  out = swap(out);

  return out.replace(/(\d+)/g, (_, index) => vault[Number(index)]);
}

// ---- release manifests ----------------------------------------------------------------------

/** Keep only the entry for the release a manifest currently describes. */
const MANIFESTS = {
  'distribution/latest.json': (manifest) => ({ ...manifest, releases: only(manifest.releases, manifest.version) }),
  'distribution/preview.json': (manifest) => ({ ...manifest, builds: only(manifest.builds, manifest.build_id) }),
};

function only(entries, key) {
  if (!entries || typeof entries !== 'object' || !(key in entries)) return entries;
  return { [key]: entries[key] };
}

/** JSON as the release tooling writes it: two-space indent, non-ASCII escaped. */
function manifestJson(value) {
  const json = JSON.stringify(value, null, 2).replace(
    /[-￿]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
  return `${json}\n`;
}

// ---- walk -----------------------------------------------------------------------------------

function isBinary(buffer) {
  return buffer.subarray(0, 8192).includes(0);
}

function walk(dir, visit) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path, visit);
      visit(path, true);
    } else {
      visit(path, false, stat);
    }
  }
}

function main() {
  if (!existsSync(target)) throw new Error(`${target} does not exist`);

  const paths = [];
  walk(target, (path, isDir, stat) => {
    paths.push(path);
    if (isDir || SKIP_FILES.has(basename(path)) || stat.size > MAX_BYTES) return;

    const buffer = readFileSync(path);
    if (isBinary(buffer)) return;

    const before = buffer.toString('utf8');
    let text = before;

    currentFile = relative(target, path).replace(/\\/g, '/');
    const trim = MANIFESTS[currentFile];
    if (trim) {
      const trimmed = manifestJson(trim(JSON.parse(text)));
      if (trimmed !== text) stats.trimmed += 1;
      text = trimmed;
    }

    if (MENTIONS.test(text)) text = rebrandText(text);

    if (text !== before) {
      const count = (value) => (value.match(new RegExp(W, 'gi')) ?? []).length;
      stats.replaced += Math.max(0, count(before) - count(text));
      writeFileSync(path, text);
      stats.files += 1;
    }
  });

  // Deepest first, so renaming a directory never invalidates a path still to be renamed.
  for (const path of paths.sort((a, b) => b.length - a.length)) {
    const name = basename(path);
    if (!MENTIONS.test(name) || SKIP_FILES.has(name)) continue;
    renameSync(path, join(dirname(path), swap(name)));
    stats.renamed += 1;
  }

  process.stdout.write(
    `${relative(ROOT, target) || '.'}: ${stats.files} files changed (${stats.replaced} mentions removed, ` +
      `${stats.trimmed} manifests trimmed), ${stats.renamed} paths renamed, ` +
      `${stats.relinked} links pointed at Osade, ${stats.kept} addresses kept\n`,
  );
}

main();
