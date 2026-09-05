# PRD Delta — where OSADE.md is wrong about herdr

> Every assumption in OSADE.md that recon proved wrong, unverifiable, or more
> expensive than written, with a proposed correction. Evidence is in
> HERDR-CONTRACT.md; this file is the argument, not the transcript.
>
> **The architecture survives.** The load-bearing question — can herdr spawn and
> keep agents alive with zero clients attached — is **yes**, verified
> end-to-end: a real Claude Code session ran an entire turn in a headless herdr
> pane with no TUI and no client. §2, §5 and §7 below are the ones that cost real
> work.
>
> Verified 2026-09-04 against herdr 0.8.2 (installed binary, JSON API protocol 20)
> and `backend/` at protocol 22.

Severity key: **BLOCKER** — invalidates a design decision · **COSTLY** — the plan
works but is more work than written · **WRONG** — a factual correction, cheap to
apply · **HYGIENE** — repo/process.

---

## 1. BLOCKER — `backend/` is not the herdr you will ship

`backend/Cargo.toml:3` says `0.8.2`. The installed binary says `0.8.2`. They are
**different code**:

| | JSON API `protocol` | `Method` variants in schema | `ServerCapabilities` |
| --- | --- | --- | --- |
| installed 0.8.2 binary | 20 | 91 | 2 fields |
| `backend/` source | 22 (`src/protocol/wire.rs:20`) | 101 | 3 fields (`endpoint_protocol_generation`) |

Ten methods exist in `backend/src/api/schema.rs` that the released binary rejects:

```
command.invoke          integration.list        pane.copy_motion
pane.copy_search        pane.edit_scrollback    pane.link.activate
pane.scroll             pane.selection.read     product_announcement.dismiss
release_notes.dismiss
```

(An eleventh, `pane.graphics.stream`, is `#[schemars(skip)]` by design.)

Generate the client from `backend/src` and Osade emits calls the shipped binary
answers with `invalid_request`. Not at boot — at the moment a user scrolls a
pane.

**Correction.** OSADE.md §4.1 says "vendor that schema"; make it precise:

> The schema is whatever `herdr api schema --json` prints **from the exact binary
> in `vendor/herdr/<target>/`**. Commit that JSON, the binary, its checksum, and
> the version string together. `backend/` is a reading reference for semantics
> only and is never an input to code generation.

Boot guard compares `ping.protocol` and `ping.version` against the pinned
schema's `protocol` and the pinned version, and refuses to start on either
mismatch.

Related: OSADE.md §4.1 says the schema "has roughly 100 methods". It has 91 in
the shipped binary, 101 in `backend/`. Neither is a problem; the number in the
doc is just noise — delete it.

---

## 2. BLOCKER — `docs/next/api/herdr-api.schema.json` does not exist in `backend/`

OSADE.md §4.1 and recon question 1 both assume it is there. `backend/docs/` is
absent entirely. The file is `include_str!`'d at `backend/src/cli/api.rs:1`, so
**`backend/` as vendored cannot compile.** `backend/.github/`, `AGENTS.md`,
`SECURITY.md` and `ThirdPartyNotices.txt` were also hoisted out of the herdr tree
(into the Osade repo root and `docs/`), so this is a copy artifact, not an
upstream fact.

Upstream the file is CI-enforced current — `backend/src/api/schema/tests.rs:181-206`
byte-compares it against a live `schemars` render and regenerates under
`HERDR_UPDATE_API_SCHEMA=1`. When present it is authoritative.

**Correction.** Do not try to restore `backend/docs/`. Take the schema from the
binary (§1). Either finish the vendoring (`git clone` herdr at the pinned tag
into `backend/`, or drop `backend/` to a submodule/pin) or accept that it does
not build and mark it read-only reference — which is what CLAUDE.md already says.

---

## 3. COSTLY — the endpoint protocol is bincode, and it streams one composited tab

OSADE.md §4.3 reads generation 1 as a JSON protocol; §18.2 draws a transport that
"decodes frames"; §4.4 assumes per-pane surfaces the renderer can place
anywhere. Three corrections, in ascending cost.

### 3a. The framing is bincode, not JSON

Generation 1 is a real, build-independent contract — `do_handshake` compares
`generation` and codec names and **never** compares herdr versions
(`backend/src/client/handshake.rs:219-232`). That promise holds.

But it rides on `herdr-client.sock`, framed
`[u32LE length][bincode payload]` (`backend/src/protocol/wire.rs:1592-1602`) of
the Rust `ClientMessage`/`ServerMessage` enums. Only the *handshake and control*
messages carry JSON, as a string inside
`EndpointControl { kind, data }`. The payloads Osade actually renders —
`ClientShellSnapshot`, `PaneSurface(PaneSurfaceFrame)`,
`PaneSurfacePatch` — are native bincode variants
(`backend/src/protocol/wire.rs:1411`, `:1414`, `:1442`).

**Cost:** `apps/desktop/src/surface/` must implement a bincode decoder for
`ServerMessage` in TypeScript — varint-ish `bincode::config::standard()`,
enum tag ordering, `CellData`/`FrameData`/`SurfaceGraphicsScene` nesting. The
enum tag order is **positional**, so a herdr upgrade that inserts a variant
breaks the decoder silently. `EndpointControl` is explicitly append-only for this
reason (`wire.rs:1444-1448`), but nothing else is.

**Correction.** Add to §4.3:

> The endpoint transport decodes `[u32LE len][bincode]` frames. Pin the decoder
> to the vendored herdr version and add a boot assertion: decode a known
> `endpoint.welcome.v1` frame and fail loudly on mismatch. Ship a fixture-based
> decoder test using
> `backend/tests/fixtures/endpoint-{hello,welcome,snapshot}-v1.json` plus a
> captured binary frame.

### 3b. `TerminalAnsi` is not available as a fallback

§4.4's escape hatch — "negotiate `TerminalAnsi` for a single focused pane and
pipe to xterm.js" — does not exist for endpoint clients. `RenderEncoding`
(`wire.rs:41-48`) is negotiated on the **private** `TerminalHello` path;
`do_handshake` hardcodes `SemanticFrame` for every endpoint shell
(`backend/src/client/handshake.rs:236-238`).

**Correction.** Delete the fallback from §4.4, or restate it: the real fallback
is `pane.read --format ansi` over the JSON API (`pane.read` with
`ReadFormat::Ansi`), which gives a static ANSI dump, not a live stream. That is
adequate for a read-only preview, not for an interactive terminal. Decide which
one §4.4 is promising.

### 3c. One connection renders one tab, not one pane

`PaneSurfaceFrame` (`wire.rs:1213-1225`) is **one cell grid for the whole active
tab**, with `panes: PaneSurfacePane[]` giving each pane's rect inside it. herdr
composites; the client blits. There is no "subscribe to pane X".

The saving grace: `ClientConnection.shell_location` is documented as
*"Connection-local workspace and tab projection for a client-owned shell"*
(`backend/src/server/clients.rs:174-175`), resolved per client at
`backend/src/server/headless/client_views.rs:64-80`. Each connection can be
pinned to a different workspace/tab.

**Correction to §4.4 and §18.2.** State the topology explicitly:

> One endpoint connection per **visible task surface**, each pinned to that
> task's workspace and tab. The renderer draws herdr's composited grid for that
> tab and uses `PaneSurfacePane` rects to crop or label. Osade does not
> re-layout panes; herdr's layout is what appears.

And revise the §4.4 target. "15 concurrently visible panes at 60fps" now means
15 socket connections, 15 server-side render targets, and herdr rendering 15
tabs per frame — a cost herdr's own AGENTS.md flags as a multiplicative hot path.
**Benchmark this in M0, not M1.** A realistic v1 target is 1 focused surface at
60fps plus N throttled previews (say 4fps); if that is the answer, record it as a
DECISION now rather than discovering it in week three.

---

## 4. COSTLY — hooks do not report state for Claude Code or Codex

OSADE.md §7 says herdr "installs per-agent hook scripts … for Claude Code, Codex,
pi, opencode, Kimi and others, which report authoritative state back". Half true.
Reading every asset in `backend/src/integration/assets/`:

| Reports `pane.report_agent` (state) | Reports `pane.report_agent_session` only | Nothing |
| --- | --- | --- |
| kilo, kimi, mastracode, omp, opencode, pi | **claude**, **codex**, antigravity_cli, copilot, cursor, devin, droid, grok | hermes, qodercli, qwen |

Claude's hook (`assets/claude/herdr-agent-state.sh`) fires on `SessionStart`
only and posts one `pane.report_agent_session` with `session_id` and
`transcript_path`. Nothing more.

**No bundled asset calls `pane.report_metadata` at all.** So
`agent_fact.activity_text`, `tool_name` and `final_message` (OSADE.md §5.2) have
**no source** for Claude Code.

The good news, verified live: herdr's screen detection carried the whole
lifecycle for Claude Code — `blocked` (trust prompt) → `idle` → `working` →
`done` — with correct timing and no flapping.

**Corrections:**

1. §5.2 — mark `activity_text`, `tool_name`, `final_message` nullable-and-usually-null
   for v1, and use `AgentInfo.terminal_title_stripped` as the display string.
   Observed live: `"Pong response"` after a turn. Free, already in every
   `AgentInfo`.
2. §8.1 — the `hook-reporting` capability is real and discriminating. Set it for
   `pi|opencode|kimi|kilo|omp|mastracode` and **clear it for `claude` and
   `codex`**. This is exactly the case §8.1 designed capabilities for.
3. If Osade later wants tool-level activity for Claude Code, the supported path
   is to install an **additional** Claude Code hook that calls
   `pane.report_metadata` with `HERDR_PANE_ID`/`HERDR_SOCKET_PATH` from the
   environment. That is not "a parallel hook system" — it is herdr's own
   documented inbound API. Note the token limits: ≤16 keys per patch, ≤32
   stored, `^[A-Za-z0-9_-]{1,32}$`
   (`backend/src/api/schema/common.rs:3-23`). **M2 or later.**

---

## 5. COSTLY — the event stream replays on connect and can drop silently

OSADE.md §5.4 ("there is no second event path") and §7 both assume a clean,
ordered feed from herdr. It is not one.

`EventHub` is a **512-entry in-memory ring buffer** polled per subscription
(`backend/src/api/event_hub.rs:13`, `:22`). Two behaviors, both verified:

1. **Replay.** A fresh `events.subscribe` connection immediately receives a burst
   describing state that existed before it connected — including
   `workspace_created` for a workspace that had already been **closed**.
   Reproduced on two independent connections with no concurrent activity.
   (`stream_subscriptions` intends to start at `event_hub.current_sequence()`,
   `backend/src/api/server.rs:697`; observed behavior contradicts that. Worth an
   upstream issue — but design for the observed behavior.)
2. **Silent loss.** Over 512 events while disconnected and the overflow is
   dropped with no gap marker. The delivered envelope carries no sequence number.

**Correction — add to §7 as an INVARIANT:**

> herdr's event stream is **at-least-once with replay and possible loss**. Every
> `agent_fact` write is gated on a monotonic counter from the payload —
> `AgentInfo.state_change_seq`, or `PaneInfo.revision` — and a write whose
> counter is not greater than the stored one is dropped. On every subscriber
> connect and reconnect the daemon calls `session.snapshot` and reconciles
> before trusting the stream.

This does not weaken §5.4: reconciliation writes still go through the database
and reach the UI through `change_log`/CDC. It does mean the daemon polls herdr
**once per connection**, which is not the polling §5.4 forbids.

`agent_fact` already has `controller_generation`; repurpose it, or add
`last_state_change_seq`. Either way it must be written in the same transaction as
the fact it guards.

---

## 6. WRONG — §7's event table, corrected

Four of the seven names in OSADE.md §7 do not exist. `EventKind` is closed at
`backend/src/api/schema/events.rs:194-221`.

| OSADE.md §7 | Reality |
| --- | --- |
| `PaneAgentStatusChanged` | ✅ `pane.agent_status_changed` — **pane-scoped subscription; `pane_id` is required** |
| `HookStateReported` | ❌ inbound *method* `pane.report_agent`; surfaces as `pane.agent_status_changed` |
| `HookMetadataReported` | ❌ inbound *method* `pane.report_metadata`; surfaces in `tokens`/`state_labels` |
| `AgentSessionReported` | ❌ inbound *method* `pane.report_agent_session`; surfaces as `AgentInfo.agent_session` |
| `PaneDied` | ❌ the event is `pane.exited` `{pane_id, workspace_id}` |
| `GitStatusRefreshed` | ❌ **no git-status event exists, under any name** |

### 6a. `pane.updated` is not a status feed — do not build on it

`pane.agent_status_changed` is pushed on every transition
(`backend/src/app/api.rs:647-673`). `pane.updated` is pushed only on agent-name
change and a few unrelated actions (`backend/src/app/api.rs:631-633` and four
other call sites). Verified: a global `pane.updated` subscription held across a
complete `working → done` turn received **zero** events for that turn.

**Correction — the subscriber topology §7 needs:**

```
1 connection   global lifecycle: pane.created / pane.closed / pane.exited,
                                 workspace.*, worktree.*, tab.*
N connections  one per live agent pane: pane.agent_status_changed { pane_id }
```

Opened on `pane.created`, closed on `pane.exited`. `event-subscriber.ts` is a
connection manager, not a single socket — plan it that way from day one.

### 6b. `GitStatusRefreshed` → Osade owns diff state

§7 maps it to "triggers a diff-stat refresh". There is no such event, and
§4.2 lists "git status" as something to subscribe to. Both are wrong.

**Correction.** Osade runs `git -C <worktree> status --porcelain` / `diff --stat`
itself, on a debounce, triggered by verification runs and by
`pane.agent_status_changed → done`. This is not a §1 violation: §1 forbids
reimplementing *worktree lifecycle*, which herdr owns and Osade calls. Reading
git status in a directory is ordinary work. Say so explicitly in §9 so nobody
relitigates it.

---

## 7. WRONG — the JSON API is one request per connection

Nothing in OSADE.md says otherwise, but §4.2's table and §18's "spawn the daemon;
wait for its ready handshake" both read like a persistent client.
`handle_connection_with_stop` reads exactly one line, answers, and returns
(`backend/src/api/server.rs:154-300`). Verified: three requests written to one
socket produced exactly one response.

Long-lived exceptions: `events.subscribe`, `pane.graphics.stream` (streaming);
`events.wait`, `agent.wait`, `agent.prompt`+`wait`, `pane.wait_for_output`
(blocking single response).

**Correction to §4.2.** Add: *the generated client opens one connection per
call.* Do not build a correlation-id multiplexer or a connection pool. Each
connection is a thread on herdr's side
(`backend/src/api/server.rs:90-100`), so prefer `agent.prompt --wait` over
prompt-then-poll.

---

## 8. WRONG — §8.2 step 7 cannot build argv the way it says

§8.2: *"Build argv from the catalog entry … Spawn in the `agent` lane via the
herdr JSON API."*

**No pane-creating method accepts a command.** `pane.split`, `tab.create`,
`workspace.create` all spawn the configured shell and take no `argv`
(`backend/src/api/schema/panes.rs:27-43`, `tabs.rs:8-19`, `workspaces.rs:8-20`).

`agent.start` (`backend/src/app/agents.rs:145-225`) instead:

1. maps `kind` → a **fixed** executable name
   (`backend/src/detect/mod.rs:149-181`: `claude`, `codex`, `kiro-cli`, `agy`,
   `cursor-agent(.cmd)`, …),
2. appends `params.args`, rejecting control characters,
3. shell-quotes and **types the command line into an existing idle shell pane**,
4. waits for its detector to confirm the agent is interactive.

**Corrections to §8:**

- `AgentCatalogEntry.binary` is **advisory**. herdr picks the executable name;
  Osade's job is to ensure it resolves on `PATH`. Keep the field for probing and
  for the "agent not installed" error, but never pass it to herdr. §8.1's PATH
  warning ("never shell out to `zsh -i`") stays exactly right and now applies to
  probing only.
- All args — `autonomousArgs`, `planArgs`, `resumeArgs`, `--append-system-prompt` —
  go through `agent.start.args`. That works.
- **Environment cannot be set at `agent.start`.** It must be set on the
  `workspace.create` / `tab.create` / `pane.split` that made the pane. So
  `OSADE_TASK_ID` (§17) is decided at lane creation. Renumber §8.2: create the
  lane with env **before** anything else.
- A pane can host one agent. `agent_pane_busy` if it already does. Relaunch means
  a fresh pane, or `pane.close` first.
- Add the error-code table to §8.2 —
  `agent_not_ready`, `agent_pane_busy`, `unsupported_agent_kind`,
  `invalid_agent_argument`, `duplicate_agent_name` each need distinct handling,
  and only the first is routine.

Supported `kind` values (installed binary):
`pi codex claude gemini cursor devin agy cline omp mastracode opencode copilot
kimi kiro droid amp grok hermes kilo qodercli qwen maki`. §8.1's table lists
`kiro` as `kiro-cli chat` — the kind is `kiro`, the executable herdr runs is
`kiro-cli`, and `chat` would be an arg.

---

## 9. WRONG — §5.2 is missing `done`, which is the one that matters

`AgentStatus` is `idle | working | blocked | done | unknown`
(`backend/src/api/schema/common.rs:135-142`). OSADE.md §5.2's comment says
`working|blocked|done|idle|unknown` — correct — but §7's mapping table collapses
`done` and `idle` together into `to_review`.

They are not the same. Verified live: after a completed turn the agent sits at
`done`; `idle` is what it reports *before* the first prompt and after a session
reset. Mapping `idle → to_review` puts a freshly launched, un-prompted agent
straight into the needs-you set (§6 row 10).

**Correction to §7's mapping table:**

| herdr status | Osade event | Note |
| --- | --- | --- |
| `working` | `to_in_progress` | |
| `blocked` | *(no transition)* | sets `herdr_state='blocked'` → §6 row 4 |
| `done` | `to_review` | turn finished — this is the needs-you signal |
| `idle` | `to_in_progress` on first sight, else none | never `to_review` |
| `unknown` | none | record, do not transition |

---

## 10. WRONG — §9's worktree rules, three of six are not herdr's job

herdr runs (`backend/src/worktree.rs:238-320`):

- new branch: `git worktree add -b <branch> <path> <base>`
- existing branch: `git worktree add <path> <branch>`

Verified: `--base 089a586` produced a worktree on `osade/demo-1` at exactly
`089a586`. So §9 rule 4 (pinned base) is satisfied **by outcome**, though not by
the `--detach`-then-branch mechanism §9 describes. Rewrite rule 4 to state the
outcome, not the mechanism — Osade cannot control the mechanism.

Not done by herdr, and therefore Osade's:

- **Rule 3, `git worktree prune` before `add`.** herdr never prunes. The
  "missing but already registered" failure §9 warns about will happen. Osade must
  run `git -C <repo> worktree prune` before calling `worktree.create`. Add an
  explicit carve-out to §1/§9: *Osade may run `git worktree prune`, `status`, and
  `diff`; creation, opening and removal go through herdr.*
- **Rule 5, mirroring gitignored paths** (`.env`, local tool configs). No herdr
  concept. Entirely Osade's, and it must happen **after** `worktree.create`
  returns and **before** `agent.start`.
- **Rule 2, repo-level creation lock.** herdr has no cross-call lock. Two
  concurrent `worktree.create` calls on one repo race. Osade's lock is required.

Confirmed as herdr's: rule 6 (removal refuses a dirty checkout without `force` —
`backend/src/worktree.rs:214`, and has leftover-checkout recovery at `:343`) and
rule 1 (`worktree.open` on an existing path returns `already_open`, never
recreates).

---

## 11. WRONG — herdr restart is not task death

Verified: stop and restart the server and workspaces/tabs/panes come back with
**the same ids** (`w3`, `w3:p2`) and the same cwd — but the agent process is
gone, `agent=undefined`, `agent_status=unknown`. herdr restores shells, not
agents.

This lands in §6 row 13 (`pane_alive === 0` and no herdr workspace → `queued`),
except the workspace *does* exist, so it falls through to row 14 `idle`. Either
is survivable; neither is honest.

**Corrections:**

- §5.2 — `herdr_workspace_id` is a durable key. It is a stored field
  (`backend/src/app/ids.rs:15-17`), stable across other workspaces closing and
  across restart. Two cautions: `WorkspaceInfo.number` **does** renumber
  (verified: closing `w1` left `w2` with `number: 1`) — never key on `number`;
  and `parse_workspace_id` has a positional fallback for bare integers
  (`backend/src/app/ids.rs:60-67`), so always send the full `wN` form.
- §6 — add a row, or fold it into row 13: an agent whose pane exists but whose
  `agent` field is null after a herdr restart is `queued`, not `stopped`. The
  §5.2 invariant holds — `terminated` is still set only by an explicit exit.
- §8.2 — add a relaunch path. After a herdr restart the daemon re-runs
  `agent.start` in the restored pane (it is back at a shell prompt, so
  `agent_pane_busy` will not fire), using `resumeArgs` plus the
  `AgentInfo.agent_session` id captured before the restart.

---

## 12. WRONG — §18.1's startup order needs two more steps

Confirmed correct: userData redirect first; adopt-or-spawn on the `osade` named
session; wait for `Ping`; never a fixed sleep. `HERDR_SESSION=osade` gives full
isolation — verified running concurrently with the user's own `default` session,
separate sockets, separate `session.json`, no interference
(`backend/src/session.rs:10-11`, `:157-185`).

Two additions from the source:

- **Copy herdr's own detached-spawn recipe** (`backend/src/server/autodetect.rs:188-233`):
  `herdr server` with stdin/stdout/stderr null and
  `detach_server_daemon_command` — `DETACHED_PROCESS` on Windows, `setsid` on
  Unix. Without it the server dies with its parent. (`ping`'s
  `capabilities.detached_server_daemon` reports whether *this* server was started
  that way; it read `false` in my test precisely because I did not detach.)
- **Clear `HERDR_STARTUP_CWD`.** If it is set and the session has no workspaces,
  herdr creates a workspace at that cwd on boot
  (`backend/src/server/headless/bootstrap.rs:89-117`). Osade would inherit a
  stray workspace it did not create. `env_remove` it explicitly.

Also worth pinning in §2.1: on Windows the herdr sockets are **named pipes**, not
files — `interprocess` maps the path string through `GenericNamespaced`
(`backend/src/ipc.rs:44-51`), so a Node client connects to
`\\.\pipe\C:\…\herdr.sock`. Verified working from Node 22. The `.sock` file on
disk is only a marker (`backend/src/ipc.rs:76`); its presence does not mean a
server is listening. §2.1's "mode 0600" is Unix-only; Windows uses an SDDL
descriptor (`backend/src/ipc.rs:156`).

---

## 13. CONFIRMED — things OSADE.md got right, so nobody re-checks them

- **§18 vendoring.** `backend/build.rs:63-97` shells out to `zig build` and
  panics without Zig 0.15.2. Not installed here; neither are `just` or `python3`.
  Shipping prebuilt binaries is not a preference, it is the only option.
- **§8.3 trust prompts.** Fired on the very first launch into a fresh worktree.
  herdr's detector classified it `blocked` correctly, and
  `pane.wait_for_output` + `pane.send_keys` resolved it. Full recipe in
  HERDR-CONTRACT.md §8.
- **§7 env injection.** `HERDR_ENV`, `HERDR_SOCKET_PATH`, `HERDR_BIN_PATH`,
  `HERDR_WORKSPACE_ID`, `HERDR_TAB_ID`, `HERDR_PANE_ID` are all injected
  (`backend/src/pane.rs:115-137`).
- **§7 "extend herdr properly".** Detection is 21 versioned TOML manifests with
  an `index.toml` for remote updates (`backend/distribution/agent-detection/`).
- **§3 naming.** Task ↔ herdr Workspace is genuinely 1:1 — `worktree.create`
  returns exactly one workspace per worktree. Lane ↔ Tab holds.
- **§4.2's socket split** is enforced by herdr, not just by Osade's lint: the
  endpoint connection can invoke only 37 whitelisted methods
  (`backend/src/server/client_commands.rs:15-53`), and `agent.start`,
  `agent.prompt`, `pane.send_*`, `pane.read` and `events.subscribe` are **not**
  among them.
- **§17 orchestrator.** Feasible as written. herdr injects its own env; Osade
  adds `OSADE_TASK_ID` through the `env` map at lane creation.

---

## 13a. COSTLY — `agent.start` is not a readiness signal, and on Windows it cannot carry args

*Found during M0 implementation, against herdr `0.8.2-p20`. Both were invisible from the
schema and only appeared when a real agent was launched.*

### 13a.1 `agent.start` returning does not mean the agent is usable

It resolves either way and neither outcome is trustworthy:

- **Success, immediately**, with `launch_pending: true` and `agent_status: unknown`, before
  the agent has rendered anything. A `agent.prompt` issued straight after fails with
  `agent_not_ready: agent w2:p2 is not an active named agent`.
- **`agent_not_ready`**, when herdr's own detector saw `blocked` during startup — which for a
  fresh worktree is almost always the trust prompt, i.e. not a failure at all.

**Correction to §8.2.** Treat `agent.start` as *submission*, not as a barrier. Readiness is
established afterwards by polling `agent.get` for `interactive_ready && !launch_pending`
against a hard deadline, answering the trust prompt if it appears during that wait. The two
outcomes interleave rather than sequence — the prompt may already be on screen when the call
returns, or arrive a second later — so one loop handles both.

The keystroke answer must be **re-sent while the prompt is still visible**, bounded (3
attempts). Keys sent between the text rendering and the selector accepting input are dropped
silently, which showed up as an intermittent 90-second launch timeout.

### 13a.2 On Windows, `agent.start` args break npm-shim agents

With no args herdr submits `& claude` and the agent starts. With args it submits:

```powershell
$p=Start-Process -FilePath claude -ArgumentList '--permission-mode acceptEdits' -NoNewWindow -Wait -PassThru
Start-Process : This command cannot be run due to the error: %1 is not a valid Win32 application.
```

`Start-Process -FilePath` cannot execute an extensionless npm shim, and most agent CLIs on
Windows are npm shims. The pane shows the error, no agent ever appears, and `agent.start`
reports success — a silent launch failure.

**Correction to §8.1/§8.2.** On Windows, start the agent bare and deliver the launch context
through `<worktree>/.osade/CONTEXT.md`, which §13.5 already prescribes for agents without
system-prompt injection. Mode args (`--permission-mode`) are lost there; that is a real
capability reduction and is reported, not hidden. **Upstream issue candidate** — herdr's
`platform::interactive_shell_command` should use the call operator with arguments rather than
`Start-Process`.

### 13a.3 Teardown ordering is the reverse of the obvious one

`worktree.remove` is addressed by workspace id, and herdr closes a workspace when its last
pane closes. So closing every pane first leaves nothing to address
(`workspace_not_found`), while leaving a live shell in the worktree makes the directory
undeletable on Windows (`Permission denied`, even with `force: true`).

**Correction to §9 rule 6.** Close every pane *but one*, move that survivor out of the
checkout (`cd ~`, valid in both POSIX shells and PowerShell), then remove. `force` overrides
uncommitted changes, never live panes.

---

## 14. HYGIENE — the instruction files fight each other

- `docs/CLAUDE.md` is not auto-loaded. Claude Code reads `CLAUDE.md` from the
  working directory and its parents. There is no `CLAUDE.md` at the repo root.
  The root file drafted inside `docs/CLAUDE.md` needs to actually exist at
  `Osade/CLAUDE.md`.
- **`docs/AGENTS.md` is herdr's `AGENTS.md`**, not Osade's — 305 lines of herdr
  maintainer policy (`.github/MAINTAINERS`, `HERDR_ENV=1`, release workflow,
  ratatui render rules). Sitting in `docs/` it reads as project guidance for
  Osade. CLAUDE.md's line *"herdr's own AGENTS.md rules apply to `backend/` only"*
  is therefore already violated by file placement. Move it to
  `backend/AGENTS.md`.
- herdr's `.github/` and `.agents/skills/herdr-*` are at the Osade repo root and
  will be read as Osade's CI and skills. Move them under `backend/`.
- `backend/` is untracked (`git ls-files backend | wc -l` → 0). Decide now:
  submodule, vendored-and-committed at a pinned tag, or `.gitignore`d with a
  fetch script. "Untracked and partially copied" is the one option that
  guarantees drift.

---

## 15. Recommended M0 changes

Against OSADE.md §21's six checkboxes:

| M0 item | Change |
| --- | --- |
| Vendor herdr binary + api schema; generate client; version guard | Schema comes from `herdr api schema --json` on the vendored binary, not from `backend/`. Guard on `protocol` **and** `version`. |
| Daemon: sqlite + migrations + change_log + CDC + ws | Unchanged. |
| Electron: userData redirect, supervisor, utilityProcess, canvas renderer | Add the bincode decoder (§3a) and detached spawn + `HERDR_STARTUP_CWD` removal (§12). Benchmark surfaces here, not in M1 (§3c). |
| One task end-to-end | Unchanged — **proven to work** (HERDR-CONTRACT.md §3.3). |
| — | **New:** event-subscriber as an N+1 connection manager (§6a). |
| — | **New:** `state_change_seq` monotonic gate + `session.snapshot` reconcile (§5). |

Nothing here changes §6's derived-status invariant, §5.4's single event path, or
§2's three-process shape. The spine holds; the seams are where the work is.
