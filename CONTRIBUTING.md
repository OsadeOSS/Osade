# Contributing to Osade

Thanks for helping build **Osade** — a local-first desktop workspace for running coding agents
as open-source contributors.

> Rewritten 2026-09-04. This guide previously described Osade as an IDE built on VS Code, with
> a `vscode` upstream-tracking branch. That plan was abandoned: Osade is an Electron shell over
> the [herdr](https://herdr.dev) runtime, and there is no `vscode` branch. If you are following
> an older copy of this file, none of it applies.

---

## Before you start

Osade is **pre-M0**. The specification is complete and the herdr integration surface has been
verified against a live server, but product code has not started. Right now the highest-value
contributions are to the spec, the verified contract, and the M0 scaffolding — not features.

Read, in this order:

1. [`README.md`](README.md) — what Osade is and why.
2. [`docs/OSADE.md`](docs/OSADE.md) — the product requirements and build spec. Long, and worth
   it. **Sections marked INVARIANT are load-bearing** and sections marked **DECISION** were
   settled deliberately. Implement them; do not relitigate them in a PR. If you think one is
   wrong, open an issue that says which one and what evidence changed.
3. [`docs/HERDR-CONTRACT.md`](docs/HERDR-CONTRACT.md) — the verified herdr surface. **Where
   OSADE.md and this file disagree, this file is right.** Code against it.
4. [`docs/PRD-DELTA.md`](docs/PRD-DELTA.md) — where the spec was wrong about herdr, and why.
   Useful context for why some sections read the way they do.

There is one branch, `main`. Work from it.

---

## Rules this project enforces

These will send a PR back regardless of how good the code is. Most are lint-enforced
(`docs/OSADE.md` §20.1) rather than review comments.

- **Never edit anything under `backend/`.** That is herdr, kept as read-only reference. If
  herdr genuinely needs a change it goes in `patches/` with a written rationale and an
  upstream issue link — or better, upstream first. Osade does not fork herdr.
- **`backend/` is never a codegen input.** The herdr client is generated only from the pinned
  schema in `vendor/herdr/<version>-p<protocol>/api-schema.json` (§4.1). herdr's version
  string is not a contract: two different builds both call themselves `0.8.2`.
- **No `status` column, in any table, ever.** Status is a pure function over durable facts,
  recomputed at read time (§6). This is the single most important rule in the project.
- **Only `packages/daemon/src/herdr/**` may talk to herdr.** Only
  `packages/daemon/src/scm/**` may import an SCM SDK. One boundary each.
- **No second event path.** Every UI update originates from a database mutation flowing
  through `change_log`/CDC (§5.4). If the UI did not update, the mutation did not go through
  the database — that is the bug.
- **No agent-authored public write without a gate** (§14), and **no auto-merge, ever**.
- No `any`. No `console.*` or `process.exit` in `packages/daemon/src/**` outside `cli.ts`.

herdr's own `AGENTS.md` governs `backend/` only. It does not govern Osade code.

---

## Development workflow

```bash
git clone <your-fork>
cd osade
git checkout -b feature/<short-description>
```

Build instructions land with M0; there is nothing to compile yet.

You do **not** need to build herdr. Osade ships a prebuilt binary, deliberately: herdr requires
Zig 0.15.2 to build its vendored `libghostty-vt`, which is not an acceptable contributor
prerequisite. If you want to run against a local herdr, put it on `PATH` and expect the boot
drift check (§4.1.1) to complain when its protocol differs from the pinned one.

Commit with conventional-commit-style messages:

```text
feat: derive status for review_changes_requested
fix: drop replayed agent facts below the stored state_change_seq
docs: correct the event mapping table in OSADE.md §7
refactor: split the herdr event subscriber connection manager
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
packages/daemon/test/integration/  real sqlite, fake herdr, recorded GitHub fixtures
apps/desktop/tests/                vitest + playwright on the renderer
test/e2e/                          real herdr binary, real git repo fixture, one full task
```

Pre-commit runs unit + integration. E2E runs in CI. If CI hangs after tests appear to finish,
suspect a live subprocess or a daemon a unit-style suite booted — not a slow test.

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
anything involving herdr, add the output of `herdr status` and `herdr --version`.

Osade's logs live in `~/.osade/logs/<date>.log`. herdr's are in its session data directory —
`herdr status` prints the path.

**Security issues do not go in public issues.** See [`docs/SECURITY.md`](docs/SECURITY.md).

---

## Code of conduct

Be respectful and constructive. Osade is built by contributors from different backgrounds and
experience levels, and good contributions include both code and useful feedback.

---

## Licensing

Osade is Apache-2.0 (`LICENSE`). By contributing you agree your contributions are licensed
under it. If you add a dependency, update `THIRD-PARTY-NOTICES.md` in the same PR — and note
that `gate.dep_add` exists in the product for a reason: supply chain is a first-class concern
here, not an afterthought.

---

## If you are unsure

Open an issue or a discussion before spending significant time, especially for anything that
touches an INVARIANT. Those are cheap to discuss and expensive to unpick.
