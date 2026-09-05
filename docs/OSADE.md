# Osade — Product Requirements & Build Spec

> **Read this whole document before writing code.** It is written to be handed to a coding
> agent. Sections marked **INVARIANT** are load-bearing; breaking one produces a class of bug
> that is expensive to find later. Sections marked **DECISION** record a choice that was made
> deliberately over a plausible alternative — do not re-litigate them mid-build.
>
> **Revised 2026-09-04** against a live herdr `0.8.2-p20`. Sections carrying a
> *"Corrected … per PRD-DELTA #n"* marker were wrong about herdr and now match verified
> behaviour. Two companions:
>
> - **`docs/HERDR-CONTRACT.md`** — the verified herdr surface: real method names, event names
>   and payload shapes, each with a `file:line` citation or a live transcript. **Where this
>   document and the contract disagree, the contract is right.** Code against it.
> - **`docs/PRD-DELTA.md`** — what was wrong here and why, numbered #1–#15.
>
> One decision was reversed outright rather than corrected: **§4.4**, the embedded terminal,
> is deferred past M0. One INVARIANT was added: **§5.4.1**, the monotonic fact gate.

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
   *Corrected 2026-09-04 per PRD-DELTA #10.* **Carve-out:** Osade may run read-only and
   maintenance git commands in a repo or worktree — `git worktree prune`, `status`,
   `diff`, `rev-parse`, `stash`. herdr never prunes before `worktree add`
   (`backend/src/worktree.rs:238-320`), so the "missing but already registered" failure is
   ours to prevent, and there is no git-status event to subscribe to (§7). What stays herdr's
   is worktree *lifecycle*: create, open, remove.
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
- herdr sockets are unix domain sockets, mode `0600` — **on Unix**.
  *Corrected 2026-09-04 per PRD-DELTA #12.* On Windows they are **named pipes**, not files:
  `interprocess` maps the path string through `GenericNamespaced`
  (`backend/src/ipc.rs:44-51`), so a client connects to `\\.\pipe\C:\…\herdr.sock` and access
  is governed by an SDDL descriptor (`backend/src/ipc.rs:156`), not a file mode. The `.sock`
  path also exists on disk as a marker file (`backend/src/ipc.rs:76`); **its presence does not
  mean a server is listening** — probe with `ping`.
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

*Corrected 2026-09-04 per PRD-DELTA #1 and #2.*

**herdr's version string is not a contract.** Two builds both call themselves `0.8.2` and
differ by protocol (20 vs 22), by ten methods, and by one capability field. Generating a
client from the wrong one produces calls the shipped binary answers with `invalid_request` —
not at boot, but the first time a user hits that code path.

So the identity of a herdr target is the tuple **(protocol number, method set)**. The version
string is a label.

**INVARIANT — the pinned vendored schema is the only codegen source.**

```
vendor/herdr/<version>-p<protocol>/
├── api-schema.json     captured with `herdr api schema --json` from the vendored binary
├── methods.txt         the sorted method set, for diffing
├── pin.json            protocol, method count, schema sha256, binary sha256, known gaps
└── <target>/herdr      the binary itself (M0 packaging)
```

`backend/` is **reference reading for behaviour only, never a source of API derivation.** It
is an unreleased tree ahead of any binary Osade ships. Read it to understand what a method
*does*; never to learn that a method exists.

The upstream file OSADE.md previously named — `docs/next/api/herdr-api.schema.json` — is
absent from `backend/` as vendored, and is `include_str!`'d at `backend/src/cli/api.rs:1`, so
that tree does not compile. Do not try to restore it. The binary embeds and prints its own
schema; that is the capture path.

**Milestone 0, task 1:** generate a typed TypeScript client from the pinned
`api-schema.json` (`json-schema-to-typescript` or `quicktype`) into
`packages/daemon/src/herdr/generated/`. Commit the generated output, the schema, and
`pin.json` together.

Do **not** hand-write method names from memory or from this document. This document names
methods illustratively; the pinned schema is the truth, and it has **91 methods** at
`0.8.2-p20`. If a method this spec assumes is not in the pinned schema, stop and report it
rather than approximating. Verified method names, event names and payload shapes live in
`docs/HERDR-CONTRACT.md`.

#### 4.1.1 The boot drift check — specification

A contract test, run both in CI and as a daemon boot guard. **Specification only; implement
in M0.**

*Input.* The pinned `api-schema.json` and `pin.json`; the schema of the binary actually about
to be used, obtained by executing `<binary> api schema --json`. Read it from the binary on
`PATH`/in `vendor/`, not from a cached copy — the point is to catch a user running a
different herdr.

*Comparison.* Exactly three assertions, in this order:

| # | Assertion | On failure |
| --- | --- | --- |
| 1 | `live.protocol === pin.herdr.protocol` | **fatal.** Refuse to start. |
| 2 | `methodSet(live) ⊇ methodSet(pin)` — every pinned method exists in the live binary | **fatal.** Name the missing methods. |
| 3 | `methodSet(live) \ methodSet(pin)` is empty | **warn only.** A superset is a newer herdr; log the extra methods so a re-pin gets scheduled. |

*Explicitly not compared:* the **version string**. It is decorative and two different builds
share it. Never gate on it, never print it as the reason.

*Failure message* must name the drift, not the symptom:

```
herdr protocol mismatch: pinned 0.8.2-p20 expects protocol 20, binary at
  <path> reports protocol 22.
missing methods: (none)   unexpected methods: command.invoke, pane.scroll, +8
re-pin with: herdr api schema --json > vendor/herdr/<version>-p<protocol>/api-schema.json
```

*Where it runs.* In CI as a test against the vendored binary; at daemon boot before the first
API call; and it must be cheap — one subprocess, one JSON parse, no socket. Assertion 3 must
never block a boot, or every herdr upgrade becomes an outage.

*What it deliberately does not check.* The endpoint protocol generation, which is negotiated
separately and independently at handshake (§4.3), and the binary checksum, which `pin.json`
records but which cannot gate a user's own installed herdr.

### 4.2 Which socket for what

*Corrected 2026-09-04 per PRD-DELTA #6b and #7.*

| Need | Transport | Notes |
| --- | --- | --- |
| Create/destroy worktrees, spawn agents, send prompts, query state | `herdr.sock` JSON API | daemon only; one connection per call |
| Subscribe to agent status | `herdr.sock` `events.subscribe` | daemon only; **one connection per pane** (§7) |
| Subscribe to workspace/tab/pane lifecycle | `herdr.sock` `events.subscribe` | daemon only; one connection, global |
| Terminal cell content, semantic input | endpoint protocol, generation 1 | renderer utility process only — **deferred past M0**, see §4.4 |
| Git status / diff state | **not herdr.** `git` in the worktree, debounced | no such event exists (§7); §1 carve-out |
| Anything else | — | there is nothing else |

**INVARIANT — the JSON API is one request per connection.** `handle_connection_with_stop`
reads exactly one line, dispatches, writes one response, and returns
(`backend/src/api/server.rs:154-300`). There is no multiplexing and no keep-alive. The
generated client opens a fresh connection per call. Do **not** build a correlation-id
multiplexer or a connection pool; there is nothing to multiplex.

Exceptions that hold a connection open: `events.subscribe` and `pane.graphics.stream`
(streaming); `events.wait`, `agent.wait`, `agent.prompt` with `wait`, and
`pane.wait_for_output` (block, then one response). Each connection is an OS thread on herdr's
side (`backend/src/api/server.rs:90-100`), so prefer `agent.prompt` + `wait` over
prompt-then-poll, and keep the steady-state connection count proportional to live panes, not
to time.

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

*Corrected 2026-09-04 per PRD-DELTA #3a.* **The stability promise is real; the framing is
not JSON.**

What generation 1 actually guarantees: `do_handshake` compares `generation` and the four
codec names and **never compares herdr build versions**
(`backend/src/client/handshake.rs:219-232`). An Osade shell built against generation 1 keeps
working across herdr upgrades. That part of §4.3 was right.

What it does not guarantee: the wire. The endpoint rides on `herdr-client.sock`, framed

```
[u32 little-endian length][bincode payload]        backend/src/protocol/wire.rs:1592-1602
```

encoding the Rust enums `ClientMessage` / `ServerMessage` under
`bincode::config::standard()`. Only the handshake and control messages carry JSON, as a
string inside `EndpointControl { kind, data }`. Everything Osade would render —
`ClientShellSnapshot`, `PaneSurface(PaneSurfaceFrame)`, `PaneSurfacePatch` — is a native
bincode variant (`backend/src/protocol/wire.rs:1411`, `:1414`, `:1442`).

Two consequences. A TypeScript client must implement a bincode decoder for the whole
`ServerMessage` enum. And enum tags are **positional**, so a herdr build that inserts a
variant shifts every tag after it and the decoder misreads silently. `EndpointControl` is
append-only for exactly this reason (`wire.rs:1444-1448`); nothing else is. Any transport
built on this must pin to the vendored herdr (§4.1) and assert a known frame decodes at boot.

This is why the embedded terminal is deferred (§4.4).

### 4.4 Rendering terminal surfaces — DECISION, REVERSED

*Corrected 2026-09-04 per PRD-DELTA #3b and #3c. This section previously specified a canvas
cell renderer for M0. That decision is reversed; the reasoning that produced it was sound but
rested on three facts that turned out to be false.*

**DECISION: M0 ships no embedded terminal.** Osade renders the ledger, task detail, diffs,
verification output and gates. Watching a live terminal is "Open in herdr", which attaches a
real herdr client to the `osade` session in the user's own terminal.

#### What changed

The old decision rested on: the surfaces arrive as already-parsed cell grids (true), over a
JSON-ish protocol (**false** — bincode, §4.3), one stream per pane that the renderer can place
in its own layout (**false**), with a `TerminalAnsi` fallback available if canvas proved slow
(**false**).

- `PaneSurfaceFrame` (`backend/src/protocol/wire.rs:1213-1225`) is **one composited cell grid
  for a whole tab**, with `panes: PaneSurfacePane[]` giving each pane's rect inside it. herdr
  composites; the client blits. There is no "subscribe to pane X's cells". Osade cannot
  assemble 15 panes from different tasks into its own React grid.
- Each connection does carry its own workspace/tab projection
  (`ClientConnection.shell_location`, `backend/src/server/clients.rs:174-175`), so N surfaces
  means N connections, N server-side render targets, and herdr rendering N tabs per frame —
  the multiplicative path herdr's own `AGENTS.md` warns about. "15 panes at 60fps" was never
  15 panes; it was 15 tabs.
- The `TerminalAnsi` fallback does not exist for endpoint clients. `RenderEncoding`
  (`wire.rs:41-48`) is negotiated on the **private** `TerminalHello` path;
  `do_handshake` hardcodes `SemanticFrame` for every endpoint shell
  (`backend/src/client/handshake.rs:236-238`).

#### Why this does not cost M0 anything

M0's acceptance criterion (§21) is that a row moves `queued → implementing → needs_input →
awaiting_review` driven entirely by herdr's detection, with nothing polled. That was verified
end-to-end with **no client attached and no cell ever rendered** (`docs/HERDR-CONTRACT.md`
§3.3). Terminal pixels were never the thing M0 proves.

What a user actually needs to read during a task is verification output and diffs — files
Osade owns on disk (`~/.osade/runs/`), not herdr cells.

#### What M0 does instead

- **Ledger, task detail, diff view, verification log tails, gates.** All from the daemon.
- **Activity line** from `AgentInfo.terminal_title_stripped`, which herdr already reports on
  every status change — observed as `"Pong response"` after a turn. Free.
- **On-demand transcript panel** via `pane.read`, the one screen-content method the pinned
  schema exposes (§4.4.1). On explicit user action or a slow refresh, never a render loop.
- **"Open in herdr"**, which runs `herdr session attach osade` (or `herdr --session osade`) in
  the user's terminal. Zero Osade rendering code, full fidelity, real input.

**INVARIANT — attaching a client mutates herdr state that Osade derives status from.**
`agent_status` is `done` when the pane is idle **and unseen**, and `idle` when it is idle and
seen (`backend/src/app/api_helpers.rs:100-106`). `seen` is set by `pane.focus`
(`backend/src/app/api/panes.rs:477`), `agent.focus` (`backend/src/app/agents.rs:82`), and by a
client reporting terminal focus (`backend/src/server/headless.rs:858`). So opening a task in
herdr flips `done → idle` and would erase §6 row 10 if Osade treated `idle` as a transition.
It does not — `idle` is never a transition (§6.1, §7). And **Osade never calls `pane.focus` or
`agent.focus` on a task lane**, because doing so would silently clear its own
`awaiting_review`.

#### 4.4.1 `pane.read` — the only screen content in the pinned schema

```
pane.read  { pane_id, source: "visible"|"recent"|"recent_unwrapped"|"detection",
             lines?: uint32 (capped at 1000), format: "text"|"ansi", strip_ansi: bool }
        →  { pane_id, workspace_id, tab_id, source, format,
             text: string, revision: uint64, truncated: bool }
```

`agent.read` is the same call keyed by agent `target`. Plain text, or an ANSI byte stream with
`format:"ansi"` + `strip_ansi:false`. **Not a structured cell grid**: no cursor position, no
cursor shape, no selection, no scroll offset. `pane.selection.read`, `pane.scroll` and
`pane.edit_scrollback` are **not in the pinned schema** — they are three of the ten methods in
the `0.8.2-p20` gap (§4.1).

Use it for a static panel at ≤1 Hz, keyed on `revision` to skip unchanged reads. Do not build
a render loop on it: one request is one connection is one herdr thread (§4.2), the response is
the whole screen with no diffing, and there is no cursor to draw.

#### When the embedded terminal comes back

**M1, behind an explicit gate**, and only if the ledger has shipped and users ask for it. The
work is: a bincode decoder for `ServerMessage` pinned to the vendored herdr, with a boot
assertion that a known frame decodes; one endpoint connection per visible surface, **LRU-capped
at 3**; canvas 2D with damage tracking; kitty graphics rendered as a placeholder block. Write
the ADR when the gate opens, and re-derive the frame-rate target from tabs, not panes.

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

*Corrected 2026-09-04 per PRD-DELTA #4, #5 and #11.*

```sql
-- last known agent activity, written by the herdr event subscriber
CREATE TABLE agent_fact (
  task_id       TEXT PRIMARY KEY REFERENCES task(id),
  herdr_pane_id TEXT,                      -- 'w3:p2'; the subscription key (§7)
  herdr_state   TEXT,                      -- working|blocked|done|idle|unknown
  last_event    TEXT,                      -- to_in_progress|to_review|activity
  last_event_at INTEGER,
  activity_text TEXT,                      -- from AgentInfo.terminal_title_stripped
  tool_name     TEXT,                      -- null for claude/codex — no source (§7)
  final_message TEXT,                      -- null for claude/codex — no source (§7)
  agent_session_id TEXT,                   -- from AgentInfo.agent_session, for resume
  pane_alive    INTEGER NOT NULL DEFAULT 0,
  last_probe_at INTEGER,
  probe_failures INTEGER NOT NULL DEFAULT 0,
  terminated    INTEGER NOT NULL DEFAULT 0,   -- explicit, not inferred
  state_change_seq INTEGER NOT NULL DEFAULT 0, -- monotonic gate, §5.4.1 — INVARIANT
  controller_generation INTEGER NOT NULL DEFAULT 0
);
```

Notes on three columns that will otherwise be got wrong:

- **`activity_text` / `tool_name` / `final_message`.** herdr's bundled hooks report *state*
  for only six agents (pi, opencode, kimi, kilo, omp, mastracode). For **claude and codex the
  hook posts a session id and nothing else**, and no bundled asset calls
  `pane.report_metadata` at all. So `tool_name` and `final_message` have no source for the
  agents Osade leads with. Treat them as nullable-and-usually-null in v1 and drive the display
  string from `AgentInfo.terminal_title_stripped`, which herdr reports on every status change.
- **`state_change_seq`.** The monotonic write gate. See §5.4.1.
- **`herdr_workspace_id`** on `task` is a durable key: it is a stored field
  (`backend/src/app/ids.rs:15-17`), stable when other workspaces close and across a herdr
  restart. Two cautions — `WorkspaceInfo.number` **does** renumber, so never key on it; and
  `parse_workspace_id` has a positional fallback for bare integers
  (`backend/src/app/ids.rs:60-67`), so always send the full `wN` form herdr returned.

```sql
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

### 5.4.1 The monotonic fact gate — INVARIANT

*Added 2026-09-04 per PRD-DELTA #5.*

§5.4 governs Osade's *own* event path, which is exactly-once and ordered. herdr's is neither.

herdr's `EventHub` is a **512-entry in-memory ring buffer** (`backend/src/api/event_hub.rs:13`,
`:22`) polled per subscription. Two verified behaviours:

1. **Replay on connect.** A fresh `events.subscribe` connection immediately receives a burst
   describing state that existed before it connected — including `workspace_created` for a
   workspace that had already been *closed*. Reproduced on two independent connections.
2. **Silent loss.** More than 512 events while disconnected and the overflow is dropped with
   no gap marker. **The delivered envelope carries no sequence number.**

So a naive subscriber can write a replayed `working` on top of a live `done`, and can miss a
transition entirely without knowing.

> **INVARIANT — every agent fact write is gated on a monotonic counter, and every
> (re)connect reconciles against a snapshot.**
>
> 1. Each **state change** carries the counter from its payload:
>    `AgentInfo.state_change_seq`, or `PaneInfo.revision` where that is what the event gives. A
>    state change whose counter is **not strictly greater** than the stored
>    `agent_fact.state_change_seq` is **dropped**, not merged.
> 1a. **Only state changes participate in the gate.** A payload that carries no state — an
>    `agent_session` binding, say — neither consults nor advances the counter. Letting one
>    advance the watermark makes the fold order-dependent: a binding stamped with a high
>    sequence swallows every status event below it and strands the fact at whatever it happened
>    to hold. That is the same class of bug as a replayed `working` clobbering a live `done`,
>    entered from the other side. *Found by the §20.2 ordering property test during M0, not by
>    reading; keep that test.*
> 2. The counter and the fact it guards are written in **one transaction**. A fact stored
>    without advancing the counter, or a counter advanced without the fact, both reintroduce
>    the bug.
> 3. On every subscriber connect **and reconnect**, the daemon calls `session.snapshot`,
>    reconciles all live panes against it, and only then trusts the stream.
> 4. Reconciliation writes go through the database like every other write. §5.4 is not
>    weakened: there is still exactly one path from a mutation to the UI.

This is a *read* of herdr on reconnect, not the polling §5.4 forbids: it is bounded, one call
per connection event, and it never drives the UI directly.

The same discipline covers §5.2's failed-probe rule from the other side. A dropped event is
not evidence that an agent died, exactly as a failed probe is not. Neither may set
`terminated`.

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
- *Corrected 2026-09-04 per PRD-DELTA #11.* **A herdr restart is not a task death.** herdr
  restores workspaces, tabs and panes with the same ids and cwd, but **not the agent
  process**: the pane comes back as a bare shell with `agent = null` and
  `agent_status = unknown`. Row 13 must therefore read *`agent.pane_alive === 0` **or** the
  pane exists with no agent bound* → `queued`, so a restored-but-unlaunched task sorts as
  work to start rather than falling through to row 14 `idle`. `terminated` stays untouched —
  §5.2's rule holds: only an explicit process exit or an explicit user action sets it. §8.2
  owns the relaunch.
- *Per PRD-DELTA #4.* Row 10's trigger is `last_event === 'to_review'`, which now comes from
  herdr's `done` and **only** from `done`. See §6.1.
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

*Corrected 2026-09-04 per PRD-DELTA #9.* The mapping from herdr's five statuses onto these
three events — this replaces the collapsed `done`/`idle` row that appeared in §7:

| `AgentStatus` | Osade event | Why |
| --- | --- | --- |
| `working` | `to_in_progress` | |
| `done` | `to_review` | the turn finished — this is the needs-you signal |
| `blocked` | *none* — sets `herdr_state` only | drives §6 row 4 `needs_input` |
| `idle` | *none* — sets `herdr_state` only | **never a transition**, in either direction |
| `unknown` | *none* — recorded, not acted on | |

`done` and `idle` are not interchangeable, and the difference is not about the agent.
`agent_status` is `done` when the pane is idle **and unseen**, `idle` when it is idle and
**seen** (`backend/src/app/api_helpers.rs:100-106`). So a completed turn reads `done` until
something marks the pane seen, at which point herdr emits `idle` for the same agent in the
same state.

That is why `idle` must be inert. If `idle` mapped to `to_in_progress`, opening a task in
herdr would silently clear its `awaiting_review`; if it mapped to `to_review`, a freshly
launched, never-prompted agent would land in the needs-you set immediately. Both were live
possibilities in the original table. A task leaves `queued` on `pane_alive` and a bound agent
(§6 row 13), not on an `idle` event.

See §4.4 for the corollary: Osade never calls `pane.focus` or `agent.focus` on a task lane.

The transition reducer is pure, in `packages/daemon/src/domain/agent-reducer.ts`, and takes
`(facts, event) -> factPatch`. No I/O in it.

---

## 7. Where agent state actually comes from

*Corrected 2026-09-04 per PRD-DELTA #4, #6, #6a, #6b and #9. Four of the seven event names
this section originally used do not exist. The corrected surface, with payload shapes and
citations, is `docs/HERDR-CONTRACT.md` §7.*

**Do not build a parallel hook system.** herdr installs per-agent hook scripts
(`backend/src/integration/assets/<agent>/`) and panes identify themselves via
`HERDR_ENV`, `HERDR_SOCKET_PATH`, `HERDR_BIN_PATH`, `HERDR_PANE_ID`, `HERDR_TAB_ID` and
`HERDR_WORKSPACE_ID`, injected at spawn (`backend/src/pane.rs:115-137`) — that much was right.

But the hooks report less than this section assumed. **The three names used here —
`HookStateReported`, `HookMetadataReported`, `AgentSessionReported` — are not events.** They
are *inbound methods* the hook scripts call (`pane.report_agent`,
`pane.report_metadata`, `pane.report_agent_session`), and what reaches a subscriber is the
status change herdr derives from them.

### 7.1 What the hooks actually report

| Reports state (`pane.report_agent`) | Reports a session id only | Nothing |
| --- | --- | --- |
| pi, opencode, kimi, kilo, omp, mastracode | **claude**, **codex**, cursor, copilot, devin, droid, grok, antigravity | hermes, qodercli, qwen |

**No bundled asset calls `pane.report_metadata` at all.** For claude and codex the hook fires
once on `SessionStart` and posts a session id and transcript path — nothing more. Their status
therefore comes **entirely from herdr's screen-detection manifests**, which the live test
showed carrying the full lifecycle correctly (`blocked → idle → working → done`) with no
flapping. See §8.1 for the capability consequence.

### 7.2 The subscriber is an N+1 connection manager — INVARIANT

`events.subscribe` has two families of subscription
(`backend/src/api/schema/events.rs:16-85`), and agent status is only in the second:

- **Global, no parameters:** `workspace.*`, `worktree.*`, `tab.*`, `pane.created`,
  `pane.closed`, `pane.updated`, `pane.focused`, `pane.moved`, `pane.exited`,
  `pane.agent_detected`, `layout.updated`.
- **Pane-scoped, `pane_id` required:** `pane.agent_status_changed`, `pane.output_matched`,
  `pane.scroll_changed`. Omitting `pane_id` is a hard `invalid_request`.

**`pane.updated` is not a status feed.** It is emitted only on agent-name change and a few
unrelated actions (`backend/src/app/api.rs:631-633` and four other call sites), while
`pane.agent_status_changed` is emitted on every transition (`backend/src/app/api.rs:647-673`).
Verified: a global `pane.updated` subscription held across a complete `working → done` turn
received **zero** events for that turn.

> **INVARIANT — `packages/daemon/src/herdr/event-subscriber.ts` is a connection manager, not
> a socket.** It holds **one** global lifecycle connection plus **one connection per live
> agent pane**. A pane-status connection is opened when `pane.created` or a successful
> `agent.start` yields a pane id, and closed on `pane.exited` / `pane.closed`. Steady-state
> connection count is proportional to live panes; ~15 concurrent tasks is ~16 connections,
> each an OS thread on herdr's side.

Every write from either connection passes the monotonic gate in §5.4.1, and every connect and
reconnect reconciles against `session.snapshot` first.

### 7.3 The corrected mapping

| herdr event | Osade fact write |
| --- | --- |
| `pane.agent_status_changed` → `working` | `herdr_state='working'`, event `to_in_progress` |
| `pane.agent_status_changed` → `blocked` | `herdr_state='blocked'` (drives `needs_input`) |
| `pane.agent_status_changed` → `done` | `herdr_state='done'`, event `to_review` |
| `pane.agent_status_changed` → `idle` | `herdr_state='idle'` — **no transition** (§6.1) |
| `pane.agent_status_changed` → `unknown` | `herdr_state='unknown'` — no transition |
| its `title` / `display_agent` / `state_labels` fields | `activity_text` — event `activity` |
| `pane.agent_detected` | binds `agent` label to the pane; `released` clears it |
| `pane.exited` | `pane_alive=0`; `terminated=1` only on an explicit process exit |
| `AgentInfo.agent_session` (via snapshot / `agent.get`) | `agent_session_id`, for resume |

Payload of the one that matters, as observed live:

```json
{"event":"pane.agent_status_changed",
 "data":{"pane_id":"w3:p2","workspace_id":"w3","agent_status":"working","agent":"claude"}}
```

with optional `title`, `display_agent`, `state_labels` when non-empty.

### 7.4 Names this section used that do not exist

| Was written as | Reality |
| --- | --- |
| `HookStateReported` | inbound method `pane.report_agent`; surfaces as `pane.agent_status_changed` |
| `HookMetadataReported` | inbound method `pane.report_metadata`; nothing bundled calls it |
| `AgentSessionReported` | inbound method `pane.report_agent_session`; surfaces as `AgentInfo.agent_session` |
| `PaneDied` | the event is `pane.exited`, payload `{pane_id, workspace_id}` |
| `GitStatusRefreshed` | **does not exist, under any name.** `EventKind` is closed at `backend/src/api/schema/events.rs:194-221` |

**Git status is Osade's.** There is no git event to subscribe to, so the daemon runs
`git -C <worktree> status --porcelain` / `diff --stat` itself, debounced, triggered by
verification runs and by `pane.agent_status_changed → done`. This is the §1 carve-out, not a
violation of it: herdr owns worktree *lifecycle*, not reading a directory.

### 7.5 If a signal is genuinely missing

Extend herdr properly: a new declarative rule in `backend/distribution/agent-detection/*.toml`
(21 agents, versioned, remotely updatable via `index.toml`), or a new `Method`/event in
`src/api/schema/`. Do not screen-scrape terminal output from Osade. herdr's detector reads the
bottom buffer rather than the visible viewport (users scroll) and debounces working→idle
across 3 confirmations over 700ms so a momentarily quiet agent does not flicker.
Reimplementing that badly is a guaranteed source of flapping cards.

The one supported exception, **M2 or later**: if Osade wants tool-level activity for Claude
Code, install an *additional* Claude Code hook that calls `pane.report_metadata` using
`HERDR_PANE_ID` and `HERDR_SOCKET_PATH` from the environment. That is herdr's own documented
inbound API, not a parallel system. Token limits apply: ≤16 keys per patch, ≤32 stored, key
`^[A-Za-z0-9_-]{1,32}$` (`backend/src/api/schema/common.rs:3-23`).

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

*Corrected 2026-09-04 per PRD-DELTA #4 and #8.*

**`binary` is advisory.** herdr picks the executable, not Osade:
`interactive_agent_executable` maps a `kind` to a fixed name
(`backend/src/detect/mod.rs:149-181`) — `claude`, `codex`, `gemini`, `kiro-cli`, `agy`,
`cursor-agent(.cmd)`, and so on. Keep the field for **probing** and for a useful "agent not
installed" error; never pass it to herdr. The `kind` string is what herdr accepts, and the
pinned set is:

```
pi codex claude gemini cursor devin agy cline omp mastracode opencode copilot
kimi kiro droid amp grok hermes kilo qodercli qwen maki
```

(§8.1's table wrote `kiro` as `kiro-cli chat`. The kind is `kiro`, the executable herdr runs
is `kiro-cli`, and `chat` is an argument.)

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

**`hook-reporting` is set for `pi`, `opencode`, `kimi`, `kilo`, `omp`, `mastracode` and
cleared for everything else — including `claude` and `codex`** (§7.1). This is exactly the
case the capability was designed for, and it is not a lower tier: the live test showed
screen-manifest detection carrying Claude Code's whole lifecycle correctly. What the two
leading agents lose is `tool_name` and `final_message`, not status.

**PATH matters.** Probe binaries with direct PATH checks and spawn directly. Never shell out to
`zsh -i` to find a binary: with heavy conda/nvm init that freezes the runtime when several
tasks start at once. This bit Kanban; do not rediscover it. Probing is now the *only* reason
Osade cares about the binary path — herdr resolves it independently, so a probe that passes
while herdr's spawn fails means the executable is not on the **server's** PATH.

### 8.2 Launch sequence

*Corrected 2026-09-04 per PRD-DELTA #8 and #11. The old step 7 — "build argv … spawn in the
agent lane" — is not possible: no pane-creating method accepts a command.*

**How `agent.start` actually works.** It does not spawn a process. It resolves `kind` to a
fixed executable, appends `args` (rejecting control characters), shell-quotes the line, and
**types it into an existing idle shell pane**, then waits for its detector to confirm the
agent is interactive (`backend/src/app/agents.rs:145-225`). Three consequences shape the
sequence below: the lane must exist and be at a shell prompt first; **environment cannot be
set at `agent.start`** and must be set when the workspace or tab is created; and a pane hosts
at most one agent.

`packages/daemon/src/domain/launch-task.ts`:

1. Resolve agent: `task.agent_id ?? repo.default_agent ?? config.selected_agent`. On resume,
   the previously used agent wins so a restored task comes back on the same runtime.
2. `git -C <repo> worktree prune`, then ensure worktree (§9), then mirror gitignored-but-needed
   paths into it — **all three before anything is spawned**.
3. `worktree.create` gives the worktree **and** its workspace in one call; record
   `herdr_workspace_id`. The root pane is the `shell` lane.
4. Create the `agent` lane with `tab.create { workspace_id, label: "agent", focus: false,
   env: { OSADE_TASK_ID, … } }`. **This is the only opportunity to set environment** — see
   above. `verify` is created on first verification run, with the same env.
5. Render the launch context (§13.5) to `<worktree>/.osade/CONTEXT.md`.
6. Open the pane-status subscription for the new pane (§7.2) **before** starting the agent, so
   the launch transition is not missed.
7. `agent.start { name, kind, pane_id, args, timeout_ms }`, where `args` carries everything
   from the catalog entry — mode args and system-prompt injection alike.
8. Capture a `turn_checkpoint` with trigger `launch`. Best-effort — **a checkpoint capture
   failure never fails a launch.**

*Corrected 2026-09-05 per PRD-DELTA #13a, found while implementing M0.*

**INVARIANT — `agent.start` is submission, not readiness.** It can return success immediately
with `launch_pending: true` and `agent_status: unknown`, before the agent has rendered
anything; or it can return `agent_not_ready` because herdr's detector saw the trust prompt.
Neither outcome tells you the agent is usable. Step 7 is therefore followed by a bounded wait
on `agent.get` for `interactive_ready && !launch_pending`, answering the trust prompt if it
appears during that wait — one loop, one deadline, because the two interleave. Launch does not
report success until that wait passes; otherwise the very next `agent.prompt` fails.

**Windows: `agent.start` cannot carry args.** herdr submits args through PowerShell's
`Start-Process -FilePath`, which cannot execute an extensionless npm shim — and most agent
CLIs on Windows are npm shims. The pane shows `%1 is not a valid Win32 application`, no agent
appears, and the call still reports success. So on Windows the agent starts **bare** and the
launch context is delivered through `<worktree>/.osade/CONTEXT.md` per §13.5. Mode args are
lost; report that rather than hiding it.

**Error codes from step 7 need distinct handling; only the first is routine**
(`backend/src/app/agents.rs:228-260`):

| Code | Meaning | Response |
| --- | --- | --- |
| `agent_not_ready` | started, but blocked or not interactive within `timeout_ms` | usually the trust prompt — §8.3, then re-wait |
| `agent_pane_busy` | pane already hosts an agent, or is not at a shell prompt | fresh pane, or `pane.close` first |
| `unsupported_agent_kind` | `kind` not in the pinned set | catalog bug; fail the launch |
| `invalid_agent_argument` | control char in an arg, or unquotable for the shell | catalog or context bug; fail the launch |
| `agent_pane_not_found` / `agent_pane_unavailable` | bad pane id, dead terminal | reconcile against `session.snapshot` (§5.4.1) |
| `invalid_agent_name` / `duplicate_agent_name` | name rules | derive the name from `task.id` |

### 8.2.1 Relaunch after a herdr restart

herdr restores panes but not agent processes (§6). On reconnect, for every task whose
workspace exists and whose pane has no bound agent:

1. Reconcile from `session.snapshot` first — do not act on an event alone.
2. Re-run `agent.start` in the restored pane. It is back at a shell prompt, so
   `agent_pane_busy` will not fire.
3. Use the catalog's `resumeArgs` plus the `agent_session_id` recorded in `agent_fact`, when
   the agent has the `resume` capability. Without it, relaunch cold with the task intent.
4. Never set `terminated`. The task is `queued`, not `stopped`.

### 8.3 First-run trust prompts

Claude and Codex show a "do you trust this folder?" prompt, and Osade's cwd is a freshly created
worktree every single time, so this fires constantly.

*Confirmed 2026-09-04 per PRD-DELTA #13.* This fired on the very first launch into a fresh
worktree: `agent.start` returned `agent_not_ready` and herdr's detector classified the pane
`blocked` — correctly, with no Osade screen-scraping. The verified recipe, entirely within
herdr's API:

*Corrected 2026-09-05 per PRD-DELTA #13a.2b — the original recipe here was unsafe.*

**INVARIANT — read the selection; never navigate blind.** Keystrokes sent while the TUI is
still painting are dropped silently, and the prompt defaults to `❯ No, exit`. A dropped `Down`
therefore puts `Enter` on *decline*: Claude exits, and the launch fails ninety seconds later
looking like a timeout. Osade will have declined the folder on the user's behalf and reported
something else.

```
loop (bounded, ~5 attempts):
  selection = read the selector out of pane.read { source: "visible" }
  null      → no live prompt (options with no ❯ are stale scrollback); stop
  'trust'   → pane.send_keys { keys: ["Enter"] }; done
  'decline' → pane.send_keys { keys: ["Down"] }, wait, re-read
```

Then wait for `agent.get` to report `interactive_ready` (§8.2). If the selection never reaches
the trust option, **stop and leave it for a human** rather than pressing Enter hopefully.

**Match the specific prompt; never auto-confirm a `blocked` state generically.** Any other
`blocked` is §6 row 4 — the user is being asked something, and answering it for them is the
one thing this product must not do.

If herdr's manifest can't express the match, add a rule to
`backend/distribution/agent-detection/*.toml` upstream rather than adding output scanning to
Osade.

---

## 9. Worktrees

herdr already makes git worktrees first-class workspace containers, with creation, opening and
removal guarded against active agent panes (`src/worktree.rs`, `src/workspace/git/`). **Osade
calls herdr for worktree lifecycle. It does not shell out to `git worktree` itself.**

*Corrected 2026-09-04 per PRD-DELTA #10. Three of these six rules are not herdr's and must be
implemented by Osade; the annotations say which.*

What Osade owns is the *policy*, and these rules are hard-won — they come from Kanban destroying
user work by getting them wrong:

1. **An existing worktree is authoritative.** Never compare worktree HEAD against a moved base
   branch and recreate. That destroys task progress. Only create *missing* worktrees.
   — **herdr's.** `worktree.open` on an existing path returns `already_open` and never
   recreates.
2. Creation is serialized by a repo-level lock, with a double-check inside the lock.
   — **Osade's.** herdr has no cross-call lock; two concurrent `worktree.create` calls on one
   repo race.
3. Run `git worktree prune` before `add`: an interrupted removal leaves a registration behind
   and `add` then fails with "missing but already registered."
   — **Osade's.** herdr never prunes (`backend/src/worktree.rs:238-320`). This failure *will*
   happen. §1's carve-out exists for this line.
4. The worktree is created on the resolved base commit (`task.base_sha`), then the branch is
   created there. A pinned base means a moving `main` cannot silently change what an agent is
   building against.
   — **herdr's, by outcome.** It runs `git worktree add -b <branch> <path> <base>` for a new
   branch and `git worktree add <path> <branch>` for an existing one. This section previously
   specified `--detach`-then-branch; that mechanism is not what herdr does and Osade cannot
   control it. Verified: `base: 089a586` produced a worktree on the new branch at exactly that
   commit, which is what the rule is for.
5. **Mirror gitignored-but-needed paths** into the worktree: `.env`, `.env.local`, local tool
   configs, and anything in `repo.mirror_paths`. Symlink where possible, copy where the tool
   resolves symlinks. Without this, half of real repos won't even boot in a worktree.
   — **Osade's.** No herdr concept. Must run after `worktree.create` returns and **before**
   `agent.start` (§8.2 step 2).
6. Removal requires: no live pane in the task's herdr workspace, no uncommitted changes, or an
   explicit force with a typed confirmation.
   — **herdr's.** `worktree.remove` refuses a dirty checkout without `force`
   (`backend/src/worktree.rs:214`) and recovers from leftover checkouts (`:343`).
   — *Corrected 2026-09-05 per PRD-DELTA #13a.3.* **The teardown order is the reverse of the
   obvious one.** `worktree.remove` is addressed by workspace id, and herdr closes a workspace
   when its last pane closes — so closing every pane first leaves nothing to address
   (`workspace_not_found`), while leaving a live shell inside the checkout makes the directory
   undeletable on Windows (`Permission denied`, even with `force`). Close every pane **but
   one**, move that survivor out of the checkout (`cd ~` works in both POSIX shells and
   PowerShell), then remove. `force` overrides uncommitted changes, never live panes.

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
│   └── surface-host.ts        M1 — creates the utilityProcess + MessageChannelMain
├── surface/                   M1 — deferred, see §4.4
│   └── index.ts               utilityProcess: herdr client socket, bincode frame decode,
│                              posts PaneSurfaceFrame/Patch over the MessagePort
├── preload/
│   └── index.ts               contextBridge: typed daemon RPC handle + port receipt
└── renderer/
    ├── App.tsx                composition root only
    ├── runtime/               trpc client, ws subscription, (M1: surface port hook)
    ├── hooks/                 where behavior lives — not components
    ├── surface/               M1 — canvas cell renderer, damage tracking, input encoding
    ├── state/                 ledger view state, filters, selection (client-only)
    └── components/            mostly presentational
```

*Corrected 2026-09-04 per PRD-DELTA #3.* Everything marked M1 is out of M0 scope: §4.4 defers
the embedded terminal, so M0 ships no utility process, no `MessageChannelMain`, and no cell
renderer. `supervisor/herdr.ts`'s "version guard" is now the boot drift check of §4.1.1 — it
compares protocol and method set, never the version string.

**INVARIANT — the renderer is never the source of truth.** It renders streamed state. It never
computes status (that is §6, in the daemon), never caches a session, never decides a gate. On
reconnect it discards local state and takes the snapshot.

**Startup order**, and it matters.
*Corrected 2026-09-04 per PRD-DELTA #12 and #1.*

1. `app.setPath('userData', ...)` — before anything else touches disk
2. Run the boot drift check (§4.1.1) against the herdr binary about to be used. Fatal on
   protocol or missing-method mismatch, **before** anything is spawned.
3. Adopt-or-spawn the herdr server on the `osade` named session, then wait for `ping`.
   - `HERDR_SESSION=osade` on the server process and on every subsequent call. Verified to run
     concurrently with a user's own `default` session — separate sockets, separate
     `session.json`, no interference (`backend/src/session.rs:10-11`, `:157-185`).
   - **Spawn detached, copying herdr's own recipe** (`backend/src/server/autodetect.rs:188-233`):
     `herdr server` with stdin/stdout/stderr null and `DETACHED_PROCESS` on Windows /
     `setsid` on Unix. Without this the server dies with its parent, and "agents survive the
     app quitting" quietly stops being true. (`ping`'s
     `capabilities.detached_server_daemon` reports whether *this* server was started that
     way — it is a status report, not a platform limit.)
   - **`env_remove('HERDR_STARTUP_CWD')`.** If it is set and the session has no workspaces,
     herdr creates a workspace at that cwd on boot
     (`backend/src/server/headless/bootstrap.rs:89-117`) and Osade inherits a stray workspace
     it did not create.
4. Spawn the daemon; wait for its ready handshake (never a fixed sleep)
5. Create the window; renderer connects to the daemon. **No surface port in M0** (§4.4).

**Shutdown:** quitting the window detaches. It does **not** stop herdr and does **not** stop the
daemon. Agents keep running. Add an explicit "Stop everything" menu item and a tray state so
this is discoverable rather than surprising.

**Vendoring herdr:** ship a prebuilt herdr binary per platform in `vendor/herdr/<target>/`.
Do not build it at install time — herdr requires Zig 0.15.2 as a hard build dependency for
`libghostty-vt`, which is not an acceptable user prerequisite. Pin the version and verify a
checksum at boot.

### 18.2 Surface transport — DEFERRED PAST M0

*Corrected 2026-09-04 per PRD-DELTA #3. §4.4 reverses the embedded-terminal decision; this
section is the M1 design, kept because it is still correct for when the gate opens.*

M0 ships no `surface/` utility process and no `MessageChannelMain`. The `apps/desktop/src/`
tree in §18.1 drops `surface/` and the renderer's `surface/` directory until then.

When it comes back:

```
herdr client socket  ([u32LE len][bincode] frames — §4.3)
   └─ utilityProcess: EndpointControl handshake (advertise gen 1), negotiate
      shell.snapshot.v1 + shell.surface.v1 + shell.input.semantic.v1,
      decode ServerMessage frames
        └─ port.postMessage(frame)  ── MessageChannelMain ──► renderer
             └─ cell buffer + damage rects → canvas draw on rAF
```

Three things §18.2 originally assumed that are false, and which the M1 design must carry:

- The frames are **bincode**, not JSON (§4.3). The utility process owns a decoder pinned to
  the vendored herdr, with a boot assertion that a known frame decodes.
- A connection delivers **one composited tab**, not one pane (§4.4). So there is one
  connection per visible *surface*, LRU-capped at 3, each pinned to its task's workspace and
  tab via the connection-local projection (`backend/src/server/clients.rs:174-175`).
- Because a connection is per-tab, the "several viewers of one PTY" case that motivated the
  backpressure design mostly disappears — a ledger preview and a detail view of the same task
  are the same tab and should share one connection rather than open two.

Input goes the other way as `shell.input.semantic.v1`. Handle: kitty keyboard protocol,
bracketed paste, dead-key composition. herdr handles these explicitly on its side; the client
must not mangle them on the way in.

Backpressure, where viewers do diverge: track per-viewer acknowledged bytes; pause the shared
stream when the slowest viewer exceeds a high-water mark and resume only when the *last* slow
viewer drains below the low-water mark. Kanban's numbers are a reasonable starting point:
16 KiB high, 4 KiB low, 4ms batch interval with a fast path for chunks under 256 B.

**Terminals are parked, not unmounted.** Keep surface canvases in a hidden root and move them,
so switching tasks never drops or re-subscribes a session. Kanban learned this; it is not
optional.

**And note §4.4's INVARIANT:** attaching any client marks panes seen, which flips `done` to
`idle`. That is safe only because `idle` is inert (§6.1). Do not change that when this lands.

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
├── backend/                       herdr source. READ-ONLY reference for behaviour.
│                                  Never edited, never a codegen input (§4.1).
├── vendor/herdr/<ver>-p<proto>/   THE pinned target: api-schema.json, methods.txt,
│                                  pin.json, and the prebuilt binary per platform
├── patches/                       herdr patches, each with a rationale + upstream link
└── docs/
    ├── OSADE.md                   this file
    ├── HERDR-CONTRACT.md          the verified herdr surface, with citations
    ├── PRD-DELTA.md               where this file was wrong, and why
    └── adr/                       one file per DECISION taken during the build
```

*Corrected 2026-09-04 per PRD-DELTA #14.* `vendor/herdr/` is keyed by
`<version>-p<protocol>`, not by version alone, because the version string is not a contract
(§4.1). herdr's own repo furniture — its `AGENTS.md`, `.github/`, `.agents/skills/herdr-*` —
belongs under `backend/`, not at the Osade root, where it would be read as Osade's own
guidance. CLAUDE.md's rule that herdr's `AGENTS.md` governs `backend/` only depends on it
actually living there.

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

*Corrected 2026-09-04 per PRD-DELTA #15.*

- [ ] Vendor the herdr binary into `vendor/herdr/<version>-p<protocol>/`; generate the typed
      client **from the pinned `api-schema.json`, never from `backend/`**; implement the boot
      drift check (§4.1.1) — protocol and method set, never the version string
- [ ] Daemon: sqlite + migrations + change_log + CDC + ws snapshot/push
- [ ] herdr event subscriber as an **N+1 connection manager** (§7.2), with the monotonic
      `state_change_seq` gate and `session.snapshot` reconciliation on every (re)connect
      (§5.4.1)
- [ ] `deriveStatus` implemented for rows 4, 10, 11, 13, 14 only
- [ ] Electron: userData redirect; supervisor with detached herdr spawn and
      `HERDR_STARTUP_CWD` cleared (§18.1); ledger, task detail, diff view, verification log
      tail. **No utility process, no canvas renderer** (§4.4)
- [ ] One task: create → prune + `worktree.create` + mirror → `tab.create` with env →
      subscribe → `agent.start` → resolve the trust prompt → `agent.prompt`

**Acceptance:** type a prompt and see the row move `queued → implementing → needs_input →
awaiting_review` driven entirely by herdr's detection, with nothing polled and no status
column in the database. Watching the terminal is "Open in herdr" (§4.4); the embedded surface
is M1, behind a gate.

This acceptance criterion is unchanged in substance — it never depended on rendering a cell.
The full path was already verified end-to-end against a live herdr with no client attached
(`docs/HERDR-CONTRACT.md` §3.3); M0 is building the daemon and UI around a spine that is known
to work.

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
   code differ. *2026-09-04: the whole M0 path is verified working on Windows 11 —
   named-pipe JSON API from Node, headless server, worktrees, `agent.start`, status stream.
   The argument for going Unix-only is weaker than when this question was written.*
5. ~~**Surface renderer performance.** If the canvas renderer cannot hold 15 panes at 60fps,
   take the `TerminalAnsi` + xterm.js fallback.~~
   **Closed 2026-09-04 per PRD-DELTA #3.** The fallback does not exist — `TerminalAnsi` is
   negotiated only on herdr's private `TerminalHello` path and endpoint shells are hardcoded
   to `SemanticFrame`. The question is moot for M0 because §4.4 defers the embedded terminal
   entirely. It returns at the M1 gate, and the target must then be re-derived in *tabs*, not
   panes: a connection renders one composited tab, so "15 panes" was never the unit.

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