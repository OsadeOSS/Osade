# Osade — Architecture

How Osade is actually built: the processes, the boundaries between them, the data model, the
invariants that hold the whole thing together, and where each of those is enforced in code.

This is the *descriptive* document — it describes the system as it exists in this tree.
[`docs/OSADE.md`](OSADE.md) is the *prescriptive* one: the full spec, with numbered sections
(`§n`) that the source comments cite. Where this document and the code disagree, the code is
right and this document is a bug. Where this document and the spec disagree, the spec is
describing an intent that may not be implemented yet — §18.2 (surface transport) is the main
live example, and it is called out below.

Section markers like `§5.4` throughout are pointers into `docs/OSADE.md`.

---

## 1. What the architecture is optimising for

Osade is a local-first desktop workspace for running several coding agents on real repositories.
It ships no model and no agent — it drives the agent CLIs already on the user's `PATH`.

The design goal is not throughput. It is stated in §0.1:

> Reduce the maintainer's review cost per contribution to the point where an agent-assisted PR
> is cheaper to review than a human one.

Almost every structural decision below follows from that sentence. Verification, evidence-cited
conventions and human approval gates are load-bearing rather than optional features, because they
are what produce a *reviewable* contribution. Features that only make agents produce more output
are deliberately deprioritised.

Two consequences shape the topology directly:

- **Agents must outlive the window.** A run that dies when someone closes a laptop lid is not a
  contribution pipeline. So the long-lived state does not live in the UI process.
- **Nothing public happens without a human.** Commits, pushes, PRs, comments and reviews are all
  gated, and Osade never merges (§1 non-goal 3 — there is no merge method in `scm/writes.ts` and
  there must not be one).

---

## 2. Process topology

Four processes, three of which can outlive the window. The Electron app is a client of the other
two; it is not where the system lives.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Electron  (apps/desktop)                                                     │
│                                                                              │
│  main process      supervisor: adopt-or-spawn substrate + daemon,            │
│                    safeStorage GitHub token, OAuth device flow, window,      │
│                    zoom, folder picker, deep-link `osade .` re-scoping       │
│       │ contextBridge (preload/index.ts) — no Node, no fs, no sockets        │
│  renderer (React)  chats, lanes, files, diff, checks, gates, composer,       │
│                    xterm shell view                                          │
└───────┬──────────────────────────────────────────────────────────────────────┘
        │ tRPC over HTTP + WebSocket — 127.0.0.1 only
        │ port read from ~/.osade/daemon.port
        v
┌──────────────────────────────────────────────────────────────────────────────┐
│ Osade daemon  (packages/daemon)  Node >= 22, long-lived, survives the window  │
│                                                                              │
│  server/     http + ws + tRPC router + CDC broadcaster                       │
│  domain/     tasks, launch, chat turns, gates, verification, checkpoints,    │
│              triage, git, files, PTY shells                                  │
│  scm/        the only place an SCM SDK may be imported                       │
│  knowledge/  conventions miner, context file, memory                         │
│  substrate/  the only place the runtime socket may be opened                 │
│  db/         SQLite + migrations + change_log triggers                       │
└───────┬──────────────────────────────────────────────────────────────────────┘
        │ JSON API, one request per connection, unix socket / Windows named pipe
        v
┌──────────────────────────────────────────────────────────────────────────────┐
│ osade-runtime  ("the substrate")  vendored Rust binary, headless server       │
│   owns: PTYs, VT parsing, panes, tabs, workspaces, git worktree lifecycle,   │
│         agent process detection, agent hooks, session persistence            │
│   sockets: ~/.osade/runtime/osade/osade.sock         (JSON API)              │
│            ~/.osade/runtime/osade/osade-client.sock  (private bincode)       │
└───────┬──────────────────────────────────────────────────────────────────────┘
        │ spawns and observes
        v
   agent CLIs: claude · codex · opencode · pi   (whatever the user installed)
```

Plus one more entry point that is not a process of its own:

```text
osade  (packages/cli)  →  reads ~/.osade/daemon.port  →  same tRPC surface as the renderer
```

### 2.1 Why the daemon is separate from Electron main

§2's decision note: agents must survive the app quitting, and so must GitHub polling,
verification runs and the conventions miner. The substrate already survives client detach; if
the domain logic lived in Electron main, half the system would die with the window. Splitting it
out also produces the `osade` CLI for free, which is the coordination surface agents themselves
use (§17, and §15 below).

### 2.2 Why the daemon runs on Node rather than Electron's Node

`apps/desktop/src/main/supervisor/daemon.ts` documents this at length. `better-sqlite3` is a
native addon compiled for one ABI — `NODE_MODULE_VERSION` 127 for Node 22 against 130 for
Electron 33 — and the daemon also has to run standalone under the CLI and the test suite. One
runtime, one build. `ELECTRON_RUN_AS_NODE` is the fallback when no Node is found, not the plan,
and it fails loudly because native modules will still be wrong.

A packaged build therefore ships a **Node runtime** alongside Electron
(`scripts/fetch-node-runtime.mjs`, `extraResources` in `electron-builder.config.cjs`).

### 2.3 What the renderer can and cannot reach

The preload surface (`apps/desktop/src/preload/index.ts`) is deliberately tiny: daemon port, a
log sink, the "open in the substrate" hint, the opened repo, GitHub sign-in status/login/device
prompt, the OS folder picker, zoom, and a repo-opened subscription. No Node, no filesystem, no
substrate sockets. Everything else the renderer needs it asks the daemon for over loopback —
including the file tree and diffs (`domain/files.ts`), because the renderer has no filesystem
access at all.

### 2.4 Deviation from the spec: §18.2 surface transport

§2 and §18.2 describe an Electron `utilityProcess` that opens the substrate's client socket and
hands a `MessageChannelMain` port to the renderer, so terminal cell frames bypass main IPC.
**That is not implemented in this tree** — there is no `utilityProcess` or `MessageChannelMain`
anywhere in `apps/desktop`, and ADR 0001 deferred the embedded terminal past M0.

What exists instead:

- **Agent panes** are not rendered in-app. `taskTranscript` reads at most ~1 Hz from
  `pane.read`, and "watch it live" means attaching a real terminal client to the same session
  (`osade:open-in-substrate` returns the command).
- **A lane shell** *is* embedded, but it is not a substrate pane. `domain/task-shell.ts` spawns
  a `node-pty` PowerShell / `$SHELL` in the lane's cwd inside the **daemon**, and the renderer
  drives it over ordinary tRPC procedures (`taskShellOpen` / `Read` / `Write` / `Resize` /
  `Close`) into xterm (`renderer/LaneTerminal.tsx`). Killing that shell does not touch the agent.

---

## 3. Repository layout and the package graph

```text
apps/desktop           Electron: main / preload / renderer (React 19 + Vite)
packages/contract      zod schemas — the ONLY cross-boundary types
packages/daemon        the daemon (and `osade-daemon` via src/cli.ts)
packages/cli           the `osade` binary
backend/               the substrate's Rust source, vendored for reading (ADR 0002)
vendor/runtime/<pin>/  the pinned API schema, method list, licences, binaries (not committed)
scripts/               codegen, vendoring, packaging, install helpers
docs/                  OSADE.md (spec), chat.md, this file
build/                 icon sources
.osade/rules.md        this repo's own agent-facing rules
```

Dependency direction, strictly one-way:

```text
contract  ←  daemon  ←  cli
   ↑           ↑
   └──── desktop/renderer (types only; never imports daemon code — lint-enforced)
```

`@osade/contract` is `main: ./src/index.ts` — it is never built, it is bundled into its
consumers. The daemon and the CLI are each bundled to a single `dist/*.js` by
`scripts/bundle.mjs` (esbuild), with `better-sqlite3`'s addon shipped beside the bundle and
located via `OSADE_SQLITE_BINDING` (`packages/daemon/src/db/index.ts`).

---

## 4. The substrate boundary

Osade does not reimplement terminals. §1 non-goal 2 forbids reimplementing PTY handling, VT
parsing, terminal emulation, worktree creation, agent process detection or session restore, and
§1 non-goal 1 forbids forking the substrate.

### 4.1 The pin is a (protocol, method set) tuple — not a version string

`vendor/runtime/0.8.2-p20/pin.json` records the identity of the substrate Osade was written
against:

| field | value |
| --- | --- |
| version | `0.8.2` (a **label**, never compared) |
| protocol | `20` |
| method count | `91` |
| schema | `api-schema.json`, sha256 pinned, captured with `osade-runtime api schema --json` |
| binaries | not committed (~91 MB); sha256 per release asset |

The `$comment` fields in that file explain why: two builds both report `0.8.2` with different
protocols and a ten-method gap (PRD-DELTA #1). So the directory name is `<version>-p<protocol>`
and `compare_on: [protocol, method_set]`, `never_compare_on: [version]`.

### 4.2 Codegen, not hand-writing

`scripts/generate-substrate-client.mjs` compiles the five top-level schemas in the bundle
(`request`, `success_response`, `error_response`, `event`, `subscription_event`) into
`packages/daemon/src/substrate/generated/`. Method names are never typed by hand. `backend/` is
reference reading for *behaviour* — it is where the `file:line` citations in the source comments
point — and is **never** a codegen source.

`pnpm substrate:codegen:check` fails CI if the generated output would change, and it is the
first thing `pnpm check` runs.

### 4.3 The boot drift check

`substrate/drift-check.ts` runs before the daemon's first API call, against the binary that is
actually about to be used:

1. `live.protocol === pinned.protocol` → **fatal**
2. `methodSet(live) ⊇ methodSet(pinned)` → **fatal**
3. `methodSet(live) \ methodSet(pinned)` non-empty → **warn only**

Assertion 3 warns rather than fails deliberately: otherwise every substrate upgrade becomes an
outage. A checksum match on the vendored binary is not a substitute — it proves the file is the
one that was pinned, and says nothing about what is on a user's `PATH`.

### 4.4 Socket topology and state containment

Socket paths are **Osade's**, not discovered from the runtime's own config directory. The
supervisor passes `<PREFIX>_SESSION`, `<PREFIX>_SOCKET_PATH` and `<PREFIX>_CLIENT_SOCKET_PATH` at
spawn, where `<PREFIX>` is derived from `license.upstream_repository` in `pin.json`
(`substrate/socket-path.ts`, mirrored in `main/supervisor/substrate.ts`). That is what keeps
everything under `~/.osade` (§2.2).

Osade runs the substrate on a **named session** (`osade`) so it never collides with a user's own
session, and deletes `<PREFIX>_STARTUP_CWD` from the spawn environment — otherwise a session with
no workspaces gets a stray workspace at boot that Osade never asked for.

Platform note that has cost time before: on Windows these are **named pipes**, not files. The
whole path is mapped through `GenericNamespaced`, so Node connects to `\\.\pipe\C:\…\osade.sock`.
The `.sock` path also exists on disk as a marker file, **and its presence does not mean a server
is listening** — liveness is always a `ping` round trip (`toConnectTarget`, `ping()`).

### 4.5 One request per connection

`substrate/client.ts` opens a socket, writes one line, reads one line, closes. The substrate's
`handle_connection_with_stop` reads exactly one line, dispatches, writes one response and
returns — there is no multiplexing and no keep-alive, so there is deliberately **no connection
pool and no correlation-id router**. Each connection is an OS thread on the substrate side, which
is why the client prefers one blocking call (`agent.prompt` with `wait`) over prompt-then-poll.

Default timeout 15 s; blocking calls pass their own budget (`worktree.create` 60 s,
`agent.prompt` with `wait` 300 s server-side / 310 s client-side).

### 4.6 The event subscriber is an N+1 connection manager

`events.subscribe` is one of the few methods that holds a socket open, and a subscription *is* a
connection — there is no way to add or drop one without opening or closing a socket. Worse,
subscriptions come in two families: global lifecycle events take no parameters, while
`pane.agent_status_changed` **requires** a `pane_id` and rejects a subscription without one. And
`pane.updated` is not a status feed (verified by holding one open across a complete
`working → done` turn and receiving nothing).

So `substrate/event-subscriber.ts` holds:

- **one global connection** for `workspace.*`, `worktree.*`, `tab.*`, `pane.*`
- **one connection per live agent pane** for `pane.agent_status_changed`

~15 concurrent tasks is ~16 connections. `SubstrateEventStream` reconnects with backoff
(250 ms → 10 s), and every reconnect re-reconciles before the stream is trusted again.

### 4.7 Enforced boundaries at this seam

- Only `packages/daemon/src/substrate/**` may import `node:net` or the generated client
  (`no-restricted-imports` in `eslint.config.js`).
- Everything above that directory speaks through the `SubstrateClient` facade.
- `git.ts` documents the §1 carve-out precisely: Osade runs *read-only and maintenance* git
  (`worktree prune`, `status --porcelain`, `diff --stat`, `rev-parse`, `stash`) because there is
  no substrate API and no git event to subscribe to (§7.4). Worktree **lifecycle** — create,
  open, remove — stays the substrate's.

---

## 5. The five invariants

These are the load-bearing rules. Each one has a mechanical enforcement, because an invariant
that depends on a reviewer remembering is not an invariant.

### 5.1 Durable facts only; status is derived (§5.2, §6)

**There is no `status` column anywhere in the database, and there never will be.** Task status is
a pure function over durable facts, recomputed on every read.

What is durable: what the substrate observed (`agent_fact`), what verification returned
(`verify_run`), what GitHub reported (`scm_fact`), what the human decided (`gate_request`), and
the task's own identity (`task`).

Enforced by:

- `eslint.config.js` — `Property[key.name="status"]` is a lint error in `db/**` and
  `contract/src/facts.ts`, so a fact object cannot grow a status field on its way to the database.
- `test/integration/cdc.test.ts` asserts the schema has no such column.
- `test/unit/lint-rules.test.ts` asserts each selector actually fires (flat config *replaces*
  rule options, so a second block naming the same rule would silently discard the first).
- The one deliberate naming deviation is recorded: `convention.lifecycle` exists because §5.3
  called it `status`, and the blanket "no column named status" rule is what makes §6 unbreakable
  (PRD-DELTA #16, documented in `db/migrations.ts`).

The payoff: **a flaky probe cannot kill a live agent.** A failed probe writes `probe_failures`
and nothing else; a failed GitHub fetch writes `fetch_failed_at` and nothing else. Neither can
look like a state change, because state is not a thing that gets written.

### 5.2 One event path (§5.4)

Every mutation reaches the UI through a SQLite trigger into `change_log`, which a poller tails
and fans out. **`server/cdc-broadcaster.ts` is the only place a websocket message is emitted.**

Enforced by a lint selector that rejects `socket.send(...)` outside the server directory, with
the message: *write to the database; the CDC broadcaster fans it out*. If the UI did not update,
the mutation did not go through the database — and adding an emit is not the fix.

### 5.3 The monotonic fact gate (§5.4.1)

The substrate replays its 512-entry ring buffer on connect, can drop events silently, and its
subscription envelopes carry **no sequence number**. Two guards, neither optional:

1. Every `agent_fact` write is gated on `state_change_seq` being strictly greater than what is
   stored, and the patch plus the counter land in **one transaction**
   (`event-subscriber.ts`, `#apply`). A fact stored without advancing the counter, or a counter
   advanced without the fact, reintroduces the bug.
2. Every connect and reconnect **reconciles against `session.snapshot`** before the stream is
   trusted.

Where the substrate supplies a counter (`AgentInfo.state_change_seq` in the snapshot) it is used
verbatim; where it does not (the subscription envelope) a per-task monotonic sequence is
synthesised, and the next reconcile re-anchors to the authoritative one. A session binding
carries no `seq` at all, because it is not a state change and must not advance the counter
(`domain/agent-reducer.ts`).

The reducer itself is pure: `(facts, input) -> factPatch`, no I/O, unit-tested.

### 5.4 State containment (§2.2)

Everything Osade writes lives under `~/.osade/` — including Electron's `userData`.
`app.setPath('userData', …)` is the first executable statement in `main/electron.ts`, before
`app.whenReady()` and before anything touches disk. No `~/Library/Application Support`, no
`%APPDATA%`, ever. `rm -rf ~/.osade` really does reset the system.

```text
~/.osade/
├── osade.db              SQLite: facts, change_log, conventions, memory + FTS5
├── daemon.port           where the daemon is listening (CLI + Electron read this)
├── daemon.pid
├── config.json           non-secret prefs
├── electron/             Electron userData + sessionData
├── runtime/osade/        the substrate's sockets for Osade's named session
├── logs/app.log, logs/<date>.log
├── runs/<run_id>/        verification stdout/stderr, capped + rotated
├── review/<review_id>/   reviewer gateway neutral home (§16)
├── skills/               agent-facing skill assets
├── worktrees/<repo>/<task_id>/
└── tasks/<task_id>/CONTEXT.md   (attached lanes; isolated lanes get
                                  <worktree>/.osade/CONTEXT.md instead)
```

Every path in the daemon comes from `paths.ts`, so the invariant is checkable in one file rather
than trusted across a dozen call sites. `OSADE_HOME` relocates the whole tree (tests, the e2e
harness, and `pnpm smoke` use it).

### 5.5 Nothing public without a gate (§14)

Every write to a public surface is a `gate_request` row first. The payload is hashed at request
time and **re-hashed at execution**; a mismatch aborts. `scm/writes.ts` calls
`gates.assertExecutable` immediately before each write — hashing at request time proves nothing
if nobody checks at execution time.

Network posture backs this up: the daemon binds `127.0.0.1` only, there is no `0.0.0.0` listener
and no remote mode in v1, and the GitHub token never touches the daemon's config file — it lives
in Electron `safeStorage` and reaches the daemon at spawn over an env handshake, held in memory
only.

---

## 6. Data model

SQLite via `better-sqlite3`, WAL journal, `synchronous = NORMAL`, `foreign_keys = ON`,
`busy_timeout = 10000`. Migrations are numbered, forward-only and applied in a transaction at
boot (`db/index.ts`, `db/migrations.ts`) — a half-applied migration is worse than a failed boot.

### 6.1 Naming — read this before writing any type (§3)

The substrate and Osade both use "workspace" for different things.

| Osade term | Definition | substrate equivalent |
| --- | --- | --- |
| `Org` | a GitHub org or a user grouping of repos | — |
| `Repo` | one git repository on disk + its GitHub remote | — |
| `Task` | one unit of work; 1:1 with a worktree and a substrate workspace | `Workspace` |
| `Lane` | a role inside a task: `agent` / `verify` / `shell` / `review` | `Tab` |
| `Process` | a running program in a lane | `Pane` |

Rule: Osade code never says "workspace" unqualified. It says `Task`, and `substrateWorkspaceId`
for the substrate's. The substrate's vocabulary appears only inside `substrate/`.

Note the second, product-level use of "lane" in `docs/chat.md`: a **chat** is a set of `task`
rows sharing a `chat_id`, and each of those tasks is colloquially "a lane" (one agent, one
checkout, one branch). Both usages are in the code; the table above is the schema-level one.

### 6.2 Tables

**Identity** — `org`, `repo` (path, GitHub owner/name, default branch, upstream remote,
`fork_of`, default agent, verification policy, mirror paths).

**Facts** — the only durable truth:

| table | key | holds |
| --- | --- | --- |
| `task` | `id` | repo, title, intent, origin, agent, `chat_id`, base ref + sha, branch, `checkout_ref`, `worktree_path` (NULL ⇒ attached), `substrate_workspace_id`, `archived_at` |
| `agent_fact` | `task_id` | pane id, substrate state, last event, activity text, agent session id, `pane_alive`, `probe_failures`, `terminated`, `external_block`, `state_change_seq`, `controller_generation`, `composer_ready`, `prompt_surface` |
| `verify_run` | `id` | step, cmd, started/finished, exit code, `required`, **`head_sha`**, log path |
| `gate_request` | `id` | gate name, payload JSON, `payload_hash`, requested/decided/executed, decision, `decided_by`, execution error |
| `scm_fact` | `task_id` | PR number/url/state/head sha/head ref/draft, checks state, review state, unresolved threads, mergeable, `fetched_at`, **`fetch_failed_at`** |
| `turn_checkpoint` | `id` | ref name, sha, trigger (`launch` / `to_review` / `to_in_progress` / `manual`) |
| `chat_turn` | `id` | `(task_id, seq)` unique, role, origin, text, delivery, error |

**Supporting** — `task_lane` (which substrate tab is which role; a separate table because lanes
are created lazily and a row that appears later is cleaner than a column that is null until it
isn't), `verify_plan` (per repo, with `needs_review`), `task_injection` (how many rules were
injected at launch, for the §13.6 measurement — knowable only at launch, not at merge),
`convention` + `convention_evidence` + `mine_run`, `memory` + `memory_fts` (FTS5, with
insert/delete/update triggers).

**CDC** — `change_log(seq AUTOINCREMENT, table_name, row_id, op, at)`. `row_id` is always the
**task** the change belongs to, because the ledger is keyed by task, not by row. The CDC tables
are `task`, `agent_fact`, `verify_run`, `gate_request`, `scm_fact`, `turn_checkpoint` and
`chat_turn`; each gets three `AFTER` triggers generated by `cdcTriggers()`.

### 6.3 Migrations, in order

| # | what it added |
| --- | --- |
| 1 | core tables, facts, `change_log`, CDC triggers |
| 2 | `verify_plan`, `task_lane`, repo verification policy, mirror paths |
| 3 | conventions, evidence, mine runs |
| 4 | `task_injection` (measurement) |
| 5 | mining progress (`phase`, `progress_done/total`) — mining takes minutes, so progress must be durable and visible to a second window |
| 6 | `chat_id` on task, backfilled so existing rows become one-lane chats |
| 7 | table rebuild to make `worktree_path` nullable (attached lanes) + `external_block` |
| 8 | `chat_turn` — typed sends, not pane scrapes |
| 9 | `composer_ready`, `prompt_surface`, turn `error` |
| 10 | `checkout_ref` on task, `pr_head_ref` on scm_fact |
| 11 | `memory` + FTS5 (§15 assumed a vector store; FTS5 needs no embedding model and no key) |

### 6.4 The contract package

`packages/contract` is the only cross-boundary type source: daemon↔renderer, daemon↔CLI,
daemon↔hook. Every tRPC procedure declares `.output()` with a contract schema, so the renderer's
types are **derived, never hand-written**, and nothing crosses a boundary untyped.

`TaskView` is the wire shape: the task row, its facts, plus `status`, `needsYou`, `chatId`,
`agentId`, `attachment` (`repo` | `worktree`), `branch`, `cwd` and `turns`. `status` appears on
the wire and never in the database.

---

## 7. The two paths

### 7.1 The read path

```text
any INSERT/UPDATE/DELETE on a CDC table
        │  AFTER-trigger (generated by cdcTriggers() in db/migrations.ts)
        v
   change_log(seq, table_name, row_id = task_id, op, at)
        │  CdcBroadcaster.tick() every 100 ms — indexed range scan, LIMIT 1000
        │  collapse to the latest seq per task
        v
   toTaskView(db, taskId, now)  →  facts + deriveStatus(facts, now)
        │
        v
   ws://127.0.0.1:<port>/ws    snapshot | task.upserted | task.removed | stream.reset
        │
        v
   useLedger()  →  React state  →  the ledger, chats, detail
```

Properties that fall out of this:

- **The client never polls.** Everything after the first snapshot is a push.
- **The client is never the source of truth.** On connect (and on reconnect) it discards local
  state and takes the snapshot. There is no client-side merge of a stale cache with a fresh
  stream (`renderer/useLedger.ts`, §18.1).
- **Gaps are declared, not hidden.** Each message carries a `watermark` (a `change_log.seq`).
  `change_log` is pruned to the last 50 000 rows every 5 minutes; if a client's watermark falls
  off the end, or the poller restarts, the server sends
  `stream.reset { reason: 'watermark_pruned' | 'poller_restarted' }` and the client
  re-snapshots. Cheaper to say so than to lie by omission.
- **Status is recomputed per push**, never cached.

### 7.2 The write path

```text
renderer / osade CLI
        │ tRPC over HTTP (GET ?input= for queries, POST for mutations)
        v
server/router.ts   — zod in, contract schema out
        │
        v
domain service (LaunchTask, Gates, VerifyRunner, Triage, ScmWrites, Knowledge, TaskShells)
        │
        ├──→ substrate JSON API   (panes, worktrees, agents)
        ├──→ git / GitHub / model
        v
     SQLite write  →  trigger  →  change_log  →  (back to the read path)
```

No service emits to the UI. The database *is* the event bus.

---

## 8. Derived status

`domain/derive-status.ts` is pure: no I/O, no clock reads except the injected `now`. Rows are
evaluated in order and the first match wins; the order is deliberate and is not to be changed
without changing the spec.

| # | condition | status |
| --- | --- | --- |
| 1 | PR merged | `merged` |
| 2 | `archived_at` set | `archived` |
| 3 | any undecided gate | **`awaiting_approval`** |
| 4 | substrate says `blocked` | **`needs_input`** |
| 5 | reviewer requested changes, or unresolved threads > 0 | **`review_changes_requested`** |
| 6 | checks failed | `ci_failed` |
| 7 | newest required verify run **for the current head** failed | `verify_failed` |
| 8 | a verify run is open | `verifying` |
| 9 | PR open, nothing above | `pr_open` |
| — | quota / auth block recorded | `blocked_external` |
| 10 | last event was `to_review` | **`awaiting_review`** |
| 11 | substrate says `working` | `implementing` |
| 12 | explicitly terminated | `stopped` |
| 13 | no fact, pane not alive, or workspace exists with no agent state | `queued` |
| 14 | alive, bound, quiet | `idle` |

Bolded rows are the **needs-you set** (`NEEDS_YOU` in `contract/src/primitives.ts`). The ledger
sorts on it, and for someone running eight agents that set is the entire product.

Three subtleties worth internalising:

- **`verify_failed` is scoped to `head_sha`.** A failure against an older commit is stale and
  must not gate. That is what `verify_run.head_sha` exists for; "current head" is the PR head
  when there is one, else the pinned base.
- **`done` and `idle` are not interchangeable.** The substrate reports `done` when a pane is idle
  *and unseen*, `idle` once it has been seen. Only `done` produces the internal `to_review`
  event, which is why `idle` is inert here (§6.1).
- **Row 13 covers substrate restart.** The substrate restores panes but not agent processes, so a
  restored task has a live workspace and a pane with no agent bound. That is work to start, not a
  death (PRD-DELTA #11).

The internal event vocabulary is exactly three values — `to_in_progress`, `to_review`,
`activity` — and adding a fourth requires changing the spec first (§6.1).

---

## 9. Task lifecycle

### 9.1 Chats and lanes

A **chat** is a set of `task` rows sharing `chat_id`. Each is one agent on one checkout with one
branch and one pane. `@claude` and `@codex` on their own lines fan out to separate lanes that
share the transcript (`docs/chat.md`, `renderer/mentions.ts`, `renderer/lanes.ts`).

The **home / plan lane** is a chat whose `chat_id` is `__orchestrator__:<repoId>`. It stays on
the repository checkout even when another chat already holds it. The literal lives in exactly one
file (`contract/src/orchestrator-id.ts`) and a lint selector forbids it anywhere else.

### 9.2 Attached vs isolated

- The **first** chat in a repo attaches to the working tree on whatever branch is checked out:
  `worktree_path` is NULL, `branch` is the current branch. No surprise branch, no worktree the
  user did not ask for.
- Any **additional** chat, and any extra agent in a chat, gets an isolated worktree under
  `~/.osade/worktrees/<repo>/<task_id>` on `osade/<slug>/<agentId>` — so two agents are never
  writing to the same tree. `createTask` forces isolation when an attached lane already exists,
  and reports *why* (`isolatedBecause`) so the UI can say so.
- An isolated lane may instead check out an **existing** ref (`checkout_ref`), which is how a
  review loop lands on a PR's own branch rather than forking it.
- `branchOut` moves an attached lane onto its own worktree, optionally carrying uncommitted
  changes through a stash. It refuses while a pane is live.

### 9.3 The launch sequence (§8.2)

The ordering is load-bearing, and it is **not** the ordering the spec originally had.
`agent.start` does not spawn a process: it resolves `kind` to an executable, appends args, and
**types the command line into an existing idle shell pane**. Three consequences drive everything
below — the lane must exist and be at a prompt first; environment can only be set when the
workspace or tab is created; and a pane hosts at most one agent.

```text
withRepoLock(repo.path)        ← substrate has no cross-call lock; concurrent creates race
 1. attached?  workspace.create { cwd: repo.path }
    isolated?  git worktree prune  →  worktree.create { branch, base, path }
               →  mirror gitignored-but-needed paths into the worktree
 2. persist substrate_workspace_id
 3. tab.create { label: 'agent', env: { OSADE_TASK_ID, OSADE_REPO_PATH } }  ← ONLY env chance
 4. INSERT OR IGNORE agent_fact                   ← so the subscriber can bind pane → task
 5. subscriber.watchPane(taskId, paneId)          ← BEFORE start, or the transition is missed
 6. write CONTEXT.md (conventions + rules + verify steps)
 7. agent.start { kind, pane_id, args }           ← outcome recorded, never trusted
 8. #awaitAgentReady  →  answer the first-run trust prompt if one appears
 9. composer_ready = true  →  flush queued chat turns
10. checkpoints.capture('launch')                 ← best-effort; never fails a launch
```

Step 7's comment is worth repeating: `agent.start` is unreliable **in both directions**. It can
return success immediately with `launch_pending: true` and `agent_status: unknown` before the
agent has rendered anything, and it can return `agent_not_ready` because its own detector saw
`blocked` during startup — which for a fresh worktree is almost always the trust prompt (§8.3).
So readiness is established afterwards by reading the pane, not by trusting the call.

Failures are made legible rather than swallowed: a `worktree.create` failure is captured with a
read-only `git worktree list` / `show-ref` snapshot into the log before the user-facing message
(`could not create a worktree — see the terminal`), and any turn still queued on the task is
failed with the reason.

### 9.4 Relaunch, teardown, undo

- **Relaunch after a substrate restart** (§8.2.1): panes come back, agents do not.
  `relaunchAfterRestart` re-runs `agent.start` into the surviving pane, appending the agent's
  resume args when it has the `resume` capability and a stored `agent_session_id`.
- **Teardown** waits for the pane's cwd to leave the worktree before removing it, prunes, and
  reaps a leftover checkout.
- **Checkpoints** (§9.1): a git ref snapshot under `refs/osade/turns/<task_id>/<n>` on launch and
  on each `to_review` / `to_in_progress` transition. Capture is always best-effort and never
  blocks the agent — a task whose checkpoint failed is a task with less undo history, not a
  failed task. Undo past a large diff has its own gate.

### 9.5 The agent catalog

`domain/agent-catalog.ts`. Adding an agent is a catalog entry plus a detection manifest — no
orchestration changes.

**INVARIANT: capabilities, not identity checks.** Branch on
`entry.capabilities.includes('plan-mode')`, never on `id === 'claude'`. Capabilities today:
`plan-mode`, `resume`, `system-prompt-injection`, `hook-reporting`, `structured-review-output`,
`headless-run`, `reports-final-message`.

`binary` is **advisory** — the substrate resolves the real executable from `kind`. The field
exists only to probe whether the agent is installed and to produce a useful error; it is never
sent to the substrate.

---

## 10. Chat turns — typed sends, not keystrokes

A turn is a durable row, not a terminal paste (`domain/chat-turns.ts`, migration 8).

```text
composer → taskSend → recordTurn(delivery: 'queued')
                          │  composer ready?
                          ├─ no  → stays queued; a ready timeout fails it with a reason
                          └─ yes → delivery: 'sending'
                                   capture pane surface  (prompt_surface)
                                   agent.prompt { target: paneId, text, wait }
                                   delivery: 'accepted'
        substrate reports idle / done / blocked
                          │
                          v
                 onAgentQuiet → settle: capture the surface again
                                store the agent reply
                                flush anything still queued
```

`composer_ready` is a distinct fact from `substrate_state`, because Codex reports `idle` from an
OSC title while a trust dialog is still on screen.

Because most agents do not report a `final_message`, the reply is reconstructed as a **pane
delta** (`domain/pane-delta.ts`): the surface at send, the surface at settle, minus the overlap,
minus the echoed user text, minus catalog-declared chrome (banners, prompt glyphs, status
footers). The overlap search is a suffix search rather than "look for the last 400 chars",
because Claude and Codex both end on the same footer and the naive version produced an empty
delta every time. The renderer never scrapes a pane to invent a bubble — it draws `task.turns`.

Multi-lane sends: shared preamble + per-agent body, one `agent.prompt` per lane, and each lane
receives a short `<osade_lanes>` digest of what its siblings have done (stripped from the visible
transcript in `renderer/chat.ts`).

---

## 11. Verification

The single largest lever on the §0.1 goal: make an agent's claim checkable **before** it costs a
maintainer anything.

**Deriving the plan** (`domain/verify-plan.ts`, `domain/ci-workflows.ts`) is done from
**evidence, not guesses** — the repo's CI workflows, package manifests and contributing docs.
Every step carries `source` (`ci` | `manifest` | `doc` | `user` | `agent`) and the `evidence` it
was read from, so the UI can cite it. `verify_plan.needs_review` starts at 1: an inferred command
is never run silently the first time. Commands Osade declines to run locally (multi-line scripts,
anything needing runner context) are surfaced too, so a reviewer sees the plan is partial rather
than believing CI had nothing more to say.

**Running** (`domain/verify-run.ts`) happens in the task worktree, in the `verify` lane — a real
substrate tab, so the user can watch and interrupt. One `verify_run` row per step. Logs go to
`~/.osade/runs/<run_id>/`, capped at 2 MiB with head (512 KiB) + tail retention.

**The loop is the product.** On failure, the tail (60 lines) plus the failing command goes back
into the agent lane as an `automation`-origin turn. *Agent acts, environment answers, agent
adapts.* The wiring lives in `daemon/src/index.ts` rather than inside the runner, so the
dependency points one way: the runner knows nothing about launching.

Policy: verification is required before `gate.pr_open` can be approved. That default is
overridable per repo, and the override is **recorded** (`verify_override_reason`) rather than
silent.

---

## 12. GitHub

`packages/daemon/src/scm/**` is the only directory permitted to import an SCM SDK, enforced by
lint. Everything above it speaks in facts, not Octokit types.

**Reads** (`scm/poller.ts`): v1 is local-first with no public ingress, so there are no webhooks —
this polls. PRs every 30 s, issues every 5 minutes, conditional requests with `NOT_MODIFIED`
handling, and a back-off below 20 % of the remaining rate limit.

**INVARIANT: a failed fetch is a fact, not a state change.** A failed poll writes
`fetch_failed_at` and changes nothing else — the same discipline as the failed probe. Transient
GitHub trouble must never look like a PR closing, checks failing, or a review being withdrawn.

A reviewer's `changes_requested` loops back into the agent lane, the same shape as a verification
failure and for the same reason: a review comment that only lands in the database is a comment
the agent never sees.

**Writes** (`scm/writes.ts`): every one is a gate request first, hashed at request and re-hashed
at execution. Fork awareness is handled here too — contributing from a fork sets the PR head to
`owner:branch`, and creating the fork is itself a gate.

**Token handling**: Electron `safeStorage` (`main/secrets.ts`), GitHub device flow or reuse of an
existing `gh auth login` (`main/oauth.ts`), passed to the daemon at spawn as
`OSADE_GITHUB_TOKEN` and held in memory only. Changing the token restarts the daemon, because
that is the only way a new one reaches it.

---

## 13. Knowledge — conventions, context, memory

The thesis (§13.1): what gets a PR merged is not code correctness, it is conformance to a
project's tacit rules — and those rules exist in the record, in review comments, in what got
rejected, in the difference between what was submitted and what was merged.

### 13.1 The corpus

`scm/corpus.ts` is the only file that knows the miner's inputs come from GitHub; everything under
`knowledge/` works on neutral records, which is what makes the pipeline testable against
fixtures. Default sample: 200 merged + 100 closed-unmerged PRs, plus `CONTRIBUTING.md`,
`AGENTS.md`, `CLAUDE.md`, `CODEOWNERS` and PR templates. **The budget is the design constraint** —
each PR costs two extra requests for its review threads, and exhausting the hour's quota would
leave the PR poller unable to answer whether a task's own PR is still open, which matters more.
So it stops early and returns a partial corpus.

### 13.2 Three passes, and the code decides

`knowledge/passes.ts` + `knowledge/miner.ts`: **extract → cluster → verify**, three bounded model
calls with the code checking the work between them. Not one mega-prompt — a single call has no
point at which thresholds can be checked, and a prompt that says "a rule needs three
observations" is a suggestion where a filter that counts them is a guarantee.

Enforced in code, not asked for in a prompt:

- ≥ 3 observations from ≥ 2 distinct PRs, **or** ≥ 1 from CI config / CODEOWNERS
- the held-out sample (25 % of merged PRs) is genuinely held out — never shown to extract
- **the model may only cite URLs that were in its input**; unmatched citations are dropped
- a rule the held-out sample contradicts is stored as `rejected`, not dropped — knowing a rule
  was considered and disproved is worth more than mining it again next week

**INVARIANT (§13.1): a rule without evidence is not a rule.** Every convention carries at least
one `convention_evidence` row pointing at a real URL, rejected at *write* time rather than
filtered later. That is the difference between auditable output and another pile of
model-generated guidance.

`ModelPort` is a port, not a client — system prompt, user prompt, token ceiling, text back. No
streaming, no tools, no conversation — so the miner's correctness is testable without a network
or an API key. In practice it is backed by a **headless run of an agent the user already
installed** (`domain/headless-run.ts`, in an empty temp cwd, never the repo), which is why Osade
still ships no model of its own.

Mining is always explicit: it costs quota and minutes, nothing starts it on its own, and
launching a task never waits on it. Progress lives in `mine_run` because an in-memory counter
would vanish on restart and be invisible to a second window.

### 13.3 Injection, and the budget as the feature

`knowledge/context-file.ts` renders `<worktree>/.osade/CONTEXT.md` (or
`~/.osade/tasks/<id>/CONTEXT.md` for an attached lane): the repo slug, the intent, the base, the
pasted `<repo>/.osade/rules.md`, the ranked conventions **with their evidence**, and the
verification steps the work must pass.

**Keep it short — the cap is the feature.** A 200-rule context file is worse than none, because
every rule competes with the task for attention. Rules that do not fit are counted and reported
so the UI can show the overflow, and the count is recorded in `task_injection` at launch (the
only moment it is knowable — by the time a PR merges, the conventions have changed) for the
§13.6 measurement: *review rounds to merge*.

Delivery is capability-driven: agents with `system-prompt-injection` get the file by flag;
others are told where it is in the opening prompt.

### 13.4 Memory

`knowledge/memory.ts` — scoped, provenance-carrying notes retrieved via SQLite FTS5. §15 assumed
a vector store; FTS5 uses what SQLite already ships, so there is no embedding model, no key, and
no `memory_vec` table.

---

## 14. Gates

`domain/gates.ts`. Fifteen named gates, each with a default and an overridability flag:

| gate | default | overridable |
| --- | --- | --- |
| `gate.commit` | auto | yes (human when attached) |
| `gate.push` | human | yes — the first write that leaves the machine |
| `gate.pr_open` | human | yes — requires passing verification |
| `gate.fork_create` | human | **no** — creates a public repo under the user's account |
| `gate.pr_update`, `gate.pr_comment`, `gate.issue_comment` | human | yes — public speech |
| `gate.review_submit` | human | yes — public speech about someone else's work |
| `gate.force_push` | human | **no** — always, no policy override |
| `gate.branch_delete`, `gate.dep_add` | human | yes |
| `gate.file_write_outside_worktree` | human | **no** — should never fire; investigate if it does |
| `gate.undo_turn` | conditional | yes — human if the diff is > 20 files |
| `gate.network_egress` | auto | yes — v1 logs only |
| `gate.branch_switch` | human | yes — a policy may downgrade a *clean* switch |

Mechanics:

- A gate request stores `payload_json` and its sha256. Approval binds **that exact text** —
  editing after approval invalidates it, and `gateEditAndApprove` exists so editing is an
  explicit re-approval rather than a silent mutation.
- Gates expire after 24 h into `decision = 'expired'` (`GATE_TTL_MS`).
- A policy downgrade is recorded as `decided_by = 'policy:<name>'`, so the audit trail never
  loses who decided.
- An undecided gate is row 3 in `deriveStatus` — the loudest thing in the product.

---

## 15. Multi-agent coordination — self-hosting, not a new protocol

§17's decision: **there is no agent-to-agent protocol.** Agents coordinate by driving the same
`osade` CLI a human drives.

Every lane's tab is created with `OSADE_TASK_ID` and `OSADE_REPO_PATH` in its environment (launch
step 3 — the only moment environment can be set). So `osade task send`, `osade task show` and
`osade task read` from inside a lane are attributed and scoped **without the caller asserting an
identity**.

There is no privileged path. An orchestrating agent cannot bypass a gate, because gates live in
the daemon rather than in the caller. Anything an orchestrator can do, a human can do from a
terminal, and vice versa — that symmetry is the point, and it is why the CLI client is a
hand-rolled three-fetch tRPC caller rather than an SDK dependency.

`packages/cli/src/bin.ts` is a shim on purpose: `cli.ts` exports `main` and executes nothing on
import, so a test can drive it and read exactly what a user would have seen. (The "run if I am
the entry point" version was tried and silently did nothing under `vite-node`, where
`process.argv[1]` is the runner.)

---

## 16. The desktop app

### 16.1 Main process

`apps/desktop/src/main/electron.ts`, in order: set `userData` / `sessionData` under `~/.osade`
(first statement, before `whenReady`), tee all logging to `~/.osade/logs/app.log` (a packaged
Windows GUI binary has no console, so a hung boot would otherwise be indistinguishable from a
slow one), adopt-or-spawn the substrate, adopt-or-spawn the daemon, create the window, register
the IPC handlers.

`osade .` from a second repo **re-scopes the existing window** rather than opening another
(`onRepoOpened`).

### 16.2 The supervisors

Both follow the same shape: probe, adopt if healthy, otherwise spawn.

- **Substrate** (`supervisor/substrate.ts`): liveness is a real `ping` round trip, never a file
  check. The spawn copies the substrate's own recipe — null stdio, `detached: true`,
  `child.unref()` — because without it the server dies with the app and "agents survive the
  window closing" quietly stops being true. Binary resolution: `OSADE_SUBSTRATE_BIN` → packaged
  `resources/runtime/<target>/` → checkout `vendor/runtime/<pin>/<target>/` → bare name on PATH.
- **Daemon** (`supervisor/daemon.ts`): health is `GET /health` on the port from the port file, and
  the response carries a **build id** (sha256 of the running entry file). The desktop app refuses
  to adopt a daemon whose build does not match the one it would spawn — otherwise a stale daemon
  from a previous checkout silently serves the new UI. A `.ts` entry is not executable, so a
  source checkout goes through the same dev runner the tests use while a packaged build spawns
  JavaScript directly.

### 16.3 Renderer

React 19 + Vite, one `App.tsx` owning routing and send semantics, with the surrounding components
as views:

| file | role |
| --- | --- |
| `useLedger.ts` | the websocket; snapshot-on-connect, reset-on-gap, no merge |
| `api.ts` | tRPC mutations and on-demand reads; humanises daemon/zod errors |
| `Composer.tsx`, `mentions.ts` | one composer for every surface; `@agent` parsing |
| `Board.tsx`, `lanes.ts`, `status.ts` | the ledger: chats grouped, needs-you first |
| `Detail.tsx`, `Transcript.tsx`, `LaneTerminal.tsx` | chat, transcript, embedded PTY |
| `Files.tsx`, `Changes.tsx`, `highlight.ts` | file tree and diffs, served by the daemon |
| `GateCard.tsx`, `PrOpen.tsx`, `VerifyPlanReview.tsx`, `Conventions.tsx` | the approval surfaces |

The composer stays live across Chat / Files / Checks / Diff / Rules and attaches what is on
screen, so "why did you change this" works while reading a hunk (`compose-attach.ts`).

The renderer **never computes status** and never imports daemon code — a lint rule blocks
`@osade/daemon` and `**/daemon/src/**` from `renderer/**`, types included.

---

## 17. Enforced boundaries

Everything in this table is a lint failure or a test failure, not a review comment.

| rule | where | why |
| --- | --- | --- |
| no `status` property in `db/**` or `facts.ts` | eslint | §6 stays unbreakable |
| no `socket.send` outside `server/**` | eslint | one event path (§5.4) |
| `node:net` and the generated client only in `substrate/**` | eslint | one substrate seam (§4.2) |
| Octokit only in `scm/**` | eslint | one GitHub seam (§11) |
| renderer may not import daemon code | eslint | §18.1 |
| no `console.*`, no `process.exit` in the daemon | eslint | the daemon is a library; `cli.ts` owns both |
| no `any` | eslint | §20.1 |
| no destructuring `process.env`; no `import { argv }` | eslint | a runner can replace them after the module loads — this shipped a real bug once |
| `__orchestrator__` literal in one file | eslint | §17 |
| each selector actually fires | `test/unit/lint-rules.test.ts` | flat config replaces rule options; a silently dropped selector is worse than none |
| generated client matches the pin | `pnpm substrate:codegen:check` | §4.1 |
| live substrate matches the pin | boot drift check | §4.1.1 |
| Rust attribution is current | `pnpm attribution:check` | licence compliance |

Test layout mirrors the risk: `test/unit/` for pure functions (`derive-status`, `pane-delta`,
`chat-turns`, `verify-plan`, `agent-catalog`, `drift-check`, …), `test/integration/` for anything
touching SQLite, the CDC path, gates, the poller or the miner, and `test/e2e/` behind
`OSADE_E2E=1` for the milestone acceptance runs. `pnpm check` is the whole gate:
codegen check → attribution check → lint → typecheck → vitest.

---

## 18. Build, packaging, distribution

```text
pnpm install
node scripts/fetch-substrate-binaries.mjs      # verify sha256 from pin.json; fatal on mismatch
pnpm --filter @osade/desktop start             # builds the daemon, main, renderer; runs electron
```

- **Workspace**: pnpm, `packages/*` + `apps/*`, Node ≥ 22.
- **Bundling**: esbuild via `scripts/bundle.mjs` for the daemon and CLI; Vite for the renderer;
  `tsc` for Electron main (CommonJS — which is why electron-builder packages
  `apps/desktop/package.json`, not the `"type": "module"` root).
- **Vendored runtime**: binaries are **not committed** (~91 MB across five platforms). What is
  committed is a sha256 per release asset; the fetch script downloads, verifies, and **deletes**
  on mismatch rather than leaving a half-verified binary around. `backend/` (the substrate's Rust
  source) stays committed as reference reading and is restorable with
  `scripts/fetch-substrate-source.mjs`, pinned to a **commit**, not a tag — a tag can move, a sha
  is the content.
- **Packaging** (`electron-builder.config.cjs`) ships: the Electron app; the daemon as built JS
  plus `better_sqlite3.node`; a Node runtime; and the substrate binary with the notices its
  licence requires. Nothing in the repo signs anything — `CSC_LINK` and friends come from the
  environment, and `scripts/check-signing.mjs` runs first.
- **CLI install**: `node scripts/install-cli.mjs` puts `osade` on `PATH` on Windows and POSIX.

---

## 19. Failure modes and degradation

The system is built so that a missing dependency degrades a feature rather than the product.

| what is missing / broken | what happens |
| --- | --- |
| substrate not running at daemon boot | not an error — the subscriber warns and reconciles when it can; agents survive the app, so the app must also start when nothing is running |
| substrate protocol drift | fatal at boot with a precise message (missing methods listed); an *extra* method only warns |
| substrate restart | panes restore, agents do not; tasks read as `queued`, and `relaunchAfterRestart` re-starts them with resume args where supported |
| event stream drops or replays | the monotonic gate rejects stale writes; reconnect reconciles against `session.snapshot` |
| a probe fails | `probe_failures` increments; degraded-confidence badge; **nothing is terminated** |
| daemon not running | the renderer shows offline and retries every second; the CLI says so and names the port file |
| stale daemon from another build | not adopted — the build id in `/health` does not match, so it is replaced |
| CDC poller falls behind, or the log is pruned | `stream.reset`, client re-snapshots |
| GitHub unreachable or rate-limited | `fetch_failed_at` written, back-off below 20 % remaining; no derived state moves |
| no GitHub token | everything local still works; SCM reads and writes are unavailable |
| no headless agent on `PATH` | mining is unavailable and says so at boot; every other procedure serves normally |
| no agent installed at all | `requireAgent` fails naming the binary it probed for |
| a checkpoint fails | less undo history; the launch and the turn both continue |

---

## 20. Extending it

- **A new agent**: one `AGENT_CATALOG` entry (id = the substrate `kind`, advisory binary, arg
  sets, `systemPromptFlag`, capabilities, transcript trim patterns) plus a detection manifest. No
  orchestration changes — behaviour branches on declared capabilities, never on which agent it is.
- **A new gate**: add it to `GATES` with a default and an overridability flag, and call
  `gates.assertExecutable` immediately before the write it guards.
- **A new fact**: add a migration; if it belongs on the ledger, add the table to `CDC_TABLES` so
  it gets the three triggers; extend the contract schema; extend `deriveStatus` only if the
  status table actually changes. Never add a column that is a rendered conclusion.
- **A new UI surface**: add a tRPC procedure with a contract `.output()`. If it needs to push, it
  must write to the database — there is no other way in.
- **A substrate bump**: re-vendor with `scripts/fetch-substrate-source.mjs`, re-capture the
  schema into a new `vendor/runtime/<version>-p<protocol>/`, run `pnpm substrate:codegen`, and
  fix whatever the drift check and the type errors surface.

---

## 21. Known deferrals and loose ends

- **ADR 0001 — no embedded terminal.** Watching an agent live attaches a real terminal client to
  the same session. `docs/architechture/adr/` is referenced from the README but does not exist in
  this tree yet; ADR 0001 and ADR 0002 (vendored `backend/` source) are cited from source
  comments and `pin.json` rather than written up.
- **§18.2 surface transport** (utility process + `MessagePort` for cell frames) is unimplemented.
  The embedded terminal that does exist is a daemon-side `node-pty` shell, not a substrate pane.
- **§16 reviewer gateway** has its directory (`~/.osade/review/`) reserved and is otherwise not
  built out.
- **§13.6 measurement** needs N ≥ 10 comparable *merged* tasks on one repository, which nothing
  in the test suite can fake — Osade never merges (`docs/todo.md`).
- **Org workspaces and cross-repo** (§5, M5) are schema-present (`org`) and product-absent.

---

## 22. The shortest version

Six sentences, for someone who has to review a change tomorrow:

1. Four processes; the daemon and the substrate outlive the window, and the window is a client.
2. The substrate owns everything terminal- and worktree-shaped, behind one generated, pinned,
   drift-checked client in one directory.
3. The database stores only facts; status is a pure function recomputed on every read, and there
   is no `status` column anywhere.
4. Every change reaches the UI through a SQLite trigger into `change_log` and out via one
   broadcaster — if the UI did not update, the write did not land.
5. Every fact write from the substrate is gated on a monotonic counter and reconciled against a
   snapshot on every reconnect, because the event stream both replays and drops.
6. Everything that leaves the machine is a hashed, human-approved gate request, and Osade never
   merges.
