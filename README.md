# Osade

> **A local-first desktop workspace for running coding agents as open-source contributors.**

![Osade](./assets/readme-logo.png)

Osade runs several coding agents in parallel across real repositories — each in its own
git worktree, under that repository's own conventions, behind gates you control.

The unit of work is a **row in a ledger**: a live agent working an issue in an isolated
worktree, with its evidence visible inline.

---

## The problem Osade is actually solving

Open source in 2026 is closing the door on autonomous AI contributions. Godot banned
autonomous agent use. curl shut down its bug bounty. GitHub is exploring PR restrictions.
Maintainers report roughly 1 in 10 AI PRs meets their bar.

The bottleneck is **maintainer review capacity**, not code production. A tool that
increases agent PR volume makes the problem worse.

So Osade's goal is not "more agent PRs":

> **Reduce the maintainer's review cost per contribution to the point where an
> agent-assisted PR is cheaper to review than a human one.**

Every feature is justified against that sentence. Features that only increase throughput
are deprioritized. Features that produce **evidence, verification, provenance, and scoped
permission** are prioritized. Throughput is commoditized; trust is not.

---

## How it works

Three processes. Two of them survive the window closing.

```text
┌──────────────────────────────────────────────────────────────┐
│  Electron app                                                │
│    the ledger · task surface · diffs · gates · conventions   │
└───────┬───────────────────────────────┬──────────────────────┘
        │ tRPC + WS (loopback only)     │ terminal surfaces
        ▼                               │ (endpoint protocol)
┌───────────────────────────────┐       │
│  Osade daemon                 │       │
│    tasks · lifecycle · gates  │       │
│    verification · GitHub      │       │
│    conventions · memory       │       │
│    sqlite + change_log + CDC  │       │
└───────┬───────────────────────┘       │
        │ JSON API                      │
        ▼                               ▼
┌──────────────────────────────────────────────────────────────┐
│  herdr (vendored, headless)                                  │
│    PTYs · panes · tabs · worktrees · agent detection         │
│    hook integrations · session persistence                   │
└──────────────────────────────────────────────────────────────┘
```

Osade does not reimplement terminals. [**herdr**](https://herdr.dev) is the execution
substrate: it owns PTYs, VT parsing, git worktrees, agent process detection, and session
restore. Osade drives it over its JSON API and renders its terminal surfaces directly.

**Agents keep running when you close the window.** herdr and the daemon both survive it.

---

## Principles

### 1. Every task gets its own worktree

Agents never touch your main working directory. Each task is a worktree pinned to a
specific base commit, so a moving `main` cannot silently change what an agent is building
against.

```text
graphify/
├── main/
└── worktrees/
    ├── issue-417/     ← Claude
    ├── issue-421/     ← Codex
    └── issue-430/     ← Gemini
```

An existing worktree is authoritative. Osade only ever creates *missing* ones.

### 2. Status is derived, never stored

There is no `status` column anywhere in the database. Status is a pure function over
durable facts — what herdr observed, what verification returned, what GitHub reported —
recomputed on every read.

That is the difference between a board that drifts out of sync with reality and one that
cannot.

### 3. The repository is the source of truth

Agents can have memory. Memory is not authority. Git, the tests, CI, the issues, and the
pull requests always outrank an agent's assumptions.

### 4. No blind PR creation

Before contributing, Osade learns **how a repository expects contributions to happen** —
from `CONTRIBUTING.md`, merged and rejected PRs, review comments, CI config, and commit
history. Each mined convention carries **citations**; a convention with zero evidence is
rejected at write time.

```text
Graphify — repository skills
├── Discuss major API changes first        ← 4 merged PRs, 1 review thread
├── Run integration tests before pushing   ← .github/workflows/ci.yml
├── Include screenshots for UI changes     ← CONTRIBUTING.md §3
└── Keep PRs focused                       ← 2 rejected PRs
```

### 5. Verification before shipping

"The agent says it works" is not a signal. Osade derives a verification plan from the
repo's own CI config and manifests, shows it to you before first use, and runs it in a
lane you can watch. On failure, the failing command and its log tail go back to the agent.

*Agent acts → environment answers → agent adapts.* That loop is the product.

### 6. Every public write is gated

```text
Read       Allow
Edit       Allow
Test       Allow
Commit     Configurable
Push       Ask
Open PR    Ask
Merge      Never — Osade does not merge, ever
```

Gate payloads are hashed at request time and re-hashed at execution, so approving a
comment cannot execute different text.

### 7. Triage is the wedge

The highest-trust contribution often produces **no PR at all**: reproduce a reported bug,
bisect a regression, write a failing test, check for duplicates, verify that a *human's*
PR does what its description claims.

A maintainer will accept a bot that saves them 40 minutes of triage long before they
accept one that adds to their review queue.

### 8. Agent-agnostic

Osade is an environment, not a model. Claude Code, Codex, Gemini, opencode, droid, Kimi
and others are interchangeable. Behavior branches on **declared capabilities**
(`plan-mode`, `resume`, `hook-reporting`, …), never on which agent it is.

### 9. Layered memory, verification-gated

Knowledge is scoped `personal → org → repo → task → agent`, and something becomes durable
memory only if a verification run backs it. Every memory carries provenance and can expire.

### 10. Humans can take over at any point

The agent's workspace is your workspace. Pause it, inspect it, edit the code yourself,
hand control back. There is never a hidden layer between you and the code.

### 11. Everything stays on your machine

Local-first, single user, no hosted service. The daemon binds `127.0.0.1` only; herdr
speaks over local sockets. Everything Osade writes lives under `~/.osade/`, and the whole
system is resettable with `rm -rf ~/.osade`.

---

## The interface

A ledger, not a kanban board. With eight agents running, one vertical list sorted
**needs-you first** answers the real question better than horizontal columns ever will.

```text
┌────────────┬──────────────────────────────────────┬────────────────────────────┐
│ ORGS/REPOS │  LEDGER                              │  TASK SURFACE              │
│            │                                      │                            │
│ ▸ solana   │  ⚑ gate   open PR #—   auth-refresh  │  ┌──────────────────────┐  │
│   ▸ web3js │  ⚑ input  needs you    csv-import    │  │ agent │verify│diff│   │  │
│ ▸ langchain│  ● live   implementing rate-limit    │  ├──────────────────────┤  │
│   ▸ deep…  │  ✗ fail   verify       parser-fix    │  │   terminal surface   │  │
│            │  ○ idle   queued       docs-typo     │  └──────────────────────┘  │
│ + add repo │  ── merged ─────────────────────     │  gates · conventions ·     │
│            │  ✓ merged pr #4421     null-guard    │  memory · checkpoints      │
└────────────┴──────────────────────────────────────┴────────────────────────────┘
```

Light-first. IBM Plex Sans and Mono. Rules and borders carry information; zero shadows.
The vernacular is `git status` porcelain, because that is what this is — a record of
machine work on a public commons.

---

## The Osade loop

The goal is not autonomous coding. It is **trustworthy contribution**.

```text
Understand → Isolate → Execute → Verify → Review → Ship → Remember ↺
```

Every contribution makes the environment smarter about the developer, the repository, and
the organization.

**Humans decide. Agents execute. Osade coordinates and remembers.**

---

## Status

**Pre-M0.** The specification is complete and the herdr integration surface has been
verified against a live server. Product code has not started.

What has been proven end-to-end, headless, with no terminal client attached:

- herdr spawns and keeps agent panes alive with **zero clients** connected
- a git worktree is created on a pinned base commit and opened as a workspace
- Claude Code launches inside it, and its first-run trust prompt is detected as `blocked`
- a prompt is submitted, and the status stream reports `blocked → idle → working → done`

That last line is the spine: the lifecycle Osade renders comes from herdr's own detection —
no screen scraping, no polling.

| Milestone | Scope |
| --- | --- |
| **M0** | The three-process spine: typed herdr client, sqlite + CDC, Electron surface, one task end-to-end |
| **M1** | Lifecycle, verification, approval gates |
| **M2** | GitHub, the contribution loop, triage tasks |
| **M3** | Repository conventions mining |
| **M4** | Layered memory, multi-agent coordination |
| **M5** | Org workspaces and cross-repo work |

---

## Repository layout

```text
osade/
├── backend/     herdr — the execution substrate. Read-only reference; never edited here.
├── docs/        the spec (below)
└── assets/
```

| Document | What it is |
| --- | --- |
| [`docs/OSADE.md`](docs/OSADE.md) | Product requirements and build spec. Start here. |
| [`docs/HERDR-CONTRACT.md`](docs/HERDR-CONTRACT.md) | The verified herdr integration surface — real method names, event names and payloads, with citations. What the daemon codes against. |
| [`docs/PRD-DELTA.md`](docs/PRD-DELTA.md) | Where the spec was wrong about herdr, and the correction. |
| [`docs/adr/`](docs/adr) | One record per DECISION taken during the build. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Architecture notes. |

Sections in `OSADE.md` marked **INVARIANT** are load-bearing. Sections marked **DECISION**
record a choice made deliberately over a plausible alternative.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

Osade builds on [herdr](https://herdr.dev) (Apache-2.0) and does not fork it — it extends
it only through documented extension points.
