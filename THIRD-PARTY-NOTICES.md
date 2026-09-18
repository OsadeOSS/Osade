# Third-party notices

Osade is licensed under Apache-2.0 (see `LICENSE`). This file lists third-party software
Osade distributes or depends on.

---

## Distributed in the Osade application

### Terminal runtime

Osade ships a prebuilt runtime binary, built by the upstream project below, in
`vendor/runtime/<version>-p<protocol>/`, and uses it as its execution substrate. Osade does not
modify the binary; it drives it through the runtime's documented JSON API and extension points.

A copy of the runtime's source is kept at `backend/` as reference material. It is not built and not
part of the Osade build. As Apache-2.0 section 4(b) requires be stated, it is modified in one way:
`scripts/rebrand-source.mjs` renames the project's name to Osade's throughout. Links to where
the project lives, and its release, install and update addresses, point at Osade's repository;
the vendored patches' rationale links and author addresses are kept, and the release manifests
are trimmed to the pinned release. Osade's own runtime is unaffected: it is the
upstream release binary, fetched and checksummed from `vendor/runtime/<version>-p<protocol>/pin.json`. `backend/OSADE-PIN.json` records the
upstream commit it was applied to.

Apache-2.0 requires that the runtime's own `NOTICE` file, if it carries one, be reproduced in
distributions that include the binary. **Action required before the first release:** fetch
`LICENSE` and `NOTICE` from the pinned tag into
`vendor/runtime/<version>-p<protocol>/` and reference them here. Neither file was present in
the `backend/` copy.

### Vendored inside the runtime binary

The runtime binary statically includes these. They are listed because Osade redistributes that
binary.

| Component | License | Copyright / source |
| --- | --- | --- |
| **libghostty-vt** (Ghostty terminal core) | MIT | Copyright (c) 2024 Mitchell Hashimoto, Ghostty contributors — `backend/vendor/libghostty-vt/LICENSE`, pinned at 1.3.2-HEAD-+c5a21edfc |
| **portable-pty** (vendored fork) | MIT | wezterm project — `backend/vendor/portable-pty/Cargo.toml` |
| The runtime's Rust dependency graph | mixed permissive (MIT / Apache-2.0 / BSD) | resolved in `backend/Cargo.lock` |

**Action required before the first release:** generate the full Rust crate attribution with
`cargo about` or `cargo deny` against the pinned tag's `Cargo.lock` and append it here.
The crate graph is not enumerated in this file yet.

---

## Osade's own dependencies

**None yet.** Osade has no `package.json` and no source tree as of 2026-09-04; product code
starts at M0 (`docs/architechture/OSADE.md` §21).

When M0 lands, this section must list the runtime and bundled dependencies of
`apps/desktop/`, `packages/daemon/`, `packages/contract/`, `packages/cli/` and
`packages/skill-assets/` — Electron and its Chromium/Node components foremost, then
`better-sqlite3`, `sqlite-vec`, `octokit`, `zod`, `trpc` and the rest of the resolved tree.

Generate it from the lockfile rather than by hand, and wire the generator into CI so this
file cannot drift the way the one it replaced did.

---

## Assets

`assets/osade.png`, `assets/logo.jpg` and `assets/readme-logo.png` are Osade's own, covered by `LICENSE`.

IBM Plex Sans and IBM Plex Mono (`docs/architechture/OSADE.md` §19.2) are licensed under the SIL Open Font
License 1.1. Add the OFL text here when the fonts are actually bundled; if they are loaded
from a font CDN instead, say so and drop this entry.
