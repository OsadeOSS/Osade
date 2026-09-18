# Contributing to Osade

Thanks for helping build **Osade** — a local-first desktop workspace for running coding agents
as open-source contributors.

---

## Before you start

Read, in this order:

1. [`README.md`](README.md) — what Osade is, why, and how to run it from a checkout.
2. [`docs/OSADE.md`](docs/OSADE.md) — the product requirements and build spec. Long, and worth
   it. **Sections marked INVARIANT are load-bearing** and sections marked **DECISION** were
   settled deliberately. Implement them; do not relitigate them in a PR. If you think one is
   wrong, open an issue that says which one and what evidence changed.
3. [`SECURITY.md`](SECURITY.md) — what counts as a vulnerability here, and how to report one.

The substrate surface Osade codes against is the pinned schema under
`vendor/runtime/0.8.2-p20/api-schema.json` and the generated client in
`packages/daemon/src/substrate/generated/`.

The default branch is `main`. Open pull requests against it.

---

## Rules this project enforces

These will send a PR back regardless of how good the code is. Most are lint-enforced
([docs/OSADE.md](docs/OSADE.md) §20.1) rather than review comments.

- **Never hand-edit anything under `backend/`.** It is the substrate source, kept as reference.
  Its one change is the rename applied by `scripts/rebrand-source.mjs`; re-run that script rather
  than editing a file.
- **`backend/` is never a codegen input.** The substrate client is generated only from the
  pinned schema in `vendor/runtime/0.8.2-p20/api-schema.json` (§4.1). The substrate's version
  string is not a contract: two different builds both call themselves `0.8.2`.
- **No `status` column, in any table, ever.** Status is a pure function over durable facts,
  recomputed at read time (§6). This is the single most important rule in the project.
- **Only `packages/daemon/src/substrate/**` may talk to the substrate.** Only
  `packages/daemon/src/scm/**` may import an SCM SDK. One boundary each.
- **No second event path.** Every UI update originates from a database mutation flowing
  through `change_log`/CDC (§5.4). If the UI did not update, the mutation did not go through
  the database — that is the bug.
- **No agent-authored public write without a gate** (§14), and **no auto-merge, ever**.
- No `any`. No `console.*` or `process.exit` in `packages/daemon/src/**` outside `cli.ts`.

The substrate's own `AGENTS.md` governs `backend/` only. It does not govern Osade code.

---

## Development workflow

```bash
git clone https://github.com/OsadeOSS/Osade.git
cd Osade
git checkout -b feature/<short-description>
```

Laptop setup — clone, fetch the pinned runtime, run the Electron app — is in the README.

You do **not** need to build the substrate. Osade ships a prebuilt binary, deliberately: the
substrate requires Zig 0.15.2 to build its vendored `libghostty-vt`, which is not an acceptable
contributor prerequisite. If you want to run against a local substrate, put it on `PATH` (or
set `OSADE_SUBSTRATE_BIN`) and expect the boot drift check (§4.1.1) to complain when its
protocol differs from the pinned one.

Commit with conventional-commit-style messages:

```text
feat: derive status for review_changes_requested
fix: drop replayed agent facts below the stored state_change_seq
docs: correct the event mapping table in OSADE.md §7
refactor: split substrate event subscriber connection manager
```

Then open a PR against `main`.

---

## Pull requests

- **One concern per PR.** `feat: add agent system + redesign sidebar + fix auth` will be asked
  to split. Unrelated changes belong in unrelated PRs.
- Explain what changed **and why**. If the why is in OSADE.md, cite the section.
- Include tests. `deriveStatus` and the agent reducer are pure functions with property tests
  (§20.2); changes there without a test will not merge.
- Screenshots or a short clip for meaningful UI changes.
- Rebase on the latest `main` when practical.

If a change contradicts something in OSADE.md, update OSADE.md **in the same PR** and say what
evidence justified it. A spec that drifts from the code is worse than no spec.

### Testing

```text
packages/daemon/test/unit/         pure reducers, derive-status, verify-plan. No I/O.
packages/daemon/test/integration/  real sqlite, fake substrate, recorded GitHub fixtures
packages/daemon/test/e2e/          real substrate binary, real git repo fixture, one full task
apps/desktop/test/                 vitest on the renderer and main-process helpers
packages/cli/test/                 osade . and the task verbs
```

`pnpm check` is the gate: schema codegen, Rust crate attribution, lint, typecheck, and the
unit/integration vitest run. E2E is `pnpm test:e2e` and needs the fetched runtime. If CI hangs
after tests appear to finish, suspect a live subprocess or a daemon a unit-style suite booted —
not a slow test.

---

## Using agents on this repository

You are welcome to. Osade exists because agent-assisted contribution should be cheaper to
review, and this repository should hold itself to that standard.

- **Disclose it** in the PR description: which agent, and what you verified yourself.
- **You are the author.** Review the diff before opening the PR. "The agent wrote it" is not
  an explanation for a change you cannot defend in review.
- Volume is not the goal. A PR that costs a maintainer less than it saves is the goal — that
  is the product thesis (`README.md`).

---

## Reporting bugs

Include what you expected, what happened, steps to reproduce, relevant logs, and your OS. For
anything involving the substrate, add `osade-runtime --version` (or `pnpm substrate:drift` from
a checkout).

Osade's logs live in `~/.osade/logs/` (`%USERPROFILE%\.osade\logs` on Windows).

**Security issues do not go in public issues.** See [`SECURITY.md`](SECURITY.md).

---

## Code of conduct

Be respectful and constructive. Osade is built by contributors from different backgrounds and
experience levels, and good contributions include both code and useful feedback.

---

## Licensing

Osade is Apache-2.0 (`LICENSE`). By contributing you agree your contributions are licensed
under it. If you add a dependency Osade redistributes, update
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) in the same PR. `pnpm attribution` covers
the substrate crate graph; do not edit `RUST-CRATES.md` by hand.
