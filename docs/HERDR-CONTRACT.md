# herdr Contract — the verified integration surface

> This document records what herdr **actually does**, verified against
> `backend/` source and against a live `herdr 0.8.2` server on this machine.
> Where the two disagree, both are recorded.
>
> Osade's daemon codes against **this** document, not against OSADE.md §4/§7.
> Every claim below carries a `file:line` citation or a transcript of a live call.
>
> Verified: 2026-09-04, herdr `0.8.2`, Windows 11, JSON API protocol `20`.

---

## 0. Two herdrs — read this first

There are two different herdrs in play and they are **not the same code**:

| | version | JSON API protocol | wire `PROTOCOL_VERSION` | methods in schema |
| --- | --- | --- | --- | --- |
| Installed binary (`C:\Users\asus\AppData\Local\Programs\Herdr\bin\herdr`) | 0.8.2 | 20 | 20 | 91 |
| `backend/` source tree | 0.8.2 (`backend/Cargo.toml:3`) | 22 | 22 (`backend/src/protocol/wire.rs:20`) | 101 |

`backend/` is an **unreleased tree ahead of the released 0.8.2 binary**, with the
version string not yet bumped. Ten methods exist in `backend/src` that the
installed binary rejects, and one capability field is missing from the binary's
`ping` response. See PRD-DELTA.md §1 for the list and the consequence.

**Rule for M0:** generate the client from the schema emitted by *the binary Osade
ships*, never from `backend/src`. Command:

```
herdr api schema --json > vendor/herdr/<version>/herdr-api.schema.json
```

---

## 1. Getting the schema

### 1.1 The file OSADE.md §4.1 names does not exist in `backend/`

`backend/docs/` is absent from this checkout. The schema lives at
`docs/next/api/herdr-api.schema.json` in upstream herdr and is `include_str!`'d
into the binary (`backend/src/cli/api.rs:1`), so **`backend/` as vendored here
cannot compile.**

### 1.2 The schema is CI-enforced current

It is not hand-maintained. `backend/src/api/schema/tests.rs:181-206` asserts the
committed artifact byte-equals `serde_json::to_string_pretty` of a document built
live from the `schemars` derives, and regenerates on
`HERDR_UPDATE_API_SCHEMA=1 just test-one generated_protocol_schema_artifact_is_current`.
When the file is present it is authoritative.

### 1.3 Get it from the binary instead

The installed binary embeds and prints its own schema — no repo needed:

```
herdr api schema --json      # full JSON Schema, 265 KB, verified working
herdr api schema             # human summary
herdr api schema --output <path>
```

Document shape (`backend/src/api/schema/tests.rs:32-46`):

```json
{ "$schema": "...", "title": "Herdr API", "schema_version": 1, "protocol": 20,
  "schemas": { "request": …, "success_response": …, "error_response": …,
               "event": …, "subscription_event": … } }
```

Generate TypeScript from `schemas.request` / `schemas.success_response` /
`schemas.event` / `schemas.subscription_event`.

### 1.4 Version guard

`ping` returns version, protocol and capabilities. Live response, `herdr 0.8.2`:

```json
{"id":"p1","result":{"type":"pong","version":"0.8.2","protocol":20,
 "capabilities":{"live_handoff":false,"detached_server_daemon":false}}}
```

`ServerCapabilities` (`backend/src/api/schema/server.rs:16-24`) has three fields;
the released binary omits `endpoint_protocol_generation`. **Treat every
capability field as optional** — a missing field means an older server, not an
error. Gate the boot guard on `protocol` (exact match against the pinned schema's
`protocol`) plus `version`.

---

## 2. Transport

### 2.1 Sockets

| Socket | Path (default session) | Protocol |
| --- | --- | --- |
| JSON API | `<data_dir>/herdr.sock` | newline-delimited JSON |
| Client shell | `<data_dir>/herdr-client.sock` | `[u32LE len][bincode]` |

`data_dir` = `<config_dir>` for the default session, `<config_dir>/sessions/<name>`
for a named one (`backend/src/session.rs:157-185`).

On **Windows** these are not files — `interprocess` maps the path string to a
named pipe (`backend/src/ipc.rs:44-51`). A Node client connects with:

```js
net.connect('\\\\.\\pipe\\' + 'C:\\Users\\…\\herdr.sock')
```

Verified working from Node 22 (`ping` round-tripped). On Unix they are real unix
domain sockets, mode `0600` (`backend/src/server/socket_paths.rs:12`).

The `.sock` path on Windows also exists as a small marker file
(`backend/src/ipc.rs:76`) — its presence does not mean a server is listening.

### 2.2 INVARIANT — the JSON API is one request per connection

`handle_connection_with_stop` reads **exactly one line**, dispatches, writes one
response, returns (`backend/src/api/server.rs:154-300`, reader at
`backend/src/api/server.rs:502`). There is no request multiplexing and no
keep-alive.

Verified live: three requests written back-to-back on one connection produced
exactly one response (`ping`); `workspace.list` and `events.subscribe` on the
same socket were never answered.

Exceptions that hold the connection open:

| Method | Behavior |
| --- | --- |
| `events.subscribe` | streams event lines until the client disconnects |
| `pane.graphics.stream` | streams graphics frames |
| `events.wait`, `agent.wait`, `agent.prompt` (with `wait`), `pane.wait_for_output` | blocks, then writes one response |

**Consequence for the daemon:** `packages/daemon/src/herdr/` opens a fresh
connection per call. Do not build a connection pool or a correlation-id
multiplexer — there is nothing to multiplex. Each connection is one OS thread on
the herdr side (`backend/src/api/server.rs:90-100`), so batch where you can.

---

## 3. Running headless — VERIFIED

### 3.1 The server runs with zero clients, forever

`herdr server` (`backend/src/server/headless/bootstrap.rs:4-87`) starts the JSON
API listener, builds `AppState`, spawns PTYs, and runs the event loop rendering
into an in-memory ratatui buffer. The module doc is explicit: *"Does not enter raw
mode or read stdin … Continues running after client disconnect"*
(`backend/src/server/headless.rs:1-16`).

### 3.2 Pane geometry with no client attached

When there is no foreground client, `effective_size` falls back to
`headless_size` (`backend/src/server/headless.rs:817` and `:828`), which is
`server.headless_cols` × `server.headless_rows`, defaulting to **120 × 40**
(`backend/src/config.rs:79-80`, `:122-128`).

This is the single fact that makes Osade's architecture viable: **panes are sized
and rendered from config, not from an attached terminal.**

### 3.3 Live proof

Full sequence executed against an isolated `osade` session with **no client ever
attached** and no TUI running:

```
$ HERDR_SESSION=osade herdr server &                   # headless, no tty
$ herdr workspace create --cwd <repo> --label osade-task-1
  → {"type":"workspace_created","workspace":{"workspace_id":"w1",…},
     "root_pane":{"pane_id":"w1:p1","scroll":{"viewport_rows":40},…}}

$ herdr pane send-text w1:p1 'echo OSADE_LIVE_CHECK_$$' ; herdr pane send-keys w1:p1 Enter
$ herdr pane read w1:p1 --source recent --lines 12
  → PS …\reporepo> echo OSADE_LIVE_CHECK_$$
    OSADE_LIVE_CHECK_}                       # real PTY, real shell, real output

$ herdr worktree create --cwd <repo> --branch osade/demo-1 --base 089a586 \
      --path <wt> --label 'task demo-1' --no-focus
  → {"type":"worktree_created","workspace":{"workspace_id":"w3","worktree":{…}}}
  $ git -C <wt> status -sb  →  ## osade/demo-1     (HEAD = 089a586, pinned)

$ herdr tab create --workspace w3 --label agent --no-focus   → w3:t2 / pane w3:p2
$ herdr agent start osade-demo --kind claude --pane w3:p2 --timeout 60000
  → {"error":{"code":"agent_not_ready",
      "message":"agent osade-demo is blocked during startup…"}}
  $ herdr pane read w3:p2 --source visible
    → "Quick safety check: Is this a project you created or one you trust?"
       ❯ No, exit  /  Yes, I trust this folder
  $ herdr agent list  →  agent_status: "blocked"      # detection got it right

$ herdr pane send-keys w3:p2 Down ; herdr pane send-keys w3:p2 Enter
  → Claude Code TUI live in the pane

$ herdr agent prompt osade-demo "Reply with exactly PONG…" --wait --timeout 120000
  → {"type":"agent_prompted","agent":{"agent_status":"done",
      "terminal_title":"✳ Pong response","interactive_ready":true,…}}
```

Observed status stream on the pane subscription:

```
04:24:19.933  agent_status=idle      (after trust prompt answered)
04:24:51.977  agent_status=working   (prompt submitted)
04:24:53.890  agent_status=done      (turn complete)
```

`blocked → idle → working → done` is exactly the vocabulary OSADE §6 rows 4, 10,
11 need, and it arrived without a single line of screen scraping in Osade.

### 3.4 Restart behavior

Stopping and restarting the server restores workspaces, tabs, panes **with the
same ids** (`w2`, `w3`, `w3:p2`) and the same cwd — but the **agent process is
gone**: `agent=undefined`, `agent_status=unknown`. herdr restores shells, not
agent processes.

**Consequence:** after a herdr restart the daemon must re-run `agent.start`
(optionally with the catalog's resume args and the `agent_session` id captured
earlier). A restart is not a task death — do not set `terminated`.

---

## 4. Named sessions — VERIFIED

`HERDR_SESSION=<name>` selects an isolated session
(`backend/src/session.rs:10-11`, `:96-101`). Also `--session <name>`, or
`HERDR_SOCKET_PATH` to point at a socket directly
(`backend/src/api/mod.rs:20`, `backend/src/session.rs:173-181`).

Verified: `HERDR_SESSION=osade herdr server` created
`%APPDATA%\herdr\sessions\osade\{herdr.sock,herdr-client.sock,herdr-server.log,session.json}`
and ran **concurrently with the user's own `default` session** with no
interference (`herdr session list` showed both `running`).

`herdr session stop osade` shuts one down cleanly.

**Osade must set `HERDR_SESSION=osade` on the server it spawns and on every API
call.** Note the name `default` is treated as "no name" (`session.rs:99`).

---

## 5. Methods — the ones Osade needs

Wire format: `{"id": "<string>", "method": "<dot.name>", "params": {…}}`.
Enum is `Method` at `backend/src/api/schema.rs:47-263` (`#[serde(tag="method",
content="params")]`). Responses are
`{"id","result":{"type":"<snake_case>",…}}` or `{"id","error":{"code","message"}}`
(`backend/src/api/schema/response.rs:30-44`).

### 5.1 Workspace rooted at a path

```
workspace.create → WorkspaceCreateParams (backend/src/api/schema/workspaces.rs:8-20)
  { source_workspace_id?: string, cwd?: string, focus: bool,
    label?: string, env?: Record<string,string> }
→ result.type = "workspace_created"
  { workspace: WorkspaceInfo, tab: TabInfo, root_pane: PaneInfo }
```

`env` here is the **only** place Osade can inject environment into a task's
processes (see §7.3).

Other workspace methods: `workspace.list`, `workspace.get`, `workspace.focus`,
`workspace.rename`, `workspace.move`, `workspace.move_block`,
`workspace.report_metadata`, `workspace.close` (`{workspace_id, close_group?}`).

### 5.2 Worktree lifecycle

```
worktree.create → WorktreeCreateParams (backend/src/api/schema/worktrees.rs:14-31)
  { workspace_id?, cwd?, branch?, base?, path?, label?,
    focus: bool, trust_repository: bool }
→ result.type = "worktree_created"
  { workspace: WorkspaceInfo, tab: TabInfo, root_pane: PaneInfo, worktree: WorktreeInfo }

worktree.open   → { workspace_id?, cwd?, path?, branch?, label?, focus, trust_repository }
                → "worktree_opened" { …, already_open: bool }
worktree.remove → { workspace_id, force: bool, trust_repository: bool }
                → "worktree_removed" { workspace_id, path, forced }
worktree.list   → { workspace_id?, cwd?, trust_repository }
                → "worktree_list" { source: WorktreeSourceInfo, worktrees: WorktreeInfo[] }
```

`WorktreeInfo` (`worktrees.rs:71-82`): `path`, `branch?`, `is_bare`,
`is_detached`, `is_prunable`, `is_linked_worktree`, `open_workspace_id?`, `label`.

**One call creates the git worktree *and* the workspace.** There is no
"worktree without a workspace".

What herdr actually runs (`backend/src/worktree.rs:238-320`):

- branch does not exist → `git worktree add -b <branch> <path> <base>`
- branch exists → `git worktree add <path> <branch>`
- removal has recovery for leftover checkouts
  (`run_worktree_remove_command_with_recovery`, `backend/src/worktree.rs:343`)
  and refuses a dirty checkout without `force`
  (`checkout_has_dirty_files`, `:214`)

**It does not run `git worktree prune` before `add`.** OSADE §9 rule 3 is not
satisfied by herdr; see PRD-DELTA §6.

### 5.3 Tabs (Osade "lanes")

```
tab.create → TabCreateParams (backend/src/api/schema/tabs.rs:8-19)
  { workspace_id?, cwd?, focus: bool, label?, env?: Record<string,string> }
→ "tab_created" { tab: TabInfo, root_pane: PaneInfo }
```

Also `tab.list`, `tab.get`, `tab.focus`, `tab.rename`, `tab.move`, `tab.close`.
Creating a tab creates its root pane; there is no empty tab.

### 5.4 Panes

```
pane.split → PaneSplitParams (backend/src/api/schema/panes.rs:27-43)
  { workspace_id?, target_pane_id?, direction: "right"|"down",
    ratio?: f32, cwd?: string, focus: bool, right_click, env? }
```

**There is no `command` / `argv` field on any pane-creating method.** A new pane
always runs the user's configured shell. Osade cannot ask herdr to spawn
`claude --permission-mode auto` directly. See §6.

Input:

| Method | Params |
| --- | --- |
| `pane.send_text` | `{ pane_id, text }` |
| `pane.send_keys` | `{ pane_id, keys: string[] }` (e.g. `["Down"]`, `["Enter"]`) |
| `pane.send_input` | `{ pane_id, text?, keys? }` — combined |
| `pane.close` | `{ pane_id }` |
| `pane.read` | `{ pane_id, source: "visible"\|"recent"\|"recent_unwrapped"\|"detection", lines?, format: "text"\|"ansi", strip_ansi }` |
| `pane.process_info` | `{ pane_id }` → shell pid, tty, foreground processes |
| `pane.wait_for_output` | `{ pane_id, source, lines?, match: {type:"substring"\|"regex", value}, timeout_ms?, strip_ansi }` |

`pane.list`, `pane.get`, `pane.current`, `pane.focus`, `pane.rename`,
`pane.resize`, `pane.scroll`, `pane.zoom`, `pane.move`, `pane.swap`,
`pane.selection.read`, `pane.layout`, `layout.export`, `layout.apply` also exist.

### 5.5 Agents

```
agent.start → AgentStartParams (backend/src/api/schema/agents.rs:164-173)
  { name: string, kind: string, pane_id: string,
    args?: string[], timeout_ms?: number }     // 3000 < timeout_ms <= 300000
→ "agent_started" { agent: AgentInfo, argv: string[] }

agent.prompt → { target: string, text: string,
                 wait?: { until?: AgentStatus[], timeout_ms?: number } }
             → "agent_prompted" { agent: AgentInfo }

agent.wait   → { target, until?: AgentStatus[], timeout_ms? }
agent.list   → "agent_list" { agents: AgentInfo[] }
agent.get / agent.read / agent.send_keys / agent.rename / agent.explain / agent.focus
```

`target` accepts a pane id or the agent `name` given to `agent.start`.

`AgentInfo` (`backend/src/api/schema/agents.rs:184-223`) — the fact source for
`agent_fact`:

```
terminal_id, name?, agent?, title?, terminal_title?, terminal_title_stripped?,
display_agent?, agent_status, screen_detection_skipped, state_labels{},
tokens{}, agent_session?, workspace_id, tab_id, pane_id, focused,
launch_pending, interactive_ready, state_change_seq, cwd?, foreground_cwd?, revision
```

`state_change_seq` is a monotonic per-agent counter — **use it to reject
out-of-order fact writes.**

`AgentStatus` (`backend/src/api/schema/common.rs:135-142`):
`idle | working | blocked | done | unknown`. Maps 1:1 onto OSADE §5.2
`agent_fact.herdr_state`; **`done` is a fifth value OSADE.md omits** and it is the
one that means "turn finished" (§6 row 10).

Supported `kind` values (verified from `--help` on the installed binary):

```
pi claude codex gemini cursor devin agy cline omp mastracode opencode
copilot kimi kiro droid amp grok hermes kilo qodercli qwen maki
```

### 5.6 Hook inbound methods

These are called **by agent hook scripts**, not by Osade — but Osade may also
call them (see PRD-DELTA §4):

| Method | Params | File |
| --- | --- | --- |
| `pane.report_agent` | `{ pane_id, source, agent, state: "idle"\|"working"\|"blocked"\|"unknown", message?, seq?, agent_session_id?, agent_session_path? }` | `panes.rs:448-461` |
| `pane.report_agent_session` | `{ pane_id, source, agent, seq?, agent_session_id?, agent_session_path?, session_start_source? }` | `panes.rs:464-476` |
| `pane.report_metadata` | `{ pane_id, source, agent?, applies_to_source?, title?, display_agent?, state_labels{}, tokens{}, clear_* }` | `panes.rs:479-500` |
| `pane.release_agent` | `{ pane_id, source, agent, seq? }` | `panes.rs:518-524` |
| `pane.clear_agent_authority` | `{ pane_id, source?, seq? }` | `panes.rs:509-515` |

`tokens` are constrained: ≤16 keys per patch, ≤32 stored, key
`^[A-Za-z0-9_-]{1,32}$`, values are strings
(`backend/src/api/schema/common.rs:3-23`). Optional `ttl_ms` 1..86_400_000.

### 5.7 Server / session

`ping`, `server.stop`, `server.reload_config`, `server.agent_manifests`,
`server.reload_agent_manifests`, `server.live_handoff` (Unix only),
`session.snapshot`, `notification.show`, `command.invoke`†,
`integration.list`†, `integration.install`, `integration.uninstall`,
`plugin.*` (13 methods).

† present in `backend/src` but **not** in the released 0.8.2 binary.

`session.snapshot` → `SessionSnapshot` (`backend/src/api/schema/session.rs:8-23`):
`version, protocol, focused_{workspace,tab,pane}_id?, workspaces[], tabs[],
panes[], layouts[], agents[]`. **This is the reconciliation call** — use it on
every subscriber (re)connect (§6.4).

---

## 6. Launching an agent — the actual sequence

`agent.start` does **not** spawn a process. It:

1. resolves `kind` to a fixed executable name via
   `interactive_agent_executable` (`backend/src/detect/mod.rs:149-181`) —
   `claude`→`claude`, `codex`→`codex`, `kiro`→`kiro-cli`, `agy` for antigravity,
   `cursor-agent(.cmd)` for cursor, etc.
2. builds `argv = [executable, ...params.args]`, rejecting any arg containing a
   control character;
3. shell-quotes it for the pane's shell (`platform::interactive_shell_command`);
4. **types the resulting command line into the existing idle shell pane** and
   presses enter (`backend/src/app/agents.rs:145-225`, submission at `:213`);
5. waits `timeout_ms` for its detector to confirm the expected agent is live and
   interactive.

Preconditions, all enforced with distinct error codes
(`backend/src/app/agents.rs:228-260`):

| Code | Meaning |
| --- | --- |
| `unsupported_agent_kind` | `kind` not in the supported list |
| `agent_pane_busy` | pane already hosts an agent, or is not at a shell prompt |
| `agent_pane_not_found` / `agent_pane_unavailable` | bad pane id / dead terminal |
| `invalid_agent_argument` | control char in an arg, or unquotable for the shell |
| `invalid_agent_name` / `duplicate_agent_name` | name rules |
| `agent_not_ready` | started but blocked/not interactive within `timeout_ms` |

**Consequences for `launch-task.ts`:**

- The binary name is herdr's, not Osade's. `AgentCatalogEntry.binary` is
  advisory only — if the user's `claude` is at an odd path, put it on `PATH`.
- Everything else in the catalog entry (`autonomousArgs`, `planArgs`,
  `resumeArgs`, system-prompt flags) goes through `params.args` and works.
- Environment must be set when the **workspace/tab/pane** is created
  (`env` map), never at `agent.start`.
- `agent_not_ready` is not a launch failure — it is usually the trust prompt
  (§8). Read the pane, resolve, continue.

---

## 7. Events

### 7.1 Subscribing

```
events.subscribe → { subscriptions: Subscription[] }
```

The connection stays open. First line is
`{"id":…,"result":{"type":"subscription_started"}}`, then one JSON line per event.

Two families of `Subscription` (`backend/src/api/schema/events.rs:16-85`):

**Global — no parameters.** Delivered as `EventEnvelope` `{event, data}`:

```
workspace.created  workspace.updated  workspace.metadata_updated  workspace.renamed
workspace.moved    workspace.reordered  workspace.closed  workspace.focused
worktree.created   worktree.opened    worktree.removed
tab.created  tab.closed  tab.focused  tab.renamed  tab.moved
pane.created  pane.closed  pane.updated  pane.focused  pane.moved  pane.exited
pane.agent_detected     layout.updated
```

**Pane-scoped — require a `pane_id`.** Delivered as
`SubscriptionEventEnvelope`:

```
{ "type": "pane.agent_status_changed", "pane_id": "w3:p2", "agent_status"?: <filter> }
{ "type": "pane.output_matched", "pane_id": …, "source": …, "match": {…}, "lines"?, "strip_ansi"? }
{ "type": "pane.scroll_changed", "pane_id": … }
```

Omitting `pane_id` is a hard error:
`{"error":{"code":"invalid_request","message":"missing field \`pane_id\`"}}` —
verified live.

### 7.2 INVARIANT — agent status comes from the per-pane subscription only

`pane.agent_status_changed` is emitted into the hub on every status transition
and on presentation changes (`backend/src/app/api.rs:647-673`).

`pane.updated` is emitted **only** on agent-name change and a few unrelated
actions (`backend/src/app/api.rs:631-633`, `src/app/agents.rs:60`, `:136`,
`src/app/terminal_titles.rs:73`, `src/app/runtime.rs:66`,
`src/app/api/panes.rs:1756`). It is **not** a status feed.

Verified: a global `pane.updated` + `workspace.updated` subscription, held open
across a complete `working → done` agent turn, received **zero** events for that
turn, while `agent.get` confirmed `done`. Reproduced twice.

**So the subscriber topology is:**

```
1 connection   → global lifecycle
                 (pane.created, pane.closed, pane.exited, workspace.*, worktree.*, tab.*)
N connections  → one per live agent pane, pane.agent_status_changed
```

Open a status connection when `pane.created`/`agent.start` gives you a pane id;
close it on `pane.closed`/`pane.exited`. Each is a herdr-side thread; ~15
concurrent tasks is ~16 connections, which is fine.

`pane.agent_status_changed` payload (`backend/src/api/schema/events.rs:398-411`),
as observed live:

```json
{"event":"pane.agent_status_changed",
 "data":{"pane_id":"w3:p2","workspace_id":"w3","agent_status":"working","agent":"claude"}}
```

plus optional `title`, `display_agent`, `state_labels` when non-empty.

### 7.3 INVARIANT — event delivery replays and can drop

`EventHub` is a **512-entry in-memory ring buffer** polled per subscription
(`backend/src/api/event_hub.rs:13`, `:22`). Two verified consequences:

1. **Replay on connect.** A fresh subscriber immediately receives a burst
   describing state that existed *before* it connected — including
   `workspace_created` for a workspace that had already been **closed**.
   Reproduced on two independent connections. (`stream_subscriptions` intends to
   start at `event_hub.current_sequence()`,
   `backend/src/api/server.rs:697`; observed behavior contradicts it. Filed as
   PRD-DELTA §5.)
2. **Silent loss.** More than 512 events while disconnected → the overflow is
   dropped with no gap marker. There is no sequence number on the delivered
   envelope.

**Therefore:**

- Fact writes must be **idempotent and monotonic**. Gate every agent fact write
  on `AgentInfo.state_change_seq` (or `PaneInfo.revision`); ignore any event
  whose sequence is not greater than what is stored. This is what stops a
  replayed `working` from clobbering a live `done`.
- On every subscriber connect **and reconnect**, call `session.snapshot` and
  reconcile before trusting the stream.
- Nothing here changes OSADE §5.4: reconciliation writes go through the DB and
  reach the UI through `change_log`/CDC like everything else.

### 7.4 What OSADE.md §7 names, corrected

| OSADE.md §7 says | Truth |
| --- | --- |
| `PaneAgentStatusChanged` | ✅ `pane.agent_status_changed` — but pane-scoped subscription only |
| `HookStateReported` | ❌ no such event. Inbound method `pane.report_agent`; it surfaces as `pane.agent_status_changed` |
| `HookMetadataReported` | ❌ no such event. Inbound method `pane.report_metadata`; surfaces via `pane.updated` / `workspace.metadata_updated` `tokens`/`state_labels` |
| `AgentSessionReported` | ❌ no such event. Inbound method `pane.report_agent_session`; surfaces as `AgentInfo.agent_session` |
| `PaneDied` | ❌ the event is `pane.exited` (payload `{pane_id, workspace_id}`) |
| `GitStatusRefreshed` | ❌ **does not exist.** No git-status event of any name. `EventKind` is closed at `backend/src/api/schema/events.rs:194-221` |
| `WorkspaceFocused` | ✅ `workspace.focused` |
| `PaneOutputMatched` | ✅ `pane.output_matched` — pane-scoped, needs a `match` |

### 7.5 One-shot waits

`events.wait` with `EventMatch` (`backend/src/api/schema/events.rs:116-190`)
blocks one connection until a matching event, with `timeout_ms`. Cheaper than a
subscription for launch handshakes. `EventMatch::PaneAgentStatusChanged`
requires both `pane_id` and `agent_status`.

---

## 8. Trust prompts — confirmed on first contact

OSADE §8.3 predicted this; it fired on the very first launch into a fresh
worktree. `agent.start` returned `agent_not_ready` and the pane showed Claude
Code's *"Quick safety check: Is this a project you created or one you trust?"*
selector. **herdr's detector classified it `blocked`** — no Osade screen-scraping
needed to know something is wrong.

The supported resolution, entirely within herdr's API:

```
pane.wait_for_output { pane_id, source: "visible",
                       match: { type: "substring", value: "Is this a project you created" },
                       timeout_ms: 15000 }
pane.send_keys       { pane_id, keys: ["Down"] }
pane.send_keys       { pane_id, keys: ["Enter"] }
agent.wait           { target, until: ["idle"], timeout_ms: 30000 }
```

Verified end-to-end. Do not auto-confirm blindly: match the specific prompt, and
treat any other `blocked` as OSADE §6 row 4 (`needs_input`).

Detection rules live in versioned TOML — `backend/distribution/agent-detection/*.toml`
(21 agents, with `index.toml` for remote updates) and
`backend/src/detect/manifests/*.toml`. Adding a rule upstream is the documented
path if a prompt cannot be matched.

---

## 9. Agent integrations — what each one actually reports

`backend/src/integration/assets/<agent>/`. Verified by reading every asset:

| Reports `pane.report_agent` (state) | Reports `pane.report_agent_session` only | No socket reporting |
| --- | --- | --- |
| kilo, kimi, mastracode, omp, opencode, pi | **claude**, **codex**, antigravity_cli, copilot, cursor, devin, droid, grok | hermes (plugin.yaml), qodercli, qwen |

**Nothing bundled calls `pane.report_metadata`.** `activity_text`, `tool_name`
and `final_message` in OSADE §5.2 have no herdr-native source for Claude Code.

For `claude`, the hook (`backend/src/integration/assets/claude/herdr-agent-state.sh`)
fires on `SessionStart` only, skips subagents, and posts exactly one
`pane.report_agent_session` carrying `session_id` and `transcript_path`. Claude
Code's status therefore comes **entirely from herdr's screen-detection
manifests** — which the live test showed working correctly through
blocked/idle/working/done.

Usable substitutes for `activity_text` today:

- `AgentInfo.terminal_title` / `terminal_title_stripped` — observed as
  `"✳ Pong response"` / `"Pong response"` after a turn. Free, no extra plumbing.
- `AgentInfo.state_labels` and `tokens` — populated only if something calls
  `pane.report_metadata`.

Env injected into every managed pane (`backend/src/pane.rs:115-137`,
`backend/src/integration/env.rs:8-33`), confirming OSADE §7:

```
HERDR_ENV=1
HERDR_SOCKET_PATH=<active api socket>
HERDR_BIN_PATH=<herdr executable>
HERDR_WORKSPACE_ID / HERDR_TAB_ID / HERDR_PANE_ID
```

Osade adds its own via the `env` map on `workspace.create` / `tab.create` /
`pane.split` — this is where `OSADE_TASK_ID` (OSADE §17) goes.

Management: `integration.list`, `integration.install`, `integration.uninstall`,
targets at `backend/src/integration/registry.rs:7-29`.

---

## 10. The endpoint protocol (terminal surfaces)

### 10.1 It is JSON *inside* a bincode frame, not a JSON protocol

Generation 1 is a genuinely stable, version-independent **handshake and control
contract** (`backend/src/protocol/endpoint.rs:1-9`) — but it rides on
`herdr-client.sock`, whose framing is

```
[u32 little-endian length][bincode payload]           backend/src/protocol/wire.rs:1592-1602
```

encoding the Rust enums `ClientMessage` / `ServerMessage`
(`bincode::config::standard()`, `MAX_FRAME_SIZE` = 2 MiB, 32 MiB with graphics).

The handshake is `ClientMessage::EndpointControl { kind, data }` where `data` is a
JSON string (`backend/src/client/handshake.rs:145-170`):

```
client → { kind: "endpoint.hello.v1",   data: EndpointClientHello   }
server → { kind: "endpoint.welcome.v1", data: EndpointServerWelcome }
```

`EndpointClientHello` (`endpoint.rs:25-42`): `generation`, `cell_width_px`,
`cell_height_px`, `surface_size {cols,rows}`, `pixel_mouse`, `direct_graphics`,
`endpoint_keybindings`, `mouse_capture`, and four codec-name arrays. All four
codecs are mandatory (`endpoint.rs:71-84`):

```
shell.snapshot.v1   shell.surface.v1   shell.input.semantic.v1   shell.blob.v1
```

`EndpointServerWelcome` (`endpoint.rs:51-62`) returns the four selected codecs,
`server_version`, and `methods: string[]`.

**Endpoint clients are exempt from `PROTOCOL_VERSION`.** `do_handshake` compares
`generation` and codec names only, never build versions
(`backend/src/client/handshake.rs:219-232`). This is the real guarantee: an
Osade shell built against generation 1 keeps working across herdr upgrades.

**But the payloads are bincode.** `ClientShellSnapshot`, `PaneSurface`,
`PaneSurfacePatch`, `Terminal`, `Graphics` are native enum variants
(`wire.rs:1411`, `:1414`, `:1442`), not JSON. Osade's `utilityProcess` must
implement a bincode reader for `ServerMessage` in TypeScript. See PRD-DELTA §3.

### 10.2 The surface is one composited grid per connection

`PaneSurfaceFrame` (`wire.rs:1213-1225`):

```
boot_id, projection_revision, surface_revision,
frame: FrameData,                 // ONE cell grid for the whole tab
panes: PaneSurfacePane[],         // each pane's rect within that grid
splits: PaneSurfaceSplit[], popup?, graphics
```

`PaneSurfacePatch` (`wire.rs:1244-1254`): `base_surface_revision`,
`surface_revision`, `rows: [{x, y, cells}]`, `panes`, `cursor?`.

So the server sends **herdr's own layout of one tab**, damage-tracked. It does
not stream "pane X's cells" on request. Osade cannot compose 15 arbitrary panes
from different tasks into its own React grid over one connection.

**What makes it work anyway:** each connection carries its **own** workspace/tab
projection — `ClientConnection.shell_location`, documented as *"Connection-local
workspace and tab projection for a client-owned shell"*
(`backend/src/server/clients.rs:174-175`), resolved per client at
`backend/src/server/headless/client_views.rs:64-80`. So:

> **one endpoint connection per visible task surface**, each pinned to that
> task's workspace/tab.

That is the M0 design. See PRD-DELTA §3 for the cost.

### 10.3 Methods an endpoint client may invoke

Over the shell connection, via `ClientShellEndpointRequest`, herdr accepts a
fixed subset (`backend/src/server/client_commands.rs:15-53`):

```
command.invoke  integration.install  integration.list  layout.set_split_ratio
pane.close  pane.copy_motion  pane.copy_search  pane.edit_scrollback  pane.focus
pane.focus_direction  pane.input.set  pane.link.activate  pane.rename  pane.resize
pane.scroll  pane.selection.read  pane.split  pane.swap  pane.zoom
product_announcement.dismiss  release_notes.dismiss  server.reload_config
tab.close  tab.create  tab.focus  tab.move  tab.rename
workspace.close  workspace.create  workspace.focus  workspace.move
workspace.move_block  workspace.rename
worktree.create  worktree.list  worktree.open  worktree.remove
```

**Not** in the list: `agent.start`, `agent.prompt`, `agent.list`,
`events.subscribe`, `pane.send_*`, `pane.read`. Those are daemon-only over
`herdr.sock` — which matches OSADE §4.2's split, and the boundary is enforced by
herdr, not just by Osade lint. A method missing from `welcome.methods` must
disable one action, never the connection (`endpoint.rs:6-9`).

---

## 11. Build and vendoring

| Requirement | Present on this machine |
| --- | --- |
| Rust 1.96.1 (`backend/rust-toolchain.toml`) | ✅ 1.97.1 |
| **Zig 0.15.2** for vendored libghostty-vt (`backend/build.rs:63-97`) | ❌ not installed |
| `just` | ❌ |
| `python3` (maintenance tests) | ❌ |
| `bun` (docs/integration tests) | ✅ 1.3.6 |
| Node | ✅ 22.21.0 |
| **`herdr` binary** | ✅ **0.8.2 already installed** |

`just build` cannot run here — `build.rs` shells out to `zig build` for
`vendor/libghostty-vt` (source dist pinned at `libghostty-vt 1.3.2-HEAD-+c5a21edfc`,
`backend/vendor/libghostty-vt.vendor.json`) and panics with an actionable message
when `zig` is absent. `ZIG=<path>` overrides the executable.

This confirms OSADE §18's vendoring decision: **ship prebuilt binaries, never
build at install time.** Checksums: `backend/distribution/latest.json`,
`backend/src/checksum.rs`.

For M0 you do not need to build herdr at all — the installed 0.8.2 binary serves
every call in this document.

---

## 12. Cheat sheet — M0 task launch

```
0.  spawn:  HERDR_SESSION=osade herdr server        (detached; capabilities.detached_server_daemon
                                                     is false on Windows, so Osade owns the child)
1.  ping                          → assert protocol == pinned, version == pinned
2.  worktree.create               { cwd: repo.path, branch, base: task.base_sha,
                                    path: ~/.osade/worktrees/<slug>/<task>, label, focus: false }
                                  → workspace_id, tab_id, root_pane (this is the `shell` lane)
3.  tab.create                    { workspace_id, label: "agent", focus: false,
                                    env: { OSADE_TASK_ID } }
                                  → tab_id, root_pane.pane_id
4.  open events.subscribe         [{ type: "pane.agent_status_changed", pane_id }]
5.  agent.start                   { name: "osade-<task>", kind: "claude", pane_id,
                                    args: [...autonomousArgs, "--append-system-prompt", ctx],
                                    timeout_ms: 60000 }
    on `agent_not_ready` →  pane.read / pane.wait_for_output, resolve trust (§8), retry the wait
6.  agent.prompt                  { target, text: task.intent }
7.  facts flow in on the subscription; gate every write on state_change_seq
```

Cleanup: `pane.close` → `worktree.remove {workspace_id, force?}` (refuses dirty
without `force`) → `workspace.close`.

---

## 13. Quick index of citations

| Fact | Location |
| --- | --- |
| `Method` enum, 101 variants | `backend/src/api/schema.rs:47-263` |
| `ResponseResult` | `backend/src/api/schema/response.rs:42-299` |
| `EventKind` / `EventData` / `Subscription` | `backend/src/api/schema/events.rs:16-556` |
| One request per connection | `backend/src/api/server.rs:154-300`, `:502` |
| EventHub ring buffer (512) | `backend/src/api/event_hub.rs:13`, `:22` |
| Status emitted / `pane.updated` gated | `backend/src/app/api.rs:625-673` |
| Per-pane status subscription | `backend/src/api/subscriptions.rs:205-236`, `:331-420` |
| Headless server | `backend/src/server/headless.rs:1-16`, `bootstrap.rs:4-87` |
| Headless size fallback | `backend/src/server/headless.rs:817`, `:828`; `backend/src/config.rs:79-80` |
| Named sessions | `backend/src/session.rs:10-11`, `:96-101`, `:157-185` |
| Windows named pipes | `backend/src/ipc.rs:36-79` |
| `agent.start` types into a shell | `backend/src/app/agents.rs:145-225` |
| Agent executables | `backend/src/detect/mod.rs:149-181` |
| Pane env injection | `backend/src/pane.rs:115-137`; `backend/src/integration/env.rs:8-33` |
| `git worktree add` invocation | `backend/src/worktree.rs:238-320` |
| Endpoint generation 1 | `backend/src/protocol/endpoint.rs:1-116` |
| Bincode framing | `backend/src/protocol/wire.rs:1592-1650` |
| `ServerMessage` variants | `backend/src/protocol/wire.rs:1329-1449` |
| Per-connection shell projection | `backend/src/server/clients.rs:174-175`; `headless/client_views.rs:64-80` |
| Endpoint-invokable methods | `backend/src/server/client_commands.rs:15-53` |
| Schema artifact contract test | `backend/src/api/schema/tests.rs:181-206` |
| Zig build requirement | `backend/build.rs:63-97` |
