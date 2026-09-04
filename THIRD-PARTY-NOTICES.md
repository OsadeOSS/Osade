# Third-party notices

Osade is licensed under Apache-2.0 (see `LICENSE`). This file lists third-party software
Osade distributes or depends on.

> **Regenerated 2026-09-04.** This replaces `docs/ThirdPartyNotices.txt`, which was Visual
> Studio Code's notices file, inherited when Osade was planned as a Code-OSS fork. That plan
> was abandoned; Osade is an Electron shell over the herdr runtime and depends on none of the
> 60 packages that file listed (TextMate grammars, `microsoft/vscode-*`, `atom/language-*`,
> `@fig/autocomplete`). It has been deleted rather than trimmed.

---

## Distributed in the Osade application

### herdr

Osade ships a prebuilt **herdr** binary in `vendor/herdr/<version>-p<protocol>/` and uses it
as its execution substrate. Osade does not fork or modify herdr; it drives it through herdr's
documented JSON API and extension points.

| | |
| --- | --- |
| Project | herdr — terminal workspace manager for AI coding agents |
| Homepage | https://herdr.dev |
| Source | https://github.com/herdrdev/herdr |
| License | **Apache-2.0** |
| Pinned version | see `vendor/herdr/*/pin.json` |

A copy of the herdr source is kept at `backend/` as read-only reference material. It is not
built, not modified, and not part of the Osade build.

Apache-2.0 requires that herdr's own `NOTICE` file, if it carries one, be reproduced in
distributions that include the binary. **Action required before the first release:** fetch
`LICENSE` and `NOTICE` from the pinned herdr tag into
`vendor/herdr/<version>-p<protocol>/` and reference them here. Neither file was present in
the `backend/` copy.

### Vendored inside the herdr binary

The herdr binary statically includes these. They are listed because Osade redistributes that
binary.

| Component | License | Copyright / source |
| --- | --- | --- |
| **libghostty-vt** (Ghostty terminal core) | MIT | Copyright (c) 2024 Mitchell Hashimoto, Ghostty contributors — `backend/vendor/libghostty-vt/LICENSE`, pinned at 1.3.2-HEAD-+c5a21edfc |
| **portable-pty** (vendored fork) | MIT | wezterm project — `backend/vendor/portable-pty/Cargo.toml` |
| herdr's Rust dependency graph | mixed permissive (MIT / Apache-2.0 / BSD) | resolved in `backend/Cargo.lock` |

**Action required before the first release:** generate the full Rust crate attribution with
`cargo about` or `cargo deny` against the pinned herdr tag's `Cargo.lock` and append it here.
The crate graph is not enumerated in this file yet.

---

## Osade's own dependencies

**None yet.** Osade has no `package.json` and no source tree as of 2026-09-04; product code
starts at M0 (`docs/OSADE.md` §21).

When M0 lands, this section must list the runtime and bundled dependencies of
`apps/desktop/`, `packages/daemon/`, `packages/contract/`, `packages/cli/` and
`packages/skill-assets/` — Electron and its Chromium/Node components foremost, then
`better-sqlite3`, `sqlite-vec`, `octokit`, `zod`, `trpc` and the rest of the resolved tree.

Generate it from the lockfile rather than by hand, and wire the generator into CI so this
file cannot drift the way the one it replaced did.

---

## Assets

`assets/logo.jpg` and `assets/readme-logo.png` are Osade's own, covered by `LICENSE`.

IBM Plex Sans and IBM Plex Mono (`docs/OSADE.md` §19.2) are licensed under the SIL Open Font
License 1.1. Add the OFL text here when the fonts are actually bundled; if they are loaded
from a font CDN instead, say so and drop this entry.
