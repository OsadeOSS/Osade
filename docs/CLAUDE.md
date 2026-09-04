Looking at your tree: `docs/CLAUDE.md` won't be auto-loaded — Claude Code reads `CLAUDE.md` from the working directory and its parents, not from `docs/`. You need one at the repo root. And `backend/` almost certainly has herdr's own `AGENTS.md` with herdr's invariants, which will quietly fight yours if Claude Code picks both up.

The bigger trap: hand Claude Code a 1400-line PRD and it will scaffold 40 files against an herdr API it guessed. Split this into two prompts.

## Root `CLAUDE.md`

```markdown
# Osade

Osade runs coding agents as open-source contributors. Full spec: @docs/OSADE.md

## Layout
- `backend/` — herdr (Rust). **READ-ONLY. Never edit.** Reference implementation + API source of truth.
- `apps/desktop/` — Electron shell
- `packages/` — daemon, contract, cli, skill-assets
- `docs/` — OSADE.md is the spec. AOagents.txt / cline.txt / herdr.txt are research inputs, not requirements.

## Standing rules
- Never edit anything under `backend/`. If herdr needs a change, write it to `patches/` with a rationale.
- herdr's own AGENTS.md rules apply to `backend/` only. They do not govern Osade code.
- No `status` column in any table. Status is derived at read time (OSADE.md §6). This is not negotiable.
- Only `packages/daemon/src/herdr/**` may talk to herdr.
- Only `packages/daemon/src/scm/**` may import Octokit.
- Never hand-write an herdr API method name. Generate the client from the schema.
- No `any`. No `console.*` in daemon src outside `cli.ts`.

## Before implementing
Read the relevant OSADE.md section in full. Sections marked INVARIANT or DECISION are settled — implement them, don't relitigate.
```

## Prompt 1 — recon, no product code

```
Read docs/OSADE.md in full. Then verify its assumptions against the real herdr
source in backend/. Write NO product code in this task.

backend/ is read-only. You are reading it to find out what is actually true.

Answer these against the source, citing file paths and line numbers:

1. Does docs/next/api/herdr-api.schema.json exist in backend/, and is it current
   with src/api/schema/? If stale, note how it's regenerated.
2. List the exact JSON API Method variants for: creating a workspace rooted at a
   path, creating/removing a git worktree, creating a tab, spawning a process in a
   pane with custom argv/env/cwd, sending input to a pane, killing a pane.
   If any of these does not exist, say so plainly.
3. List the exact EventHub event names and payloads for agent status changes and
   hook reports. OSADE.md §7 guesses at PaneAgentStatusChanged, HookStateReported,
   HookMetadataReported, AgentSessionReported. Confirm or correct each.
4. Can the herdr server spawn and keep panes alive with ZERO clients attached?
   Trace the code path. Osade's daemon spawns agents with no herdr TUI running —
   if this doesn't work the whole architecture is wrong.
5. Can we run an isolated named session (`osade`) that won't collide with a user's
   own herdr session? How is it selected?
6. Which agents have hook integrations in src/integration/assets/, and what
   metadata does each report back?
7. Is the endpoint protocol (src/protocol/endpoint.rs, generation 1) usable by an
   external client today, or is it gated behind something not yet wired up?
8. What does `just build` require on this machine? Is Zig 0.15.2 present?

Produce two files:

- docs/HERDR-CONTRACT.md — the verified surface. Real method names, real event
  names, real payload shapes, with file:line citations. This becomes the contract
  the daemon codes against.
- docs/PRD-DELTA.md — every assumption in OSADE.md that turned out wrong or
  unverifiable, with a proposed correction. Be blunt. If §4.4's cell-surface
  rendering plan isn't feasible from outside, say so now, not in week three.

Stop after those two files. Do not scaffold anything.
```

## Prompt 2 — M0, only after you've read the delta

```
Read docs/OSADE.md §21 (M0), docs/HERDR-CONTRACT.md, and docs/PRD-DELTA.md.

Build M0 only. Scope is the six checkboxes under M0 — nothing from M1+.
No GitHub, no conventions miner, no memory, no gates.

Order:
1. Generate the typed herdr client from the schema into
   packages/daemon/src/herdr/generated/. Commit schema + generated output + the
   pinned herdr version. Add the boot version guard.
2. packages/contract/ — Zod schemas for task, agent_fact, and the WS message union.
3. packages/daemon/src/db/ — sqlite, migrations, change_log triggers, CDC poller.
   Verify with a test that a raw SQL update produces a WS push.
4. deriveStatus for rows 4, 10, 11, 13, 14 only. Pure function, property test:
   any ordering of fact writes ends at the same status.
5. packages/daemon/src/herdr/event-subscriber.ts writing agent_fact.
6. apps/desktop — userData redirect first, supervisor, utilityProcess surface
   transport, canvas cell renderer.

Acceptance, and I will test exactly this: I type a prompt, Claude Code spawns in
an isolated worktree, its terminal renders inside the Electron window, and the row
moves queued → implementing → needs_input → awaiting_review driven entirely by
herdr's detection. Nothing polled. No status column in the database.

Work in thin vertical slices. Get one task end-to-end before making anything
general. Stop and ask if HERDR-CONTRACT.md contradicts what you need.
```

Three things worth knowing:

**Your `backend/` layout is better than what I specced.** I wrote §4.1 assuming you'd vendor a binary and read a published schema. With the source in-tree you can read `src/api/schema/` directly, which makes prompt 1 much more reliable. Keep the source, but still ship a prebuilt binary at distribution time — Zig 0.15.2 as a user install prerequisite will kill adoption.

**Question 4 in the recon prompt is the one that can invalidate the architecture.** herdr's docs say the server survives client detach and panes keep running, so it should be fine, but "survives detach" and "spawns correctly with no client ever attached" are different code paths. If it's the latter, you find out in an hour instead of week three.

**Don't skip prompt 1.** It looks like overhead. It's the difference between Claude Code building against reality and building against my inference from an architecture doc.