# ADR 0001 — No embedded terminal in M0

- **Status:** accepted
- **Date:** 2026-09-04
- **Supersedes:** OSADE.md §4.4 as originally written ("Canvas 2D grid renderer … 15
  concurrently visible panes at 60fps")
- **Evidence:** `docs/HERDR-CONTRACT.md`, `docs/PRD-DELTA.md` #3
- **Target:** herdr `0.8.2-p20` (`vendor/herdr/0.8.2-p20/pin.json`)

---

## Question

Osade needs to show the user what an agent is doing. §4.4 originally answered this with a
canvas cell renderer over herdr's endpoint protocol. Recon invalidated three of the four facts
that decision rested on, so the question was reopened:

1. Is there any **JSON API** path that returns pane screen content?
2. Given the answer, which of three approaches should M0 take?

---

## 1. Screen content in the JSON API

Surveyed all **91 methods** in the pinned schema (`vendor/herdr/0.8.2-p20/methods.txt`).

herdr's detector does read a cell grid in-process — `AgentState` is derived from a screen
snapshot — but **the grid itself is never exposed.** What crosses the JSON API is rendered
*text*.

### Candidates

#### `pane.read` — the only real one

```
params  { pane_id: string,
          source: "visible" | "recent" | "recent_unwrapped" | "detection",
          lines?: uint32,          // capped at 1000 server-side
          format: "text" | "ansi", // default "text"
          strip_ansi: bool }       // default true

result  { pane_id, workspace_id, tab_id, source, format,
          text: string, revision: uint64, truncated: bool }
```

- **Styled or plain?** Both, but never structured. `format:"text"` gives plain text.
  `format:"ansi"` with `strip_ansi:false` gives an ANSI byte stream that carries SGR
  attributes — feedable to xterm.js as a full repaint, **not** a cell array with typed
  attributes.
- **What it does not carry:** cursor position, cursor shape, cursor visibility, selection,
  scroll offset, wide-cell metadata, graphics placements. You cannot render a correct terminal
  from it, only a transcript.
- **Sources:** `visible` = the current viewport; `recent` / `recent_unwrapped` = the last N
  lines of scrollback (default 80, cap 1000); `detection` = the bottom-buffer slice herdr's own
  detector reads.
- **Pollable?** Technically yes, badly. One request is one connection is one OS thread on
  herdr (§4.2). At 30fps × 3 surfaces that is ~90 connection setups per second, each returning
  a whole screen with no diffing. `revision` allows change detection — but only *after* the
  read that returns it, so it saves rendering, not I/O. **Fine at ≤1 Hz, wrong at 30fps.**

#### `agent.read`

Identical params and result, keyed by agent `target` (name or pane id) instead of `pane_id`.
Same limits. Convenience, not capability.

#### `session.snapshot`

Returns `workspaces[] / tabs[] / panes[] / layouts[] / agents[]` — topology and status, plus
`AgentInfo.terminal_title_stripped`. **No screen content.** Its value here is the activity
string, which is free and already flowing.

#### `pane.layout` / `layout.export`

Pane geometry and split ratios. Useful for reproducing herdr's layout; no cell content.

#### `pane.graphics.info`

Kitty graphics placements only. Not text.

### Not available on this target

Three adjacent methods exist in `backend/src` but are **absent from the pinned schema** — they
are part of the ten-method gap between the source tree and the shipped binary
(PRD-DELTA #1):

```
pane.selection.read     pane.scroll     pane.edit_scrollback
```

So on `0.8.2-p20` there is no way to read a selection, drive scrollback position, or open the
scrollback editor over the JSON API. Any design leaning on them is designing against a herdr
that has not shipped.

### Conclusion

**One method returns screen content: `pane.read` (with `agent.read` as an alias).** It returns
text or ANSI, never a structured cell grid, and it is a one-shot snapshot suited to ≤1 Hz
refresh. The cell grid exists only behind the bincode endpoint protocol.

---

## 2. The three options

### (a) Bincode decoder over the endpoint protocol, one connection per surface, LRU 3

| | |
| --- | --- |
| **Fragility** | **Highest.** Bincode enum tags are positional. A herdr build that inserts a `ServerMessage` variant shifts every tag after it, and the decoder misreads *silently* — wrong frame type, plausible garbage, no error. Only `EndpointControl` is contractually append-only (`wire.rs:1444-1448`). |
| **Version negotiation** | The handshake negotiates `generation` and four codec names, and deliberately does **not** compare build versions — that is the stability promise. But it covers the *envelope*, not the struct layouts inside it. A herdr whose `FrameData` gained a field still says "generation 1, codecs match" and then sends frames the decoder cannot read. **There is no handshake-level protection against exactly the failure this option is most likely to hit.** |
| **Work to first pixel** | **Highest.** Bincode decoder for ~30 `ServerMessage` variants plus `FrameData`, `CellData`, `SurfaceGraphicsScene`, `ClientShellSnapshot`; then canvas grid renderer, damage tracking, wide cells, cursor shape and visibility, selection highlight, kitty placeholders; then input encoding — kitty keyboard protocol, bracketed paste, dead-key composition; then multi-viewer backpressure. Weeks before the first correct frame. |
| **On a protocol bump** | Silent corruption in the worst case, decoder rewrite in the best. Note the bump has already happened once *between two builds both labelled 0.8.2* (20 → 22). |
| **What it uniquely buys** | A real, interactive, in-window terminal. Nothing else on this list can do that. |

### (b) JSON capture polled per visible surface

| | |
| --- | --- |
| **Fragility** | **Lowest.** `pane.read` is plain JSON in the pinned schema, and the boot drift check (§4.1.1) turns its disappearance into a loud startup failure rather than a silent one. |
| **Work to first pixel** | **Lowest.** Request → `text` → `<pre>`, or ANSI → xterm.js `write()`. Hours. |
| **On a protocol bump** | Caught at boot by assertion 2 (missing pinned method), with an actionable message. Benign. |
| **What breaks it** | It cannot be a terminal. No cursor, no selection, no scroll control — and `pane.selection.read` / `pane.scroll` are not on this target. At 30fps it means ~90 connections/sec, each returning a full screen with no diffing, against a server that spawns a thread per connection. That is precisely the multiplicative hot path herdr's own `AGENTS.md` warns about, and Osade would be the one causing it. |

### (c) No embedded terminal in M0

| | |
| --- | --- |
| **Fragility** | **None at the surface layer** — there is no surface layer. Remaining herdr coupling is the JSON API, already covered by the drift check. |
| **Work to first pixel** | **Zero.** "Open in herdr" is `herdr session attach osade`. |
| **On a protocol bump** | Nothing to break. |
| **What it costs** | The user leaves the window to watch a terminal live. |

---

## Decision

**(c). M0 ships no embedded terminal.**

The reasoning, in order of weight:

**1. M0's acceptance criterion never needed a pixel.** §21 asks that a row move
`queued → implementing → needs_input → awaiting_review` driven entirely by herdr's detection,
with nothing polled. That full path was verified end-to-end against a live herdr with **no
client attached and no cell ever rendered** (`HERDR-CONTRACT.md` §3.3). Option (a) is the
single largest work item in M0 and it validates none of the milestone's actual claim.

**2. The riskiest component would land before the product it serves.** Osade's thesis is
review cost, not terminal fidelity. Shipping a bincode decoder before a ledger inverts the
risk ordering: the most fragile, least differentiating piece would gate the most valuable one.

**3. What users need to read is not herdr cells.** Verification output, diffs, gate payloads
and the activity line are all files or facts Osade owns on disk. The live terminal is the one
thing a real herdr client already renders perfectly, for free, with correct input.

**4. Option (a)'s failure mode is silent.** Since the endpoint handshake validates the envelope
rather than the payload structs, a herdr upgrade can leave the decoder reading garbage while
reporting a successful handshake. Taking on that class of bug in M0 — with no ledger yet to
notice it is misbehaving — is the wrong order to discover it in.

### Not (b), and not a hybrid

(b) is rejected **as the surface strategy**: it cannot render a terminal, and polling it fast
enough to feel live abuses herdr's connection model.

But `pane.read` is used *within* (c), for what it is actually good at: an on-demand transcript
panel — "show me the last 200 lines of this agent's pane" — refreshed on user action or at
≤1 Hz, keyed on `revision` to skip unchanged reads. That is a static panel, not a render loop,
and it is a few hours of work. This is not option (b) in disguise; it is the honest use of the
only screen-content method the pinned schema exposes.

---

## Consequences

- OSADE.md §4.4 is rewritten; §18.2 becomes the M1 design; §18.1's `surface/` trees are marked
  M1; §21's M0 checklist drops the utility process and canvas renderer.
- §23 open question 5 is closed: the `TerminalAnsi` + xterm.js fallback it named **does not
  exist** for endpoint clients (`RenderEncoding` is negotiated only on herdr's private
  `TerminalHello` path; `do_handshake` hardcodes `SemanticFrame`,
  `backend/src/client/handshake.rs:236-238`).
- **New INVARIANT, recorded in §4.4 and §6.1.** Attaching any client marks panes seen, and
  `agent_status` is `done` only while a pane is idle **and unseen**
  (`backend/src/app/api_helpers.rs:100-106`). So "Open in herdr" flips `done → idle` for that
  tab. This is safe *only* because `idle` is inert in the event mapping. It also means Osade
  must never call `pane.focus` or `agent.focus` on a task lane — doing so would silently clear
  its own `awaiting_review`. Discovered while answering this question; it would have been a
  genuinely confusing bug.
- The frame-rate target must be re-derived when (a) returns: a connection renders **one
  composited tab**, so "15 panes at 60fps" was never the right unit.

## Revisit when

M1, behind an explicit gate, and only if the ledger has shipped and users ask for an in-window
terminal. Entry conditions for reopening:

1. A bincode decoder pinned to the vendored herdr, with a boot assertion that a known frame
   decodes — non-negotiable, given the silent-corruption mode.
2. One endpoint connection per visible surface, LRU-capped at 3.
3. A benchmark stated in tabs, on a 2021-class laptop, before any UI work.

Write ADR 0002 when that gate opens.
