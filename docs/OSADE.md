# Osade — Product Requirements & Build Spec

> **Read this whole document before writing code.** It is written to be handed to a coding
> agent. Sections marked **INVARIANT** are load-bearing; breaking one produces a class of bug
> that is expensive to find later. Sections marked **DECISION** record a choice that was made
> deliberately over a plausible alternative — do not re-litigate them mid-build.

---

## 0. What Osade is

Osade is a local-first desktop workspace for running multiple coding agents as **open-source
contributors** across real repositories.

The unit of value: **a row in the ledger is a live agent working an issue in an isolated
worktree, under a repo's own conventions, behind human-controlled gates.**

### 0.1 The design constraint that shapes everything

Open source in 2026 is actively closing the door on autonomous AI contributions. Godot banned
autonomous agent use outright. curl shut down its bug bounty. GitHub is exploring PR
restrictions. Maintainers report roughly 1 in 10 AI PRs meets their bar.

The bottleneck is **maintainer review capacity**, not code production. A tool that increases
agent PR volume makes the problem worse.

So Osade's design goal is not "more agent PRs." It is:

> **Reduce the maintainer's review cost per contribution to the point where an agent-assisted
> PR is cheaper to review than a human one.**

Every feature in this document is justified against that sentence. Features that only increase
throughput are deprioritized. Features that produce evidence, verification, provenance, and
scoped permission are prioritized. This is also the honest competitive moat: throughput is
commoditized, trust is not.

### 0.2 What we are joining together

| Source | What Osade takes | What Osade does not take |
| --- | --- | --- |
| **herdr** (Rust) | Entire execution substrate: PTYs, panes, tabs, layout, git worktrees, agent process detection, agent hook integrations, session persistence, live handoff, JSON API + event hub | Its TUI client; its ratatui rendering path |
| **Kanban / Cline** (TS) | Board-as-orchestrator model, narrow hook vocabulary, turn checkpoints, agent catalog shape, worktree hard-won rules, auto-review loop, multi-viewer backpressure | Its own PTY layer (herdr owns that), its `node-pty`/xterm-headless mirror, the in-process SDK path |
| **AO** (Go) | Durable-facts/derived-status invariant, capability gating, reviewer filesystem gateway, CDC-single-event-path, orchestrator-as-an-agent-driving-our-own-CLI, state containment | Its Go daemon, its saga-based TUI↔chat handoff (deferred to M5+) |
| **New to Osade** | Repository conventions mining with citation, layered verification-gated memory, OSS lifecycle state machine, approval gates on public writes, org workspaces | — |

---

## 1. Non-goals

Do not build these. If a task seems to require one, stop and ask.

1. **Do not fork herdr.** Extend it only through its documented extension points (JSON API
   `Method` variants, `distribution/agent-detection/*.toml`, `src/integration/assets/<agent>/`,
   plugins). If a patch is genuinely unavoidable it goes in `patches/` with a written rationale
   and an upstream issue link.
2. **Do not reimplement** PTY handling, VT parsing, terminal emulation, worktree creation, agent
   process detection, or session restore. herdr does all of it.
3. **No auto-merge. Ever.** Osade never merges a PR.
4. **No agent-authored public write without a gate.** Comments, PRs, reviews, pushes — all gated.
5. **No hosted multi-tenant service.** Local-first, single user, one machine.
6. **No custom model or agent.** Osade is agent-agnostic; it drives whatever CLI the user has.
7. **No web-only build in v1.** Electron is the shell. Browser access is a later milestone.
8. **Do not build a bespoke agent-to-agent protocol.** See §17.

---

## 2. System shape

Three processes. Two of them survive the window closing.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│  Electron app  (apps/desktop)                                               │
│                                                                             │
│   main process            supervisor: spawn/adopt herdr + daemon,           │
│                           safeStorage tokens, menus, deep links, updates    │
│                                                                             │
│   utility process         herdr endpoint transport (unix socket)            │
│     └── MessagePort ────► renderer   (surface frames bypass main IPC)       │
│                                                                             │
│   renderer (React)        the ledger, task detail, terminal surface,        │
│                           diff view, conventions, gates                     │
└───────┬─────────────────────────────────────────┬───────────────────────────┘
        │ tRPC + WS (127.0.0.1, loopback only)    │ endpoint protocol gen 1
        │                                         │ (shell.snapshot.v1,
        v                                         │  shell.surface.v1,
┌────────────────────────────────────┐            │  shell.input.semantic.v1)
│  Osade daemon (packages/daemon)    │            │
│  Node >= 22, long-lived            │            │
│                                    │            │
│  http/trpc/ws  ─ contract-typed    │            │
│  domain/       ─ tasks, lifecycle, │            │
│                  gates, verify     │            │
│  scm/          ─ GitHub facts      │            │
│  knowledge/    ─ conventions,      │            │
│                  memory, embeddings│            │
│  herdr/        ─ THE ONLY caller   │            │
│  db/           ─ sqlite + change_log + CDC      │
└───────┬────────────────────────────┘            │
        │ JSON API (herdr.sock)                   │
        v                                         v
┌──────────────────────────────────────────────────────────────────────────────┐
│  herdr server  (vendored binary, headless)                                    │
│    owns: AppState, PTYs, panes, tabs, worktrees, detection, hooks, persist    │
│    sockets: herdr.sock (JSON API)   herdr-client.sock (private bincode)       │
└──────────────────────────────────────────────────────────────────────────────┘
```

**DECISION — why a separate daemon rather than putting domain logic in Electron main.**
Agents must survive the app quitting; so must GitHub polling, verification runs, and the
conventions miner. herdr already survives client detach; the daemon must too, or half the
system dies when the user closes a window. It also gives us the `osade` CLI for free, which
is what agents use to coordinate (§17).

**DECISION — why the renderer talks to herdr directly for surfaces.**
Proxying terminal cell frames through the daemon would create a second event path and add a
hop to the hottest loop in the system. The renderer holds two connections: domain state from
the daemon, cell surfaces from herdr.

**DECISION — why a UtilityProcess for the herdr transport.**
Renderer cannot open unix sockets under `contextIsolation`. Routing frames through the main
process would put a 60fps stream behind the main IPC queue, which also serves menus and
dialogs. An Electron `utilityProcess` opens the socket, decodes frames, and is handed a
`MessageChannelMain` port straight to the renderer.

### 2.1 Network posture — INVARIANT

- Daemon binds `127.0.0.1` only. No `0.0.0.0` listener in v1.
- herdr sockets are unix domain sockets, mode `0600`.
- No unauthenticated route reachable off-loopback. There is no remote mode in v1.
- The daemon never holds a GitHub token in its config file. Tokens live in Electron
  `safeStorage` and are passed to the daemon at spawn over an fd/env handshake, held in memory
  only.

### 2.2 State containment — INVARIANT

Everything Osade writes lives under `~/.osade/`. Including Electron's `userData` — call
`app.setPath('userData', ~/.osade/electron)` before `app.whenReady()`. No
`~/Library/Application Support`, no `%APPDATA%`, ever. The whole system must be resettable
with `rm -rf ~/.osade`.

herdr keeps its own `~/.config/herdr/` — that is herdr's business, not ours. We point it at a
named session (`osade`) so we never collide with a user's own herdr session.

```text
~/.osade/
├── osade.db                     sqlite (schema, change_log, memory, vectors)
├── osade.sock                   daemon control socket (CLI + hooks)
├── config.json                  non-secret prefs
├── electron/                    Electron userData
├── logs/<date>.log
├── runs/<run_id>/               verification stdout/stderr, capped + rotated
├── review/<review_id>/          reviewer gateway neutral home (§16)
└── skills/                      agent-facing skill assets installed at boot (§17)
```

---

## 3. Naming — read this before writing any type

herdr and Osade both use the word "workspace" for different things. This will cause bugs.

| Osade term | Definition | herdr equivalent |
| --- | --- | --- |
| `Org` | A GitHub org or a user-defined grouping of repos | none |
| `Repo` | One git repository on disk + its GitHub remote | none |
| `Task` | One unit of work. 1:1 with a worktree and a herdr workspace | `Workspace` |
| `Lane` | A role inside a task: `agent` / `verify` / `shell` / `review` | `Tab` |
| `Process` | A running program in a lane | `Pane` |

**Rule:** Osade code never says "workspace" unqualified. It says `Task` for its own concept and
`herdrWorkspaceId` when referring to herdr's. The typed herdr client (§4.1) is the only place
herdr's vocabulary appears.

---

## 4. Integration contract with herdr

### 4.1 Generate the client, do not hand-write it — INVARIANT

herdr publishes a JSON Schema for its API at `docs/next/api/herdr-api.schema.json`, generated
via `schemars`.

**Milestone 0, task 1:** vendor that schema and generate a typed TypeScript client from it
(`json-schema-to-typescript` or `quicktype`) into `packages/daemon/src/herdr/generated/`.
Commit the generated output and the source schema together with the herdr version string.

Do **not** hand-write method names from memory or from this document. This document names a few
methods and events illustratively (`Ping`, `PaneSplit`, `AgentPrompt`, `PaneAgentStatusChanged`,
`WorkspaceFocused`, `PaneOutputMatched`, `HookStateReported`, `HookMetadataReported`,
`AgentSessionReported`); the schema is the truth, and it has roughly 100 methods. If a method
this spec assumes does not exist in the schema, stop and report it rather than approximating.

Add a startup guard: the daemon reads herdr's version, compares against the pinned version the
client was generated from, and refuses to start on a mismatch with an actionable message.

### 4.2 Which socket for what

| Need | Transport | Notes |
| --- | --- | --- |
| Create/destroy worktrees, spawn agents, send prompts, query state | `herdr.sock` JSON API | daemon only |
| Subscribe to agent status, hook reports, git status | `herdr.sock` EventHub subscription | daemon only |
| Terminal cell content, semantic input | endpoint protocol, generation 1 | renderer utility process only |
| Anything else | — | there is nothing else |

**INVARIANT:** `packages/daemon/src/herdr/**` is the only directory permitted to import the
generated herdr client or open `herdr.sock`. Enforced by lint (§20).

### 4.3 The endpoint protocol — treat generation 1 as a floor

herdr's `src/protocol/endpoint.rs` defines a separately versioned JSON handshake for
client-owned shells, deliberately independent of the private same-install bincode protocol,
because those clients may be a different build. Osade's Electron app is exactly that case: it
updates on its own cadence.

Codecs are immutable: `shell.snapshot.v1`, `shell.surface.v1`, `shell.input.semantic.v1`,
`shell.blob.v1`. New server capabilities arrive as *advertised methods* — a missing method
disables one action, never the whole connection. Write the transport to degrade that way.

### 4.4 Rendering terminal surfaces — DECISION

The renderer consumes `PaneSurfaceFrame` / `PaneSurfacePatch` (already-parsed cell grids from
herdr's vendored libghostty-vt) and draws them itself. **We do not use xterm.js.**

Rationale: herdr has already parsed the bytes with Ghostty's terminal core. Feeding raw bytes
to xterm.js would mean parsing twice, would need a new herdr API method to stream raw output,
and would desync herdr's agent detection from what we display.

Renderer requirements:
- Canvas 2D grid renderer, one draw per animation frame, patches applied to a local cell buffer.
- Damage tracking: only redraw changed cell rectangles.
- Must handle: styled cells (fg/bg/bold/italic/underline/inverse), wide (CJK) cells, cursor
  shape and visibility, selection highlight.
- Kitty graphics and image protocols: **out of scope for v1**, render a placeholder block.
- Target: 15 concurrently visible panes at 60fps on a 2021 laptop. Benchmark it; herdr's own
  rule is that these paths are multiplicative.

Fallback if this proves too slow before M1 ships: negotiate `TerminalAnsi` for a single focused
pane and pipe to xterm.js. Record the decision if you take it.

### 4.5 Do not violate herdr's own invariants

Osade is a client. herdr's `AGENTS.md` rules bind our integration:

- Presentation state (our ledger layout, colors, selection) is **ours**, never pushed into
  herdr's state or API.
- If we need a new shared runtime fact, it goes in herdr's server state and JSON API with a
  neutral name — never a UI name like `card`, `row`, `column`.
- Never add behavior reachable only through the private bincode socket.

---

## 5. Data model

SQLite via `better-sqlite3`. Migrations are numbered, forward-only, applied at daemon boot.
Vector search via `sqlite-vec`.

### 5.1 Core tables

```sql
-- ── identity ─────────────────────────────────────────────────────────────────
CREATE TABLE org (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  gh_login      TEXT,                      -- null for ad-hoc groupings
  created_at    INTEGER NOT NULL
);

CREATE TABLE repo (
  id            TEXT PRIMARY KEY,
  org_id        TEXT REFERENCES org(id),
  path          TEXT NOT NULL UNIQUE,      -- absolute, canonical
  gh_owner      TEXT,
  gh_name       TEXT,
  default_branch TEXT NOT NULL,
  upstream_remote TEXT,                    -- 'upstream' for forks, else 'origin'
  fork_of       TEXT,                      -- owner/name if this is a fork
  created_at    INTEGER NOT NULL
);

CREATE TABLE task (
  id            TEXT PRIMARY KEY,
  repo_id       TEXT NOT NULL REFERENCES repo(id),
  title         TEXT NOT NULL,
  intent        TEXT NOT NULL,             -- the prompt / issue body given to the agent
  origin_kind   TEXT NOT NULL,             -- 'issue' | 'manual' | 'triage' | 'followup'
  origin_ref    TEXT,                      -- issue url when origin_kind='issue'
  agent_id      TEXT,                      -- per-task override; null = repo default
  base_ref      TEXT NOT NULL,             -- branch name resolved at creation
  base_sha      TEXT NOT NULL,             -- pinned commit
  branch        TEXT NOT NULL,             -- osade/<slug>-<shortid>
  worktree_path TEXT NOT NULL,
  herdr_workspace_id TEXT,                 -- null until adopted
  archived_at   INTEGER,
  created_at    INTEGER NOT NULL
);
```

### 5.2 Facts — INVARIANT: these are the only durable truth

**Nothing display-shaped is ever stored.** There is no `status` column on `task`. Status is a
pure function over the rows below, recomputed at read time (§6). This is AO's central invariant
and the single most important rule in this document.

```sql
-- last known agent activity, written by the herdr event subscriber
CREATE TABLE agent_fact (
  task_id       TEXT PRIMARY KEY REFERENCES task(id),
  herdr_state   TEXT,                      -- working|blocked|done|idle|unknown
  last_event    TEXT,                      -- to_in_progress|to_review|activity
  last_event_at INTEGER,
  activity_text TEXT,                      -- "Editing src/foo.ts" — for display only
  tool_name     TEXT,
  final_message TEXT,
  pane_alive    INTEGER NOT NULL DEFAULT 0,
  last_probe_at INTEGER,
  probe_failures INTEGER NOT NULL DEFAULT 0,
  terminated    INTEGER NOT NULL DEFAULT 0,   -- explicit, not inferred
  controller_generation INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE verify_run (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL REFERENCES task(id),
  step_name     TEXT NOT NULL,
  cmd           TEXT NOT NULL,
  started_at    INTEGER NOT NULL,
  finished_at   INTEGER,
  exit_code     INTEGER,
  required      INTEGER NOT NULL,
  head_sha      TEXT NOT NULL,             -- what was verified
  log_path      TEXT NOT NULL
);

CREATE TABLE gate_request (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL REFERENCES task(id),
  gate          TEXT NOT NULL,             -- see §14
  payload_json  TEXT NOT NULL,             -- exact action to perform if approved
  payload_hash  TEXT NOT NULL,             -- sha256, must match at execution time
  requested_at  INTEGER NOT NULL,
  decided_at    INTEGER,
  decision      TEXT,                      -- 'approve' | 'deny' | 'expired'
  decided_by    TEXT,                      -- 'human' | 'policy:<name>'
  executed_at   INTEGER,
  execution_error TEXT
);

CREATE TABLE scm_fact (
  task_id       TEXT PRIMARY KEY REFERENCES task(id),
  pr_number     INTEGER,
  pr_url        TEXT,
  pr_state      TEXT,                      -- open|closed|merged
  pr_head_sha   TEXT,
  pr_draft      INTEGER,
  checks_state  TEXT,                      -- pending|success|failure|neutral
  review_state  TEXT,                      -- none|commented|changes_requested|approved
  unresolved_threads INTEGER NOT NULL DEFAULT 0,
  mergeable     TEXT,                      -- clean|dirty|blocked|unknown
  fetched_at    INTEGER NOT NULL,
  fetch_failed_at INTEGER                  -- a failed poll is a fact, not a state change
);

CREATE TABLE turn_checkpoint (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL REFERENCES task(id),
  ref_name      TEXT NOT NULL,             -- refs/osade/turns/<task>/<n>
  sha           TEXT NOT NULL,
  captured_at   INTEGER NOT NULL,
  trigger       TEXT NOT NULL              -- 'launch'|'to_review'|'to_in_progress'|'manual'
);
```

**INVARIANT — a failed probe is a fact, not a death certificate.** `probe_failures` and
`fetch_failed_at` are recorded; they never by themselves mark a task terminated. `terminated`
is set only by an explicit process-exit event or an explicit user action. This is the specific
bug AO calls out: a flaky liveness check killing a live agent.

### 5.3 Knowledge tables

```sql
CREATE TABLE convention (
  id            TEXT PRIMARY KEY,
  repo_id       TEXT NOT NULL REFERENCES repo(id),
  category      TEXT NOT NULL,             -- see §15.2
  rule_text     TEXT NOT NULL,             -- imperative, one sentence
  rationale     TEXT,
  confidence    REAL NOT NULL,             -- 0..1
  status        TEXT NOT NULL,             -- 'candidate'|'active'|'retired'|'rejected'
  mined_at      INTEGER NOT NULL,
  last_confirmed_at INTEGER,
  retired_reason TEXT
);

-- INVARIANT: a convention with zero evidence rows is not a convention. Reject at write time.
CREATE TABLE convention_evidence (
  id            TEXT PRIMARY KEY,
  convention_id TEXT NOT NULL REFERENCES convention(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,             -- 'merged_pr'|'rejected_pr'|'review_comment'|'doc'|'ci_config'
  url           TEXT NOT NULL,
  excerpt       TEXT,                      -- <= 200 chars, for the UI
  observed_at   INTEGER NOT NULL
);

CREATE TABLE memory (
  id            TEXT PRIMARY KEY,
  scope         TEXT NOT NULL,             -- 'personal'|'org'|'repo'|'task'|'agent'
  scope_id      TEXT,                      -- null for personal
  kind          TEXT NOT NULL,             -- 'fact'|'howto'|'failure'|'preference'
  text          TEXT NOT NULL,
  source_task_id TEXT REFERENCES task(id),
  source_agent  TEXT,
  verified_by   TEXT REFERENCES verify_run(id),   -- null = unverified
  confidence    REAL NOT NULL,
  ecosystem_tag TEXT,                      -- 'pnpm'|'cargo'|'uv'|... enables cross-repo transfer
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER,
  superseded_by TEXT REFERENCES memory(id)
);

CREATE VIRTUAL TABLE memory_vec USING vec0(
  memory_id TEXT PRIMARY KEY,
  embedding FLOAT[768]
);
```

### 5.4 Change data capture — INVARIANT: one event path

Every table above gets `AFTER INSERT/UPDATE/DELETE` triggers writing a row into `change_log`.
A poller tails it with a watermark, decodes into typed events, and fans them to WS subscribers.

```sql
CREATE TABLE change_log (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  row_id     TEXT NOT NULL,
  op         TEXT NOT NULL,
  at         INTEGER NOT NULL
);
```

There is **no second event path**. No service emits a WS message directly. If the UI did not
update, the mutation did not go through the database, and that is the bug. Clients get a
`snapshot` on connect and a discriminated union of pushes after; the client never polls.

Retain the last 50k rows; prune on a timer.

### 5.5 The contract package — INVARIANT

`packages/contract/` holds Zod schemas for **everything crossing a process boundary**: daemon↔
renderer, daemon↔CLI, daemon↔hook subprocess. tRPC procedures declare `.output(schema)`, so
renderer types are derived and never hand-written. Nothing crosses a boundary untyped.

Optimistic concurrency: any client-initiated mutation of a mutable aggregate carries
`expectedRevision`; a mismatch returns a typed conflict, never a silent overwrite.

---

## 6. Derived status — the core invariant

**INVARIANT: status is a pure function over facts, recomputed on every read. It is never
stored, never cached in the database, and never sent from the client.**

```ts
// packages/daemon/src/domain/derive-status.ts
// Pure. No I/O. No clock reads except the injected `now`. Fully unit-testable.
export function deriveStatus(f: TaskFacts, now: number): TaskStatus
```

Evaluate in order; first match wins. Order matters and is deliberate.

| # | Condition | Status | UI meaning |
| --- | --- | --- | --- |
| 1 | `scm.pr_state === 'merged'` | `merged` | Done. Archive candidate. |
| 2 | `task.archived_at != null` | `archived` | Hidden by default |
| 3 | An undecided `gate_request` exists | `awaiting_approval` | **Needs you.** Top of ledger. |
| 4 | `agent.herdr_state === 'blocked'` | `needs_input` | **Needs you.** |
| 5 | `scm.review_state === 'changes_requested'` or `unresolved_threads > 0` | `review_changes_requested` | **Needs you or the agent.** |
| 6 | `scm.checks_state === 'failure'` | `ci_failed` | |
| 7 | Latest required `verify_run` for current head has `exit_code != 0` | `verify_failed` | |
| 8 | A `verify_run` is open (`finished_at == null`) | `verifying` | |
| 9 | `scm.pr_state === 'open'` | `pr_open` | |
| 10 | `agent.last_event === 'to_review'` and no newer `to_in_progress` | `awaiting_review` | **Needs you.** |
| 11 | `agent.herdr_state === 'working'` | `implementing` | |
| 12 | `agent.terminated === 1` | `stopped` | |
| 13 | `agent.pane_alive === 0` and no herdr workspace | `queued` | |
| 14 | otherwise | `idle` | |

Notes that will otherwise be got wrong:

- Rows 3–5 and 10 form the **needs-you set**. The ledger sorts on it. That set is the entire
  product for a user running eight agents.
- `verify_failed` is scoped to `head_sha`. A verify failure against an older commit is stale
  and does not gate.
- `probe_failures > 0` appears nowhere in this table. It surfaces as a small degraded-confidence
  badge in the UI, and nothing else.
- Never write a helper that persists the result of `deriveStatus`. If you find yourself wanting
  to index on status, index on the underlying facts instead.

### 6.1 The narrow event vocabulary — INVARIANT

Exactly three internal agent events, borrowed from Kanban because the discipline is correct:

```
to_in_progress   |   to_review   |   activity
```

Every agent's richer event vocabulary is mapped down to these by its adapter. `activity` is
**never** a transition; it only updates `activity_text` / `tool_name`. Adding a fourth event
requires changing this document first.

The transition reducer is pure, in `packages/daemon/src/domain/agent-reducer.ts`, and takes
`(facts, event) -> factPatch`. No I/O in it.

---

## 7. Where agent state actually comes from

**Do not build a parallel hook system.** herdr already installs per-agent hook scripts
(`src/integration/assets/<agent>/`) for Claude Code, Codex, pi, opencode, Kimi and others,
which report authoritative state back through its JSON API as `HookStateReported`,
`HookMetadataReported`, and `AgentSessionReported`. Panes identify themselves via
`HERDR_PANE_ID` / `HERDR_TAB_ID` / `HERDR_WORKSPACE_ID`, injected at spawn.

Osade's subscriber (`packages/daemon/src/herdr/event-subscriber.ts`) subscribes to the herdr
EventHub and maps:

| herdr event | Osade fact write |
| --- | --- |
| `PaneAgentStatusChanged` → `working` | `herdr_state='working'`, event `to_in_progress` |
| `PaneAgentStatusChanged` → `blocked` | `herdr_state='blocked'` (drives `needs_input`) |
| `PaneAgentStatusChanged` → `done`/`idle` | `herdr_state=...`, event `to_review` |
| `HookMetadataReported` | `activity_text`, `tool_name`, `final_message` — event `activity` |
| `AgentSessionReported` | agent session id binding, for resume |
| `PaneDied` / process exit | `pane_alive=0`; `terminated=1` only on explicit exit |
| `GitStatusRefreshed` | triggers a diff-stat refresh for the task |

**If a needed signal is missing from herdr,** extend herdr properly: a new declarative rule in
`distribution/agent-detection/*.toml` (versioned, remotely updatable) or a new `Method`/event in
`src/api/schema/`. Do not screen-scrape terminal output from Osade. herdr's detector already
reads the bottom buffer rather than the visible viewport (users scroll) and debounces
working→idle across 3 confirmations over 700ms so a momentarily quiet agent does not flicker.
Reimplementing that badly is a guaranteed source of flapping cards.

---

## 8. Agent catalog and launch

### 8.1 The catalog

Declarative table, `packages/daemon/src/domain/agent-catalog.ts`, modeled on Kanban's:

```ts
interface AgentCatalogEntry {
  id: AgentId;                    // 'claude' | 'codex' | 'gemini' | 'opencode' | 'droid' | 'kiro' | ...
  binary: string;
  baseArgs: string[];
  autonomousArgs: string[];
  planArgs: string[];
  resumeArgs: string[];
  systemPromptFlag: SystemPromptStyle;   // how conventions get injected (§15.4)
  capabilities: AgentCapability[];
  env: Record<string, string>;
}
```

Known shapes to seed from (verify each against the installed binary before shipping it as
supported — flags change):

| id | binary | autonomous | plan | resume | system prompt |
| --- | --- | --- | --- | --- | --- |
| `claude` | `claude` | `--permission-mode auto` | `--permission-mode plan` | `--continue` | `--append-system-prompt` |
| `codex` | `codex` | `--dangerously-bypass-approvals-and-sandbox` | deferred `/plan` input | `resume --last` | `-c developer_instructions=` |
| `droid` | `droid` | `--auto high` | `autonomyMode: spec` | `--resume` | `--append-system-prompt` |
| `kiro` | `kiro-cli chat` | `--trust-all-tools` | — | `--resume` | agent config file |
| `gemini` | `gemini` | `--yolo` | — | — | varies |
| `opencode` | `opencode` | — | — | — | plugin file |

**INVARIANT — capabilities, not identity checks.** Branch on
`entry.capabilities.includes('plan-mode')`, never on `agentId === 'claude'`. AO's model:
harnesses opt into behavior they can prove they support, rather than being flattened to a
lowest common denominator. Capability list for v1:

```
'plan-mode' | 'resume' | 'system-prompt-injection' | 'hook-reporting'
| 'structured-review-output' | 'headless-run'
```

An agent without `hook-reporting` still works — it just relies on herdr's screen-manifest
detection and gets a lower-confidence badge in the UI.

**PATH matters.** Probe binaries with direct PATH checks and spawn directly. Never shell out to
`zsh -i` to find a binary: with heavy conda/nvm init that freezes the runtime when several
tasks start at once. This bit Kanban; do not rediscover it.

### 8.2 Launch sequence

`packages/daemon/src/domain/launch-task.ts`:

1. Resolve agent: `task.agent_id ?? repo.default_agent ?? config.selected_agent`. On resume,
   the previously used agent wins so a restored task comes back on the same runtime.
2. Ensure worktree (§9).
3. Ask herdr to create a workspace rooted at the worktree path; record `herdr_workspace_id`.
4. Create lanes (herdr tabs): `agent`, `shell`. `verify` is created on first verification run.
5. Render the launch context (§15.4) to `<worktree>/.osade/CONTEXT.md`.
6. Build argv from the catalog entry + selected mode + system-prompt injection.
7. Spawn in the `agent` lane via the herdr JSON API.
8. Capture a `turn_checkpoint` with trigger `launch`. Best-effort — **a checkpoint capture
   failure never fails a launch.**

### 8.3 First-run trust prompts

Claude and Codex show a "do you trust this folder?" prompt, and Osade's cwd is a freshly created
worktree every single time, so this fires constantly. herdr's `PaneOutputMatched` event plus a
detection manifest rule is the right place to catch it. Auto-confirm on a short delay, then
clear the match buffer so stale trust text cannot re-match later heuristics.

If herdr's manifest can't express the match, add a rule to
`distribution/agent-detection/*.toml` upstream rather than adding output scanning to Osade.

---

## 9. Worktrees

herdr already makes git worktrees first-class workspace containers, with creation, opening and
removal guarded against active agent panes (`src/worktree.rs`, `src/workspace/git/`). **Osade
calls herdr for worktree lifecycle. It does not shell out to `git worktree` itself.**

What Osade owns is the *policy*, and these rules are hard-won — they come from Kanban destroying
user work by getting them wrong:

1. **An existing worktree is authoritative.** Never compare worktree HEAD against a moved base
   branch and recreate. That destroys task progress. Only create *missing* worktrees.
2. Creation is serialized by a repo-level lock, with a double-check inside the lock.
3. Run `git worktree prune` before `add`: an interrupted removal leaves a registration behind
   and `add` then fails with "missing but already registered."
4. Create `--detach` at the resolved base commit (`task.base_sha`), then create the branch. A
   pinned base means a moving `main` cannot silently change what an agent is building against.
5. **Mirror gitignored-but-needed paths** into the worktree: `.env`, `.env.local`, local tool
   configs, and anything in `repo.mirror_paths`. Symlink where possible, copy where the tool
   resolves symlinks. Without this, half of real repos won't even boot in a worktree.
6. Removal requires: no live pane in the task's herdr workspace, no uncommitted changes, or an
   explicit force with a typed confirmation.

Path layout: `~/.osade/worktrees/<repo_slug>/<task_id>/`.

### 9.1 Turn checkpoints and undo

Capture a git ref snapshot on each launch and each `to_review`/`to_in_progress` transition,
stored as `turn_checkpoint` rows. `refs/osade/turns/<task_id>/<n>`.

"Undo this turn" resets the worktree to the previous checkpoint. It must:
- refuse while a pane is live in the task (stop the agent first),
- stash-and-label rather than discard uncommitted work,
- be its own gate (`gate.undo_turn`) when the diff is larger than N files.

All checkpoint capture is best-effort and never blocks the agent.

---

## 10. Verification

The point of verification is to make an agent's claim checkable **before** it costs a maintainer
anything. This is the largest single lever on the design goal in §0.1.

### 10.1 Deriving the plan

`packages/daemon/src/domain/verify-plan.ts` builds a `VerifyPlan` per repo from evidence, not
guesses:

- CI config: `.github/workflows/*.yml`, `.gitlab-ci.yml`, `justfile`, `Makefile`, `taskfile.yml`
- Package manifests: `package.json` scripts, `Cargo.toml`, `pyproject.toml`, `go.mod`
- Repo docs: `CONTRIBUTING.md` sections mentioning tests/lint

```ts
interface VerifyStep {
  name: string; cmd: string; cwd: string;
  timeoutSec: number; required: boolean;
  source: 'ci' | 'manifest' | 'doc' | 'user';   // provenance, shown in UI
}
```

The plan is **shown to the user and editable** before first use, stored per repo. Never run an
inferred command silently the first time.

### 10.2 Running

Runs execute in the task worktree, in the `verify` lane (a herdr tab), so the user can watch and
interrupt. One `verify_run` row per step. stdout/stderr to `~/.osade/runs/<run_id>/`, capped at
2 MiB with head+tail retention.

On failure: the tail of the log plus the failing command is sent back into the agent lane as a
prompt. That closed loop — *agent acts, environment answers, agent adapts* — is the thing the
whole product is organized around, and it should be the demo.

Verification is required before `gate.pr_open` can be approved. That is a policy default, and
it is overridable per repo, but the override is recorded.

---

## 11. GitHub integration

`packages/daemon/src/scm/`. Octokit. **This is the only directory permitted to import an SCM
SDK** (lint-enforced).

### 11.1 Reads — polling, not webhooks

v1 is local-first with no public ingress, so there is no webhook endpoint. Poll:

| Data | Interval | Notes |
| --- | --- | --- |
| PR state, checks, reviews for tasks with an open PR | 30s | matches AO's scm observer cadence |
| Issue list for watched repos | 5 min | |
| Rate limit headers | every response | back off at <20% remaining |

Conditional requests with ETags. A failed poll writes `fetch_failed_at` and changes nothing
else — **INVARIANT: a failed fetch is a fact, not a state change.**

### 11.2 Writes — all gated

Every write is a `gate_request` first. The payload is hashed at request time and re-hashed at
execution time; a mismatch aborts. This prevents a "approve this comment" decision from being
executed against different text.

Gated write actions: `pr_open`, `pr_update`, `pr_comment`, `issue_comment`, `review_submit`,
`push`, `force_push`, `branch_delete`.

### 11.3 Fork awareness

Most OSS contribution goes through a fork. `repo.fork_of` and `repo.upstream_remote` exist for
this. On PR open: push to the fork's remote, open the PR against `upstream:default_branch`.
If the user has no fork, offer to create one behind a gate. Never push to an upstream you do
not own — check permissions before offering the action, not after.

---

## 12. Issue intake and triage

Import an issue → create a task. But the higher-value path, and the one that earns maintainer
trust, is triage that produces **no PR at all**:

- reproduce the reported bug in a clean worktree and report whether it reproduces
- bisect a regression to a commit
- write a failing test that demonstrates the bug
- check whether the issue duplicates an existing one
- verify that a *human's* PR does what its description claims

These are `origin_kind='triage'` tasks. They terminate in an artifact (a reproduction log, a
bisect result, a failing test patch) rather than a PR. Ship this in M2 alongside the PR path,
because it is the wedge: a maintainer will accept a bot that saves them 40 minutes of triage
long before they accept a bot that adds a PR to their queue.

---

## 13. Repository skills — the conventions miner

This is Osade's actual novelty. Everything else is assembly.

### 13.1 The thesis

What gets a PR merged is not code correctness, it is conformance to a project's tacit rules.
Those rules exist in the record — in review comments, in what got rejected, in the difference
between what was submitted and what was merged. Nobody treats that record as a mineable,
citable artifact.

**INVARIANT: a rule without evidence is not a rule.** Every `convention` row must have at least
one `convention_evidence` row pointing at a real URL. Reject unciteable rules at write time.
This is what makes the output auditable rather than another pile of model-generated guidance.

### 13.2 Inputs, weighted by signal

| Source | Weight | Why |
| --- | --- | --- |
| **Closed-unmerged PRs** | highest | Rejection is the strongest signal and everyone ignores it |
| **`changes_requested` review threads** | highest | Explicit statements of what was wrong |
| Diff between PR head and merge commit | high | What maintainers silently fixed |
| Merged PR review comments | medium | Style nudges, conventions in passing |
| `CONTRIBUTING.md`, `AGENTS.md`, `CODEOWNERS`, issue/PR templates | medium | Stated rules — often stale, so mark provenance |
| CI config | high | Mechanically enforced, so it is definitionally true |

Default sample: last 200 merged PRs, last 100 closed-unmerged, capped by rate limit budget.

### 13.3 Categories

```
review_process    — when to open a draft, when an RFC/issue is required first
scope_limits      — "one concern per PR", "no drive-by refactors"
commit_style      — conventional commits, sign-off, message format
test_requirements — what must have a test, where tests live
file_ownership    — areas that need a specific reviewer or are effectively frozen
communication     — comment on the issue before implementing, how to ask
ci_gates          — what must be green
```

### 13.4 The mining pipeline

Three bounded passes. Each is a separate model call with a narrow job — do not build one
mega-prompt.

1. **Extract.** Per PR/thread, emit candidate observations with quotes and URLs. No
   generalization at this stage.
2. **Cluster.** Group observations into candidate rules. A rule needs ≥3 supporting
   observations from ≥2 distinct PRs, or ≥1 observation from a CI config or CODEOWNERS.
3. **Verify.** Test each candidate against a held-out sample of merged PRs. If the rule
   predicts what happened, `confidence` goes up; if merged PRs routinely violate it, mark
   `rejected`. Store the confidence.

Rules land as `status='candidate'`. Promotion to `active` requires either confidence ≥ 0.8 or
one-click human confirmation in the UI. Show the evidence next to the toggle.

**Re-mine incrementally.** Weekly, or on demand, mining only PRs newer than
`last_confirmed_at`. Conventions decay: an `active` rule not re-confirmed in 180 days drops to
`candidate`.

### 13.5 Injection

Render active conventions into `<worktree>/.osade/CONTEXT.md` at launch:

```markdown
# Contributing to <repo>

## Rules this project enforces
- <rule_text>
  <sub>evidence: PR #1234 (rejected), PR #1290 (changes requested)</sub>
...

## Verification you must pass before this is reviewable
- <verify steps>

## What you are working on
- <task.intent>
- base: <base_sha> on <base_ref>
```

Injected per the agent's `systemPromptFlag`. For agents without system-prompt injection, the
file is written and referenced in the opening prompt.

**Keep it short.** Cap at 40 active rules and ~2000 tokens. A 200-rule context file is
worse than none — it dilutes attention and every rule competes with the actual task. If more
than 40 rules are active, rank by confidence × recency and surface the overflow in the UI
rather than the prompt.

### 13.6 The measurable claim

This feature exists to move one number: **review rounds to merge.** Instrument it from day one.
`scm_fact` already carries enough to compute it. The M3 acceptance criterion is a real
comparison on real tasks, not a vibe.

---

## 14. Approval gates

The mechanism behind "safe autonomous contribution." Without this the product is a liability.

### 14.1 The gate list

| Gate | Default | Notes |
| --- | --- | --- |
| `gate.commit` | auto | local only, reversible via checkpoint |
| `gate.push` | **human** | first write that leaves the machine |
| `gate.pr_open` | **human** | requires passing verification |
| `gate.pr_comment` | **human** | public speech |
| `gate.issue_comment` | **human** | public speech |
| `gate.review_submit` | **human** | public speech about someone else's work |
| `gate.force_push` | **human** | always, no policy override |
| `gate.branch_delete` | **human** | |
| `gate.dep_add` | **human** | supply chain |
| `gate.file_write_outside_worktree` | **human** | should never happen; if it fires, investigate |
| `gate.undo_turn` | conditional | human if diff > 20 files |
| `gate.network_egress` | auto, logged | v1 logs only; enforcement is M5 |

**INVARIANT: anything that writes to a public GitHub surface defaults to human approval.**
A policy may downgrade a gate, and that downgrade is itself recorded in `decided_by` as
`policy:<name>` so the audit trail never loses who decided.

### 14.2 UX

Gate requests are the top of the ledger, above everything else. A gate card shows: the exact
action, a rendered diff or the exact comment text, which task it came from, the verification
state, and Approve / Deny / Edit-and-approve. Editing rewrites the payload and re-hashes.

Batch approval is allowed for `gate.commit` only. Never batch a public write.

Gates expire after 24h into `decision='expired'`. An expired gate is not a denial and can be
re-requested.

---

## 15. Layered memory

Five scopes, per the product brief: `personal`, `org`, `repo`, `task`, `agent`.

### 15.1 The write gate — INVARIANT

**Only entries with `verified_by != null` may be written above `task` scope.**

Unverified discoveries stay task-local and die with the task. A claim gets promoted to repo or
org scope only when a `verify_run` confirmed it empirically. Without this rule, one agent's
wrong guess becomes every future agent's ground truth, and the shared memory becomes a
poisoning vector rather than an asset. This is the single most likely way for the "shared agent
memory" feature to make the product actively worse.

### 15.2 Cross-repo transfer — INVARIANT

**Conventions never transfer across repos.** What is true for repo A is false for repo B, and
bleeding them is a bug, not a feature.

What *does* transfer is ecosystem-level operational knowledge, and only when tagged:

```
transferable:     kind='howto' AND ecosystem_tag IS NOT NULL
                  e.g. "under pnpm workspaces, run tests with --filter to avoid the full graph"
not transferable: kind='fact' scoped to a repo; anything from the convention table
```

Retrieval query: cosine over `memory_vec`, filtered to
`(scope='task' AND scope_id=<task>) OR (scope='repo' AND scope_id=<repo>) OR (scope='org' AND
scope_id=<org>) OR scope='personal' OR (ecosystem_tag IN <repo ecosystems>)`, with recency
decay and a hard cap of 12 entries injected.

### 15.3 Provenance and expiry

Every entry keeps `source_task_id`, `source_agent`, and `created_at`. Entries about tooling get
a 90-day `expires_at` by default. Superseding writes set `superseded_by` rather than deleting,
so the audit trail survives.

The UI must let the user read and delete any memory entry, filtered by scope. A shared memory
you cannot inspect is a shared memory you cannot trust.

---

## 16. The reviewer gateway

Adapted from AO's `reviewgateway` / ADR 0002, which is a genuine capability-confinement design
rather than "run an agent with a review prompt."

When a reviewer agent runs, it gets:

- **A neutral filesystem.** Osade-owned `HOME`, config, cache, and temp roots under
  `~/.osade/review/<review_id>/`. Not the user's dotfiles.
- **No credentials.** No GitHub token, no push remote, no SSH agent forwarding.
- **An immutable, hash-verified manifest** listing exactly what it may review:

```json
{
  "review_id": "...",
  "pr_url": "https://github.com/o/r/pull/1234",
  "head_sha": "...",
  "base_sha": "...",
  "changed_files": ["src/a.ts", "src/b.ts"],
  "manifest_sha256": "..."
}
```

- **The source checkout is deliberately absent from its working directory.** It reviews a
  detached checkout of `head_sha` plus the diff, nothing else.
- **Output is a structured artifact, never a GitHub write.** Posting it is `gate.review_submit`.

Trigger policy, following AO's autoreview: on an idle threshold after a task reaches
`awaiting_review`, with bounded retries per PR head sha, so a churning PR does not spawn
unbounded reviews.

---

## 17. Multi-agent coordination — self-hosting, not a new protocol

**DECISION: agents coordinate by driving the `osade` CLI, exactly as a human would. We do not
build an agent-to-agent protocol.**

This is AO's best structural idea and it fits herdr perfectly, since herdr already has a full
one-shot CLI (`herdr pane/agent/tab/...`) that talks to the same JSON API.

Mechanism:

1. `packages/cli` provides `osade` verbs: `task list`, `task create`, `task show`,
   `task send`, `verify run`, `gate request`, `memory write`, `conventions show`,
   `review request`.
2. The daemon embeds a **skill asset** describing those verbs and installs it to
   `~/.osade/skills/using-osade/` at boot, so any agent in any worktree has a stable absolute
   path to the catalog. Mirrors herdr's own `skillassets` approach.
3. An **orchestrator agent** gets a repo-scoped persistent session with no worktree of its own,
   and delegates by calling the same commands a user would.
4. Every CLI call from an agent carries `OSADE_TASK_ID` from its environment, so writes are
   attributed and scoped automatically.

Consequences worth stating: the orchestrator has no privileged path. It cannot bypass a gate,
because gates live in the daemon, not in the caller. Anything an orchestrator can do, a human
can do from a terminal, and vice versa. That symmetry is the point.

**Home lane.** Kanban's synthetic-id trick is worth stealing: a sidebar agent with no task and
no worktree, running at the repo root, reusing the entire session stack. Use a synthetic id
`__orchestrator__:<repo_id>`, define it in exactly one place, and lint against the raw literal
appearing anywhere else.

---

## 18. The Electron app

### 18.1 Process structure

```
apps/desktop/src/
├── main/
│   ├── electron.ts            entry. userData redirect FIRST, then app.whenReady()
│   ├── supervisor/
│   │   ├── herdr.ts           locate/spawn/adopt the herdr server, health, version guard
│   │   ├── daemon.ts          spawn packages/daemon as a child, port handshake, restart policy
│   │   └── shutdown.ts        graceful: detach, never kill agents on quit
│   ├── secrets.ts             safeStorage: GitHub token, model API keys
│   ├── oauth.ts               GitHub device flow / OAuth relay + deep-link handler
│   ├── menus.ts, updater.ts
│   └── surface-host.ts        creates the utilityProcess + MessageChannelMain
├── surface/
│   └── index.ts               utilityProcess: herdr endpoint socket, frame decode,
│                              posts PaneSurfaceFrame/Patch over the MessagePort
├── preload/
│   └── index.ts               contextBridge: typed daemon RPC handle + port receipt
└── renderer/
    ├── App.tsx                composition root only
    ├── runtime/               trpc client, ws subscription, surface port hook
    ├── hooks/                 where behavior lives — not components
    ├── surface/               canvas cell renderer, damage tracking, input encoding
    ├── state/                 ledger view state, filters, selection (client-only)
    └── components/            mostly presentational
```

**INVARIANT — the renderer is never the source of truth.** It renders streamed state. It never
computes status (that is §6, in the daemon), never caches a session, never decides a gate. On
reconnect it discards local state and takes the snapshot.

**Startup order**, and it matters:

1. `app.setPath('userData', ...)` — before anything else touches disk
2. adopt-or-spawn herdr server on the `osade` named session; wait for `Ping`
3. spawn the daemon; wait for its ready handshake (never a fixed sleep)
4. create the window; renderer connects to daemon, then requests a surface port

**Shutdown:** quitting the window detaches. It does **not** stop herdr and does **not** stop the
daemon. Agents keep running. Add an explicit "Stop everything" menu item and a tray state so
this is discoverable rather than surprising.

**Vendoring herdr:** ship a prebuilt herdr binary per platform in `vendor/herdr/<target>/`.
Do not build it at install time — herdr requires Zig 0.15.2 as a hard build dependency for
`libghostty-vt`, which is not an acceptable user prerequisite. Pin the version and verify a
checksum at boot.

### 18.2 Surface transport

```
herdr endpoint socket
   └─ utilityProcess: handshake (advertise gen 1), negotiate shell.snapshot.v1 +
      shell.surface.v1 + shell.input.semantic.v1, decode frames
        └─ port.postMessage(frame)  ── MessageChannelMain ──► renderer
             └─ cell buffer + damage rects → canvas draw on rAF
```

Input goes the other way as `shell.input.semantic.v1`. Handle: kitty keyboard protocol,
bracketed paste, dead-key composition. herdr handles these explicitly on its side; the client
must not mangle them on the way in.

Backpressure: one PTY, potentially several viewers (a pane visible in the ledger preview and in
the detail view). Track per-viewer acknowledged bytes; pause the shared stream when the slowest
viewer exceeds a high-water mark and resume only when the *last* slow viewer drains below the
low-water mark. Kanban's numbers are a reasonable starting point: 16 KiB high, 4 KiB low, 4ms
batch interval with a fast path for chunks under 256 B.

**Terminals are parked, not unmounted.** Keep surface canvases in a hidden root and move them,
so switching tasks never drops or re-subscribes a session. Kanban learned this; it is not
optional.

---

## 19. Design direction

The brief has a real subject: this is a record of machine work on a public commons. The
vernacular is commits, patches, review threads, changelogs, `git status` porcelain. Design from
that, not from a generic dark SaaS board.

### 19.1 Concept: the ledger

An append-only public record, not a set of floating cards. Ruled rows in a fixed grid, a status
gutter on the left like porcelain output, evidence and provenance visible inline. **The kanban
column view exists but is not the default** — with eight parallel agents, a single vertical
ledger sorted needs-you-first answers the actual question ("who needs me?") better than
horizontal columns ever will.

### 19.2 Tokens

**Color.** Light-first, which is itself a differentiator in a category that is uniformly dark.
Ship dark as a full peer, not an afterthought.

```
--paper     #F6F7F4    faint green-grey stock; not cream, not white
--ink       #191C1A    body text
--ink-soft  #5C6360    secondary
--rule      #D7DCD6    all borders, 1px, no shadows anywhere
--field     #ECEEE9    inset surfaces (terminal chrome, diff gutters)
```

State colors appear **only** as state, never as decoration or branding:

```
--st-needs  #A85B12    needs you        (approval, blocked, changes requested)
--st-live   #2C6B4F    running          (implementing, verifying)
--st-fail   #97302E    failed           (verify, ci)
--st-rest   #6E7772    idle / merged / archived
```

Deliberately avoided: near-black with one acid accent; warm cream with terracotta; gradient
washes; a single shadow value under every card.

**Type.** IBM Plex Sans for interface, IBM Plex Mono for anything machine-authored — paths,
shas, commands, diffs, log tails. This is a superfamily chosen because the whole product is a
record of machine work and Plex was drawn for that register; it is not a neutral default.
Tabular numerals on everywhere numbers align. Scale: 11 / 13 / 15 / 19 / 25.

Do not use all-caps labels. Do not put an eyebrow above every heading. Do not accent one word
in a headline.

**Structure.** Borders and rules carry information: a rule separates lanes of meaning, never
decorates. Zero shadows. One border radius (3px) on interactive controls only; surfaces are
square. Density is a feature — this is a tool for someone watching eight things at once.

### 19.3 Layout

```
┌────────────┬──────────────────────────────────────┬────────────────────────────┐
│ ORGS/REPOS │  LEDGER                              │  TASK SURFACE              │
│            │                                      │                            │
│ ▸ solana   │  ⚑ gate   open PR #—   auth-refresh  │  ┌──────────────────────┐  │
│   ▸ web3js │  ⚑ input  needs you    csv-import    │  │ agent │verify│diff│   │  │
│ ▸ langchain│  ● live   implementing rate-limit    │  ├──────────────────────┤  │
│   ▸ deep…  │  ✗ fail   verify       parser-fix    │  │                      │  │
│            │  ○ idle   queued       docs-typo     │  │   terminal surface   │  │
│ + add repo │                                      │  │                      │  │
│            │  ── merged ─────────────────────     │  └──────────────────────┘  │
│            │  ✓ merged pr #4421     null-guard    │  gates · conventions ·     │
│            │                                      │  memory · checkpoints      │
└────────────┴──────────────────────────────────────┴────────────────────────────┘
```

- The gutter glyph set is fixed-width and fixed-position: `⚑ ● ✗ ○ ✓`. It is scannable
  peripherally, which is the whole job when eight agents are running.
- Ledger sort: needs-you set first, then live, then everything else. Never sort by creation
  time by default.
- The right pane is full-height and lane-tabbed. Terminal, verification output, diff, and
  review artifact are lanes of one surface, not separate screens.
- Conventions, memory, gates, and checkpoints live in a lower drawer on the task surface, so
  provenance is one click from the work rather than in a settings screen.

### 19.4 Motion and copy

One orchestrated moment: when a task enters the needs-you set, its row animates once into the
top group. Nothing else moves on its own. No fade-and-slide entrances, no hover transitions on
rows.

Copy: active voice, sentence case, and an action keeps its name through the whole flow — the
button that says "Open pull request" produces a row that says "Pull request opened." Empty
states name the next action. Failures state what broke and the command that broke it, in the
interface's voice, never apologizing.

---

## 20. Repository layout and enforced boundaries

```
osade/
├── apps/desktop/                  Electron (see §18.1)
├── packages/
│   ├── contract/                  Zod schemas — the only cross-boundary types
│   ├── daemon/
│   │   └── src/
│   │       ├── cli.ts             lazily imports the server stack
│   │       ├── server/            http, trpc router, ws hub, cdc broadcaster
│   │       ├── herdr/             ONLY caller of herdr; generated/ client
│   │       ├── domain/            derive-status, agent-reducer, launch, verify, gates
│   │       ├── scm/               ONLY importer of Octokit
│   │       ├── knowledge/         conventions miner, memory, embeddings
│   │       └── db/                sqlite, migrations, change_log, cdc poller
│   ├── cli/                       `osade` verbs (humans and agents, same surface)
│   └── skill-assets/              using-osade skill, installed to ~/.osade/skills
├── vendor/herdr/                  pinned prebuilt binaries + checksums + api schema
├── patches/                       herdr patches, each with a rationale + upstream link
└── docs/
    ├── PRD.md                     this file
    └── adr/                       one file per DECISION taken during the build
```

### 20.1 Lint-enforced, not conventions

These are lint failures, not review comments. Wire them in ESLint `no-restricted-imports` plus
a small set of custom rules.

| Rule | Why |
| --- | --- |
| herdr client importable only from `daemon/src/herdr/**` | one boundary to the substrate |
| Octokit importable only from `daemon/src/scm/**` | one boundary to GitHub |
| no `status` field written to any table | §6 is the invariant, enforce it mechanically |
| no WS emit outside `server/cdc-broadcaster.ts` | one event path (§5.4) |
| no raw `__orchestrator__` literal | one definition of the synthetic id (§17) |
| no `console.*` / `process.exit` in `daemon/src/**` except `cli.ts` | the daemon is a library, not a script |
| no `process.env` destructuring | env read at use sites, not snapshotted |
| no `any` | |
| renderer may not import from `daemon/src/**` | contract package only |

Keep `cli.ts` off the server import graph — lazily `await import(...)` the runtime inside
`startServer`. Short-lived subcommands that eagerly load the whole graph stay alive after
printing their result. This was a real bug in Kanban.

### 20.2 Testing

```
packages/daemon/test/unit/         pure reducers, derive-status, verify-plan. No I/O. Fast.
packages/daemon/test/integration/  real sqlite, fake herdr, recorded GitHub fixtures
apps/desktop/tests/                vitest + playwright on the renderer
test/e2e/                          real herdr binary, real git repo fixture, one full task
```

`derive-status` gets a property test: for any fact set, exactly one status, and no ordering of
fact writes produces a different result than the final state. That function is the spine.

The pre-commit gate is unit + integration. E2E runs in CI.

If CI hangs after tests appear to finish, suspect a live subprocess or a daemon a unit-style
suite booted, not a slow test body.

---

## 21. Milestones

Each milestone ends in a demo. Thin end-to-end slices, not layers.

### M0 — Spine (target: 1 week)

Prove the three-process architecture works before building any product on it.

- [ ] Vendor herdr binary + api schema; generate the typed client; version guard
- [ ] Daemon: sqlite + migrations + change_log + CDC + ws snapshot/push
- [ ] Electron: userData redirect, supervisor, utilityProcess surface transport, canvas renderer
- [ ] One task: create → worktree via herdr → spawn Claude Code in an agent lane → surface renders
- [ ] `deriveStatus` implemented for rows 4, 10, 11, 13, 14 only
- [ ] herdr event subscriber writing `agent_fact`

**Acceptance:** type a prompt, watch Claude Code work in an isolated worktree inside the
Electron window, and see the row move `queued → implementing → needs_input → awaiting_review`
driven entirely by herdr's detection, with nothing polled and no status column in the database.

### M1 — Lifecycle, verification, gates

- [ ] Ledger view with the needs-you sort
- [ ] Full `deriveStatus` table
- [ ] Verify plan derivation, editable, `verify` lane, run rows, log capture
- [ ] Failure loop: verify fails → tail sent back to the agent lane
- [ ] Gate requests, payload hashing, approve/deny/edit UI
- [ ] Turn checkpoints + undo
- [ ] Multi-agent: 4 tasks in parallel on one repo, no cross-talk

**Acceptance:** a task runs `implementing → verifying → verify_failed → implementing →
awaiting_review` without a human touching it, and the commit is blocked until approved.

### M2 — GitHub and the contribution loop

- [ ] Issue import → task
- [ ] Triage task type (§12): reproduce, bisect, failing test — terminates without a PR
- [ ] scm polling, fork-aware push, gated PR open
- [ ] `review_changes_requested` loops back into the agent lane
- [ ] Rate-limit backoff, ETags

**Acceptance:** import a real issue from a repo you maintain; land one PR through the gate; run
one triage task that produces a reproduction and no PR.

### M3 — Repository skills

- [ ] Miner: extract → cluster → verify, three bounded passes
- [ ] Evidence enforcement, confidence, candidate/active promotion UI
- [ ] `CONTEXT.md` injection per agent, 40-rule cap
- [ ] Incremental re-mine, 180-day decay

**Acceptance:** run N ≥ 10 comparable tasks with and without injected conventions on the same
repo; report review rounds to merge and first-round-acceptance rate for both. If the number
does not move, the feature is wrong and should be redesigned, not shipped.

### M4 — Memory and multi-agent coordination

- [ ] `memory` + `memory_vec`, verification-gated promotion, scope-filtered retrieval
- [ ] Memory inspector UI with per-entry delete
- [ ] `osade` CLI verbs + skill asset install
- [ ] Orchestrator agent with the synthetic home id
- [ ] Reviewer gateway: neutral home, hash-verified manifest, structured artifact, gated post

**Acceptance:** an orchestrator agent decomposes one issue into three tasks by calling the
`osade` CLI, and a reviewer agent reviews a PR without ever having credentials or the source
checkout in its working directory.

### M5 — Org workspaces and cross-repo

- [ ] Org grouping, multi-repo ledger
- [ ] Cross-repo dependency links, ecosystem-tagged memory transfer
- [ ] Network egress enforcement
- [ ] Optional: AO-style lane↔chat handoff for agents whose resume id provably names the same
      conversation as their protocol session id. **Capability-gated.** Do not attempt this
      before M5; it needs CAS-fenced generations, drain policies, and a durable outbox to be
      correct, and it is worthless if done approximately.

---

## 22. Metrics

Instrument from M1. These are the only numbers that matter.

| Metric | Definition | Why |
| --- | --- | --- |
| **Review rounds to merge** | count of `changes_requested` events before merge | the §0.1 goal, directly |
| First-round acceptance | merged with zero changes requested | the strong version of the same thing |
| Human-touch minutes per merged PR | wall-clock in gate + review UI | what a maintainer actually spends |
| Verification catch rate | failures caught locally ÷ (local + CI) | value of the loop before it costs anyone |
| Gate denial rate | denied ÷ requested, per gate | a high rate means the agent is misjudging; a near-zero rate means the gate is theater |
| Convention hit rate | active rules cited in review comments after injection | is the miner mining the right things |
| Time to first meaningful output | task create → first verified diff | |

---

## 23. Open questions — decide before the milestone that needs them

1. **Embeddings.** Local (a small ONNX model, no network, works offline) or an API? Local is
   more consistent with local-first and avoids a key requirement for a core feature. Needed by
   M4.
2. **Which repos are the test bed?** The M3 measurement needs repos where you can actually see
   merge outcomes. `langchain-ai/deepagents` and `supabase/mcp` are candidates given prior
   contributions. Decide by M2 so mining can start early.
3. **Do triage tasks announce themselves?** If a triage artifact is posted to an issue,
   disclosure ("produced by an agent, verified by <human>") is both an ethical and a practical
   question — several projects now require it. Recommend: always disclose, and make the
   disclosure line non-editable.
4. **Windows.** herdr supports it (ConPTY, named pipes, no live handoff). Osade v1 could be
   Unix-only to halve the surface. Decide before M0 ends, because the supervisor and socket
   code differ.
5. **Surface renderer performance.** If the canvas renderer cannot hold 15 panes at 60fps by
   the end of M0, take the `TerminalAnsi` + xterm.js fallback (§4.4) and write the ADR.

---

## 24. Feature provenance

Traceability for every claim in the product brief, so nothing gets lost and nothing gets
rebuilt.

| Osade feature | Source | Where in this doc |
| --- | --- | --- |
| Multi-agent, agent-agnostic runtime | herdr (23 known agents) + Kanban catalog | §8 |
| Concurrent same-repo agents | herdr workspaces + Kanban worktree rules | §9 |
| Git worktrees | herdr `src/worktree.rs` | §9 |
| Multi-repo / org workspaces | new | §5.1, M5 |
| Agent orchestration | AO orchestrator-as-agent + herdr CLI | §17 |
| Persistent sessions | herdr persist + live handoff | §18.1 |
| Shared agent memory | new, gated | §15 |
| Layered memory | new | §15 |
| Automatic repository skills | **new — the novelty** | §13 |
| Repository intelligence | new (scm) | §11, §12 |
| Personal coding habits | memory `scope='personal'` | §15 |
| Cross-repository context | new, restricted | §15.2 |
| Agent activity monitoring | herdr detection + hooks | §7 |
| Permission & approval gates | new, AO capability gating | §14 |
| Automated verification | new, run in herdr lanes | §10 |
| Human-in-the-loop review | Kanban detail view + AO gateway | §16, §19.3 |
| GitHub integration | new | §11 |
| Persistent workspaces | herdr | §18.1 |
| Terminal multiplexing | herdr (it is a multiplexer) | §4 |
| Task-to-workspace mapping | new (§3 naming) | §3, §5.1 |
| Open-source workflow intelligence | conventions + gates + triage | §12, §13, §14 |
| Safe autonomous contribution | gates + verification + reviewer gateway | §10, §14, §16 |
| Durable facts / derived status | **AO — the borrowed invariant** | §6 |
| Narrow event vocabulary | **Kanban — the borrowed discipline** | §6.1 |
| One event path (CDC) | AO | §5.4 |
| Turn checkpoints / undo | Kanban | §9.1 |
| Auto-review trigger policy | AO autoreview + Kanban auto-review | §16 |
| Multi-viewer backpressure | Kanban | §18.2 |
| State containment | AO | §2.2 |

---

## 25. The one-paragraph summary for a reviewer

Osade runs several coding agents as open-source contributors on real repositories. herdr, an
existing Rust terminal workspace manager, is the execution substrate — it owns the PTYs, panes,
git worktrees, agent process detection and hook integrations, and it survives the app closing.
A new Node daemon owns everything herdr has no concept of: tasks, the contribution lifecycle,
GitHub facts, verification runs, approval gates, mined repository conventions, and layered
memory. An Electron app renders it, taking domain state from the daemon and terminal cell
surfaces straight from herdr. The load-bearing design choice, taken from AO, is that no status
is ever stored — every state the user sees is a pure function over durable facts recomputed at
read time, which is what keeps a flaky probe from killing a live agent. The load-bearing
product choice is that the goal is not more agent pull requests but a lower review cost per
contribution, which is why verification, evidence-cited conventions, scoped reviewer
confinement, and human gates on every public write are core rather than optional.