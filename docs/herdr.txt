# Herdr Architecture

Herdr is a terminal workspace manager for AI coding agents. It owns real PTY
processes, structures them into workspaces/tabs/panes, watches what the agents
inside them are doing, and projects all of that to one or more attached
terminal clients.

This document describes how the codebase is organized and how data moves
through it. For user-facing concepts see `docs/next/website/src/content/docs/`.
For contribution rules and validation workflow see `AGENTS.md` and
`CONTRIBUTING.md`.

- **Language:** Rust 2021 (`herdr`, single binary), ~224k lines across ~293 files
- **Async runtime:** tokio (multi-thread) for PTY I/O and background tasks
- **TUI:** ratatui + crossterm
- **Terminal emulation:** vendored `libghostty-vt` (Zig), linked statically via FFI
- **IPC:** `interprocess` local sockets (Unix domain sockets / Windows named pipes)

---

## 1. Process model

Herdr always runs as **a background server plus zero or more thin clients**,
even for a single local user.

```
                 ┌──────────────────────────────────────────────┐
                 │  herdr server  (headless, owns everything)    │
                 │                                              │
   herdr.sock ───┤  JSON API           AppState                 │
   (JSON API)    │  ├─ CLI (herdr pane/agent/tab/...)           ├── PTY ── agent
                 │  ├─ agent hooks & integrations               ├── PTY ── shell
                 │  └─ plugins / automation                     ├── PTY ── ...
                 │                                              │
herdr-client.sock┤  binary client protocol                      │
   (TUI clients) │  ├─ snapshot + surface frames out            │
                 │  └─ semantic input in                        │
                 └──────┬──────────────────────┬────────────────┘
                        │                      │
              ┌─────────▼────────┐   ┌─────────▼─────────┐
              │ local TUI client │   │ remote/SSH client │
              └──────────────────┘   └───────────────────┘
```

Three roles, all in the same binary, selected in `src/main.rs`:

| Argv | Entry point | Role |
| --- | --- | --- |
| `herdr server` | `server::headless::run_server` | Headless runtime. Owns PTYs, `AppState`, both sockets. |
| `herdr client` | `client::run_client` | Thin TUI. Draws frames, sends input. Hidden command; the bare `herdr` launch spawns it. |
| `herdr remote-client-bridge` | `remote::run_remote_client_bridge` | Stdio↔socket bridge used by `herdr --remote <ssh-target>`. |
| everything else | `cli::maybe_run` | One-shot CLI verbs that talk to the JSON API and exit. |

The server survives client detach (`ctrl+b q`). Panes and agents keep running.
`herdr server stop` ends the session.

**Sessions** (`src/session.rs`) are runtime namespaces. Each named session gets
its own data directory, its own two sockets, and its own persisted state:

```
~/.config/herdr/                    default session
├── config.toml                     user config
├── session.json                    persisted workspaces/layouts/cwds
├── session-history.json            optional pane screen history
├── plugins.json                    installed plugin registry
├── herdr.sock                      JSON API socket
├── herdr-client.sock               client protocol socket (0600)
└── sessions/<name>/                named session — same layout
```

---

## 2. Two sockets, two protocols

This split is load-bearing and the source of most of the architectural rules in
`AGENTS.md`.

### `herdr.sock` — JSON API (public)

`src/api/`, schema in `src/api/schema/`. A request/response + subscription
protocol over JSON. ~100 methods, tagged by `method` with a `params` payload:

```rust
// src/api/schema.rs
#[serde(tag = "method", content = "params")]
pub enum Method {
    Ping(PingParams),
    ServerStop(EmptyParams),
    PaneSplit(PaneSplitParams),
    AgentPrompt(AgentPromptParams),
    // ...
}
```

Consumers: the `herdr <verb>` CLI (`src/cli/`), agent hook scripts, plugins, and
external automation. `EventHub` (`src/api/event_hub.rs`) fans out subscribed
events (`PaneAgentStatusChanged`, `WorkspaceFocused`, `PaneOutputMatched`, …).
The JSON Schema is generated via `schemars` and published at
`docs/next/api/herdr-api.schema.json`.

`api::request_changes_ui()` classifies which methods mutate visible state and
therefore must trigger a re-render.

### `herdr-client.sock` — client protocol (binary, bincode)

`src/protocol/wire.rs`, `PROTOCOL_VERSION = 22`, frames capped at
`MAX_FRAME_SIZE = 2 MiB`. `ClientMessage` (client→server) and `ServerMessage`
(server→client) are bincode-encoded and length-framed.

Two **render encodings** are negotiated at handshake:

- **`SemanticFrame`** — the modern path. The server sends a
  `ClientShellSnapshot` (workspaces, tabs, panes, agents, worktrees, commands)
  plus `PaneSurfaceFrame` / `PaneSurfacePatch` for terminal cell content. The
  client renders its own chrome (sidebar, tab bar, overlays, menus) from that
  data. Code lives in `src/client/shell/` and `src/server/client_shell.rs`.
- **`TerminalAnsi`** — the compatibility path. The server renders the whole UI
  into an in-memory ratatui buffer and ships ANSI diffs
  (`src/protocol/render_ansi.rs`, `BlitEncoder`). The client just writes bytes.

`ClientRenderState` (`src/server/render_stream.rs`) keeps the per-client
baseline for whichever encoding was negotiated.

### The endpoint contract

`src/protocol/endpoint.rs` defines a **separately versioned** JSON handshake
(`ENDPOINT_PROTOCOL_GENERATION = 1`) used for client-owned shells over Local,
SSH, and Cloud connections. It is deliberately independent of the private
same-install bincode protocol, because those clients may be a different build.

Rules (enforced by frozen fixtures under `tests/fixtures/`):

- Named codecs (`shell.snapshot.v1`, `shell.surface.v1`,
  `shell.input.semantic.v1`, `shell.blob.v1`) are **immutable**. Add a new codec
  name; never reinterpret an old one.
- New JSON fields must be optional or carry a serde default. New enum values
  need an `Unknown` fallback.
- New server capabilities go through *advertised methods* — a missing method
  disables one action, never the whole connection.
- Enums reachable from a frozen codec are append-closed; existing-value digests
  can't catch an appended variant, so review by hand.

---

## 3. Module map

```
src/
├── main.rs              role dispatch, default config template, nesting guard
├── cli.rs, cli/         one-shot CLI verbs → JSON API
│
├── server/              headless runtime (~22k lines)
│   ├── headless.rs      the main event loop
│   ├── clients.rs       connected-client registry, per-client view state
│   ├── client_shell.rs  builds ClientShellSnapshot + pane surfaces
│   ├── render_stream.rs virtual ratatui render + frame diffing
│   ├── client_transport.rs, client_accept.rs   framing, accept loop
│   ├── handoff.rs       live upgrade: pass PTY fds to a new binary (unix)
│   ├── terminal_attach.rs   direct single-terminal attach/observe
│   └── autodetect.rs, notifications.rs, pane_input.rs, keybindings.rs
│
├── client/              thin TUI (~35k lines)
│   ├── mod.rs           connect, terminal setup/teardown, event loop
│   ├── handshake.rs     protocol + codec negotiation
│   ├── shell/           client-owned UI: sidebar, tabs, overlays, menus,
│   │                    copy mode, context menus, settings, mouse
│   ├── input/           key/mouse decoding (incl. Windows VTI backend)
│   ├── frame_output.rs, direct_graphics.rs, clipboard_images.rs
│   └── terminal_geometry.rs   cell-size / appearance queries to the host term
│
├── app/                 orchestration (~36k lines)
│   ├── state.rs         AppState — pure data, no channels, no async
│   ├── actions.rs       state mutations (testable without PTYs)
│   ├── runtime.rs       render cadence, timers, event draining
│   ├── agents.rs, agent_view.rs, agent_resume.rs
│   ├── creation.rs, worktrees.rs, session.rs, popup.rs
│   └── api/             API method handlers
│
├── protocol/            wire.rs, endpoint.rs, render_ansi.rs
├── api/                 JSON API server, schema, event hub, subscriptions
│
├── workspace.rs, workspace/   Workspace, Tab, git identity, roll-up aggregation
├── layout.rs            BSP tiling tree (Node, TileLayout, PaneId, SplitBorder)
├── pane.rs, pane/       PaneRuntime (PTY + tasks), OSC handling, cursor,
│                        kitty keyboard, xtgettcap, agent_detection arbitration
├── terminal/            TerminalRuntime / TerminalState / registry
├── pty/                 PTY backend + actor (vendored portable-pty)
├── ghostty/             FFI bindings to vendored libghostty-vt
│
├── detect/              agent state detection from screen text
├── integration/         agent hook installers (claude, codex, pi, opencode, …)
├── persist/             session snapshot / restore / plugin registry
├── config/, config.rs   TOML config: theme, keybinds, sidebar, sounds
├── platform/            per-OS code: unix_common, linux, macos, windows, fallback
├── remote/              SSH attach + stdio bridge
├── ui/, ui.rs           server-side ratatui widgets (TerminalAnsi path)
├── input/               key parsing, prefix/navigate mode
└── kitty_graphics.rs, pane_graphics_files.rs, sound.rs, update.rs, worktree.rs
```

Supporting trees: `distribution/` (install scripts, agent-detection manifests,
release manifests), `docs/` (versioned website content + API schema),
`vendor/` (libghostty-vt, portable-pty), `workers/` (Cloudflare worker for the
plugin marketplace), `skills/` and `.agents/` (agent-facing instructions),
`packaging/`, `nix/`, `justfile`.

---

## 4. Core data model

```
AppState
└── Vec<Workspace>                  top-level project container
    └── Vec<Tab>                    a layout within a workspace
        └── TileLayout              BSP tree of splits
            └── PaneId ─────────────► PaneState   (data)
                                    └► PaneRuntime (PTY, tasks, channels)
```

`src/layout.rs` holds the tiling tree:

```rust
pub enum Node {
    Leaf(PaneId),
    Split { direction, ratio, children },
}
pub struct TileLayout { root: Node, focused: PaneId, /* … */ }
```

`PaneId` is a process-global atomic counter. Public, user-facing IDs
(`workspace.rs::public_pane_id_for_number`, `encode_public_number`) are derived
separately so the API surface stays stable and human-typable.

The **state/runtime split** is the central invariant: `PaneState` is plain data,
`PaneRuntime` owns the PTY, background tasks, and channels. Dropping a
`PaneRuntime` shuts down its tasks and closes the PTY. `AppState::test_new()`
and `Workspace::test_new()` build full state graphs with no PTYs and no tokio
runtime, which is why most logic is unit-testable in-process.

---

## 5. Data flow

### 5.1 Output: PTY → client pixels

```
agent process
    │ bytes
PTY reader task (src/pty/actor)
    │ Bytes over mpsc
libghostty-vt parser (src/ghostty)  ── maintains grid, scrollback, modes, OSC
    │
TerminalState (src/terminal/state.rs)
    │ RenderSignal wakes the loop
server main loop (src/server/headless.rs)
    ├── SemanticFrame clients → client_shell::snapshot() + render_pane_surface()
    │                            → PaneSurfaceFrame / PaneSurfacePatch
    └── TerminalAnsi clients  → ratatui render into TestBackend buffer
                                 → BlitEncoder diff → TerminalFrame
    │
per-client framing (client_transport.rs)
    │
client (src/client) → writes to the real terminal
```

`RenderSignal` and `render_prof.rs` coalesce wakeups; `MIN_RENDER_INTERVAL` is
16 ms. Hidden panes still parse output — but their output must not trigger
presentation work merely to keep terminal or detection state current.

### 5.2 Input: keystroke → PTY

```
host terminal → client stdin
    │ crossterm events (or Windows VTI backend)
client input decoding (src/client/input/)
    │
    ├── client-local? (overlays, menus, copy mode, sidebar) → handled in client/shell
    └── otherwise → ClientPaneInputEvent over the socket
                        │
                    server/pane_input.rs → mode routing (terminal/prefix/navigate)
                        │
                    PaneRuntime write half → PTY → process
```

Kitty keyboard protocol, bracketed paste, and dead-key composition are handled
explicitly (`src/pane/kitty_keyboard.rs`, `src/client/shell/composition.rs`).

### 5.3 Agent state detection

Herdr classifies each pane as `working` / `blocked` / `done` / `idle` /
`unknown`, arbitrating several sources in `src/pane/agent_detection.rs`.

1. **Process probe** — the foreground process tree identifies *which* agent is
   running (`detect::Agent`, 23 known agents).
2. **Screen manifests** — declarative TOML rules in
   `distribution/agent-detection/*.toml` match the pane's bottom-buffer text and
   OSC title, producing `AgentDetection { state, visible_idle, visible_blocker,
   visible_working, skip_state_update }`. Rules carry a priority, a region
   selector (`bottom_non_empty_lines(12)`, `last_non_empty_above_prompt_box`,
   `osc_title`, …) and explicit AND/OR gates. They can be refreshed out of band
   via `detect/manifest_update.rs`.
3. **PTY activity** — the normal authority for `working`.
4. **Integration hooks** — `src/integration/` installs per-agent hook scripts
   (Claude Code, Codex, pi, opencode, Kimi, …) that report authoritative state
   back through the JSON API (`HookStateReported`, `HookMetadataReported`,
   `AgentSessionReported`). Panes identify themselves by `HERDR_PANE_ID` /
   `HERDR_TAB_ID` / `HERDR_WORKSPACE_ID`, injected into the pane environment.

Debouncing matters: `PendingIdleConfirmation` holds a working→idle transition
for up to 700 ms across 3 confirmations so a momentarily quiet agent doesn't
flicker to idle.

The detector reads a screen *snapshot* and never touches the parser or viewport
state. It deliberately reads the bottom buffer rather than the user-visible
viewport, because users scroll.

### 5.4 Events

`src/events.rs::AppEvent` is the internal channel from background tasks to the
main loop — `PaneDied`, `AgentProcessDetected`, `StateChanged`, `TerminalBell`,
`ClipboardWrite`, `TerminalCwdReported`, `GitStatusRefreshed`, `UpdateReady`,
and the hook-reported variants. The loop drains these in bounded batches, then
drains API requests, then runs scheduled work (git remote status at 1.5 s, repo
discovery at 5 min, update check at 30 min, session save debounced at 5 s).

---

## 6. Terminal emulation

Herdr does not implement a VT parser. `vendor/libghostty-vt` (Ghostty's terminal
core, written in Zig) is built by `build.rs` with `zig build -Demit-lib-vt` and
statically linked; `src/ghostty/bindings.rs` is bindgen-generated FFI and
`src/ghostty/mod.rs` is the safe Rust wrapper.

This makes **Zig 0.15.2 a hard build dependency**. `build.rs` panics with
install guidance when `zig` is missing, and maps Rust targets to Zig targets in
`zig_target()` for cross-compilation.

`portable-pty` is pinned to a vendored copy (`vendor/portable-pty`) through
`[patch.crates-io]`, covering both Unix PTYs and Windows ConPTY.

---

## 7. Persistence, restore, and live handoff

**Session snapshot** (`src/persist/`) serializes workspaces, tabs, the BSP tree,
pane cwds, and agent session metadata to `session.json` in a versioned format.
Screen history is captured separately into `session-history.json` so the
structural snapshot stays small. `persist::restore()` rebuilds `AppState` and
respawns panes on server start.

**Live handoff** (`src/server/handoff.rs`, unix only) upgrades the running binary
without killing agents: the old server passes duplicated PTY file descriptors
plus a `HandoffManifest` (snapshot, up to 8 KiB of replay bytes per pane, max 64
fds) over a Unix socket to a newly spawned server, which assumes ownership and
commits. `herdr update --handoff` drives this. Windows restores from snapshot
instead.

**Worktrees** (`src/worktree.rs`, `src/workspace/git/`) make git worktrees
first-class workspace containers, with creation, opening, and removal guarded
against active agent panes.

---

## 8. Platform isolation

OS-specific behavior lives in `src/platform/<os>.rs`. Core modules do not carry
`#[cfg(target_os)]`; `src/platform/mod.rs` exposes only shared traits, types,
wrappers, and testable contracts.

Windows diverges most: ConPTY instead of a real PTY, named pipes instead of Unix
sockets, a WMI-based process-tree probe, a virtual-terminal-input key backend,
its own clipboard image path, PowerShell prompt hooks that emit OSC 9;9 so cwd
tracking works (PowerShell never updates its Win32 process cwd on
`Set-Location`), and no live handoff. Shell launch policy is parameterized by a
target-platform enum rather than raw `cfg!` checks, so every branch stays
testable on every host.

---

## 9. Extension points

| Surface | Where | How |
| --- | --- | --- |
| JSON API | `src/api/schema/` | Add a `Method` variant + handler in `src/app/api/`; regenerate the schema |
| Agent detection | `distribution/agent-detection/*.toml` | Declarative rules, versioned, remotely updatable |
| Agent hooks | `src/integration/assets/<agent>/` | Installed scripts that report state via the API |
| Plugins | `plugins.json`, `src/plugin_command.rs`, `workers/plugin-marketplace` | External commands surfaced in the UI |
| Config | `src/config/` | TOML at `~/.config/herdr/config.toml`; `--default-config` prints the annotated template |
| Themes | `src/config/theme.rs`, `src/terminal_theme.rs` | Built-in themes, per-token overrides, light/dark auto-switch |
| Keybindings | `src/config/keybinds.rs`, `src/server/keybindings.rs` | Prefix-mode actions and direct chords |

---

## 10. Invariants worth knowing before changing things

These come from `AGENTS.md` and are enforced by tests and review.

1. **State is separate from runtime.** `AppState` is pure data. `PaneState` is
   not `PaneRuntime`. Workspace logic must not need real terminals.
2. **Render is pure.** `compute_view()` does geometry and mutation; `render()`
   takes `&AppState` and only draws. Never mutate state during render.
3. **No god objects.** `app/` is split into state / actions / input. Keep it split.
4. **Platform code is isolated.** See §8.
5. **Detection is decoupled.** The detector reads a snapshot; it never reaches
   into the parser or viewport.
6. **Runtime/client boundary.** Classify every new field before adding it.
   Shared runtime facts (pane/agent metadata, process state, terminal state,
   events) belong in server state and the JSON API; presentation state (sidebar
   layout, colors, selection, modals, mouse/viewport) belongs to the client. Use
   neutral server/API names — never UI names like *sidebar*, *row*, *card*. Do
   not add shared behavior reachable only through the private TUI socket.
7. **Endpoint generation 1 is a compatibility floor.** See §2.
8. **Performance paths are multiplicative.** Work reachable from view
   computation, rendering, background-pane resizing, PTY parsing, detection, and
   client frame fanout scales as *per byte/event/render × panes × tabs ×
   workspaces × attached clients*. Inside those loops: narrow accessors only,
   minimal terminal-core lock duration, and preserve hidden-source and
   retained-render early exits. Widening one of them requires profiling at 1 and
   at least 15 populated panes (`just bench-render-scale`).

---

## 11. Build and validation

```bash
just build      # cargo build (requires Zig 0.15.2 for libghostty-vt)
just test       # cargo nextest + maintenance script tests
just check      # formatting check + tests + lint (run before committing)

just bench-render-scale    # pane-cardinality render scaling
just bench-release-smoke   # candidate vs current stable, hidden + visible output
just docs-contract-test    # docs / API schema contract
```

Unit tests live beside the code in `#[cfg(test)] mod tests`. Cross-process
behavior lives in `tests/` — `server_headless.rs`, `client_mode.rs`,
`multi_client.rs`, `detach_reattach.rs`, `live_handoff.rs`, `auto_detect.rs`,
`broken_pipe.rs`, plus frozen protocol fixtures in `tests/fixtures/`.

For identity/state refactors, use the test-only invariant checks
`AppState::assert_invariants_for_test()` and
`Workspace::assert_invariants_for_test()` seeded with
`AppState::test_with_adversarial_identity_state()` or
`Workspace::test_adversarial_identity_state()`.

Prefer deterministic operation or architecture tests over wall-clock CI limits;
benchmarks are supporting evidence, not a substitute for behavioral coverage.
