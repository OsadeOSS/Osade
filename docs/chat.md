# Chat

How Osade talks to agents. One composer, one chat, zero or more **lanes**. A lane is one agent process on one checkout. `@claude` and `@codex` are how you pick lanes, not how you address people in a sentence.

## The objects

| Thing | What it is |
| --- | --- |
| **Chat** | One conversation in the sidebar. Shared `chat_id`. Title, composer, transcript. |
| **Lane** | One `task` row inside that chat. Has an `agent_id` (`claude`, `codex`, …), a branch, and a pane. |
| **Turn** | One typed send. Stored in `chat_turn`. Not keystrokes into a terminal. |

The renderer never owns the timeline. It draws `task.turns` from the daemon (CDC). It does not scrape `pane.read` to invent bubbles.

**Plan** is a chat whose `chat_id` is `__orchestrator__:<repoId>`. Same composer, same send path. It stays on the repository checkout (`home: true`) even when another chat already holds it.

## Composer → send

Enter sends. Shift+Enter is a newline. `@name` on its own line opens the catalog picker (Tab/Enter to complete).

The parent (`App.tsx`) owns routing. The composer only calls `onSend(text)`.

```
parseMentions(text, catalog)
        │
        ├─ no @targets  →  one send, to the primary lane
        │                    (draft: repo default agent, else claude)
        │                    (existing chat: first lane's agent)
        │
        └─ @claude / @codex / …  →  one send per target
                                     missing lane → createTask(chatId, isolate: true)
                                     existing lane → taskLaunch if needed, then taskSend
```

`taskSend` is `LaunchTask.sendTurn`. That is a message (`agent.prompt`), not a TUI paste.

## Mentions (`@claude`, `@codex`)

Only a **line that starts with** `@<catalog-id>` is a mention. `ping @claude later` is ordinary text.

Catalog ids today: `claude`, `codex`, `opencode`, `pi`. Unknown `@ghost` stays in the shared preamble and is not a lane.

```
please look at auth
@claude refactor the token refresh
@codex write tests for it
```

parses as:

- **shared** (every targeted lane also gets this): `please look at auth`
- **claude**: `refactor the token refresh`
- **codex**: `write tests for it`

Lines after a mention, until the next `@id` at column 0, belong to that agent.

Each lane receives `shared` plus its own body (`lanePrompt`). An empty `@claude` with no body is not sent as `""`.

On an existing chat, `@codex` when there is no Codex lane yet creates one: same `chat_id`, `isolate: true`, same title and `base_ref` as the first lane. The extra agent gets its own worktree on a new `osade/<slug>/<agentId>` branch.

To put a lane on a branch that already exists, pass `checkoutRef` (the UI: **New chat on &lt;branch&gt;**). That checks the branch out in a worktree instead of forking it. Git only allows one checkout of a branch at a time; a second attempt fails naming the lane that holds it.

Isolated worktrees are disposable. To change branch, close the lane and open one on the target (**Move to another branch**). That keeps the chat and transcript.

The **first** lane of a new chat may attach to the checkout if nothing else is using it. Further lanes from the same compose (`targets.slice(1)`) are always isolated. A second new chat in the same repo is isolated too, unless it is Plan.

## Turns (AO-style, not ACP)

Each send is a `chat_turn` row:

| `delivery` | Meaning |
| --- | --- |
| `queued` | Held while that lane is `working` |
| `sending` | `agent.prompt` in flight |
| `accepted` | Prompt landed |
| `failed` | Prompt threw |

There is no `status` column. Mid-turn follow-ups queue. When the pane goes `done` or `blocked`, the daemon settles the agent's last words (if any) as an `agent` turn (`origin: provider`) and flushes the next queued user turn.

The composer shows **Hold** while the focused lane is implementing / verifying / queued. Enter still sends; it queues.

Automation (verify failure, review comments) uses the same `sendTurn` path with `origin: automation`.

Sibling lanes get a short fact digest (`<osade_lanes>…`), not a transcript dump. The UI strips that block so it never appears as a bubble.

## What you see

Sidebar: chat title, then one nested row per lane (`agentId` + branch).

Transcript: durable turns, plus a live overlay from `agent_fact` while the lane is working. Filter chips appear when a chat has more than one lane.

ACP, steer, and approvals-as-protocol are not this path. Those stay M5.


Fix @-lane delivery. It works for claude and fails for codex because nothing
in the send path waits for a lane to be ready.

## First, verify — do not guess

1. the detection manifest cover codex idle and working states? Compare
   its rules against claude's. If codex has no idle rule, the pane never
   reaches done and no agent turn can ever settle — that is the whole bug.
2. What does agent.prompt actually do to a pane? If it types and presses
   enter, name the method that reports composer readiness. If none exists,
   say so — the fix is different.
3. Run codex manually in a fresh worktree. Does it show a trust prompt, a
   mode selector, or both before an idle composer? Capture the exact surface
   text so it can be matched.
4. Confirm what codex reports via hooks. If it is session id only, the
   settle path has no final_message to read and needs a different source.

## Then fix

### 1. Readiness gate before first send

A lane is not sendable until it reports an idle composer. Add a `ready` fact
to agent_fact, set from the detection manifest, distinct from substrate_state.

- The first turn on a new lane enters as delivery `queued`, not `sending`.
- Flush on ready, not on a timer.
- Hard timeout (45s default, per-agent overridable in the catalog). On
  timeout set delivery `failed` with a message naming the agent and what it
  was waiting for. A lane that never becomes ready must never sit silent.
- This applies to every lane, not just non-primary ones. Claude works today
  by luck of boot speed, not by design.

### 2. Trust prompt and first-run surfaces

isolate: true means a fresh worktree every time, so codex hits its trust
prompt on every new lane. Add manifest rules to auto-confirm it, then clear
the match buffer so stale trust text cannot re-match later. Same for any
mode selector found in step 3. Add these to the substrate's
distribution/agent-detection/*.toml — do not
scrape output from the daemon.

### 3. Settling replies without hook metadata

Do not depend on final_message. Capture the pane surface at turn start, and
again at settle, and store the delta as the agent turn body. Per-agent
trimming rules in the catalog strip the banner, the prompt echo, and the
status footer.

Add a capability flag `reports-final-message`. Agents that have it use it;
agents that don't use the delta path. Branch on the capability, never on
agentId.

### 4. Make fan-out visible immediately

On @codex with no existing lane, render the lane row and a "starting codex"
line in the transcript before createTask returns. Fire all targets in
parallel without awaiting each other. Show per-lane delivery state in the
lane chip: starting / queued / sending / working / failed.

Surface `failed` in the transcript with the error. Right now a failed
delivery is invisible, which is why this reads as lag rather than an error.

### 5. Settle on blocked, not only done

A lane that goes blocked mid-turn (approval, question, quota) must settle
whatever it has said so far and surface the block. Do not hold the turn open
waiting for done that will never come.

## Acceptance

In one chat: "@claude refactor auth" and "@codex write tests for it" in a
single send. Both lane rows appear within 200ms. Both agents receive their
prompt with no text landing in a trust dialog. Both replies appear in the
transcript. Kill codex mid-turn — its lane shows failed with a reason, and
claude's lane is unaffected.