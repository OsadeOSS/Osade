# Third-party notices

Osade is licensed under Apache-2.0 (see `LICENSE`). This file lists third-party software
Osade distributes or depends on.

---

## Distributed in the Osade application

### Terminal runtime

Osade ships a prebuilt runtime binary as `osade-runtime` at tag **v0.8.2** (protocol 20). It
lives under `vendor/runtime/0.8.2-p20/` after `node scripts/fetch-substrate-binaries.mjs`.
Osade does not modify the binary; it drives it through the runtime's documented JSON API.

| | |
| --- | --- |
| License | Apache-2.0 |
| LICENSE | `vendor/runtime/0.8.2-p20/LICENSE` (byte-for-byte from the pinned tag) |
| NOTICE | none — upstream has no `NOTICE` file at this tag |
| Pin | `vendor/runtime/0.8.2-p20/pin.json` |

A copy of the runtime's source is kept at `backend/` as reference material. It is not built
and is not part of the Osade build. As Apache-2.0 section 4(b) requires be stated, it is
modified in one way: `scripts/rebrand-source.mjs` renames the project's name to Osade's
throughout. Links to where the project lives, and its release, install and update addresses,
point at Osade's repository; the vendored patches' rationale links and author addresses are
kept, and the release manifests are trimmed to the pinned release. `backend/OSADE-PIN.json`
records the upstream commit that rename was applied to. Osade's own runtime is unaffected: it
is the upstream release binary, fetched and checksummed from `pin.json`.

### Vendored inside the runtime binary

The runtime binary statically includes these. They are listed because Osade redistributes that
binary.

| Component | License | Copyright / source |
| --- | --- | --- |
| **libghostty-vt** (Ghostty terminal core) | MIT | Copyright (c) 2024 Mitchell Hashimoto, Ghostty contributors — `backend/vendor/libghostty-vt/LICENSE` |
| **portable-pty** (vendored fork) | MIT | Wez Furlong / wezterm — `backend/vendor/portable-pty/Cargo.toml` |
| **ConPTY** (Windows zip only) | Microsoft | `vendor/runtime/0.8.2-p20/third-party/` |
| The runtime's Rust crate graph | mixed permissive (MIT / Apache-2.0 / BSD / others) | `vendor/runtime/0.8.2-p20/RUST-CRATES.md`, generated from `backend/Cargo.lock` by `pnpm attribution` |

Do not edit `RUST-CRATES.md` by hand. `pnpm attribution:check` fails when it drifts from the
lockfile.

---

## Osade's own dependencies

Resolved from `pnpm-lock.yaml`. Direct runtime dependencies, by package:

**`apps/desktop/`** (the window; Electron 33 bundles Chromium and Node)

- `electron` — [Electron](https://www.electronjs.org/) (MIT), including Chromium and Node
- `react`, `react-dom` — MIT
- `@xterm/xterm`, `@xterm/addon-fit` — MIT

**`packages/daemon/`**

- `better-sqlite3` — MIT
- `node-pty` — MIT
- `octokit` — MIT
- `@trpc/server` — MIT
- `ws` — MIT
- `yaml` — ISC
- `zod` — MIT

**`packages/contract/`** — `zod` (MIT)

**`packages/cli/`** — no third-party runtime dependencies beyond `@osade/contract`

A packaged build also ships a Node 22 runtime (`scripts/fetch-node-runtime.mjs`) so the daemon
does not run on Electron's ABI. Node is [MIT](https://github.com/nodejs/node/blob/main/LICENSE).

Transitive packages are in `pnpm-lock.yaml`. Adding a dependency that Osade redistributes
belongs in this file in the same PR.

---

## Assets

`assets/banner.png`, `assets/logo.jpg` and `assets/osade.png` are Osade's own, covered by
`LICENSE`.

The UI names IBM Plex Mono and falls back to the system monospace stack. Plex is **not
bundled**; there is nothing to attribute under the SIL Open Font License until it is.
