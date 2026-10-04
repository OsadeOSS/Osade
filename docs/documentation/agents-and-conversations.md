---
title: Agents and conversations
description: Run one or several coding agents in a shared conversation while keeping each agent in its own lane.
---

# Agents and conversations

An Osade conversation can contain one or several **lanes**. A lane is one agent process attached
to one checkout. The conversation provides the shared transcript; each lane keeps its own agent,
branch, status, and terminal session.

## Start with one agent

Create a new chat, choose an installed agent, and send a message. If you do not name another
agent, follow-up messages go to the conversation's primary lane.

The repository setting controls the default agent for new chats. Osade currently recognizes
Claude Code, Codex, OpenCode, and Pi and checks whether each command is available on `PATH`.

## Terminal tabs

The new-session menu (`Ctrl+T` / `Cmd+T`) also opens a plain shell in the repository folder, in
its own tab. It is not attached to any agent or chat.

- On Windows the menu offers **New Terminal: PowerShell**, **New Terminal: CMD Prompt**, and
  **New Terminal: Git Bash**. Git Bash appears only when Git for Windows is installed; Osade looks
  for its `bash.exe` next to `git` on `PATH` and in the standard install folders, so the WSL
  `bash` launcher is never used. Git Bash starts as a login shell but stays in the repository
  folder.
- On macOS and Linux the menu offers one terminal running your `$SHELL`.

The shell keeps running while you switch to other tabs, and its scrollback stays in the tab.
Closing the tab (`Ctrl+W` / `Cmd+W`, or its ×) ends the shell. Terminal tabs are not restored
when Osade restarts.

### Terminal behaviour

Terminal tabs and a lane's **Terminal** view use the same emulator:

- It renders on the GPU through WebGL. If WebGL is unavailable or the graphics context is lost,
  it falls back to the slower DOM renderer and keeps working.
- Character widths follow Unicode 11, so emoji and CJK text line up the way agent TUIs expect.
- Text uses a full 16-colour palette with truecolor (`COLORTERM=truecolor`).
- URLs are clickable and open in your system browser.
- Each terminal keeps up to 10,000 lines of scrollback. If you leave a lane and come back while
  its shell is still running, the terminal shows that shell's most recent output again (about the
  last 256 KB) instead of opening blank.
- `Ctrl+C` copies when text is selected and otherwise interrupts. `Ctrl+V` pastes.

## Run multiple agents in one conversation

Use agent mentions to target work:

```text
Review the authentication change and keep the public API stable.

@claude
Implement the refresh-token fix.

@codex
Add regression tests and look for edge cases.
```

Text before the first mention is shared with every mentioned agent. Text after a mention belongs
to that agent until the next mention. If a mentioned CLI is not installed, Osade reports it before
creating a broken lane.

Each mentioned agent gets a separate lane and an isolated branch/worktree when necessary. The
lane buttons under the conversation title show which agent is focused, its branch, and whether it
is starting, queued, working, or failed. Use the **All** and per-agent filters to read the combined
transcript or one lane at a time.

Before a later turn, Osade can give an agent a short digest of recent sibling-lane activity, such
as whether another agent is working, verifying, or has failing checks. Agents do not silently
share a writable checkout.

## Send follow-ups safely

The composer remains available while an agent is working. Sending during a live turn queues the
follow-up until that lane is ready instead of interrupting the terminal input. The transcript
marks held and failed deliveries.

Switch the Chat surface to **Terminal** when you need the live terminal session. Switching back to
Chat returns to the durable conversation rather than treating terminal output as chat history.

## Add images

Paste, drop, or choose image files in the composer. Osade accepts up to eight PNG, JPEG, WebP,
GIF, or BMP images in one message. The files are placed in the task inbox and the agent is told to
open them. Browser captures use this same path.

## Add another repository as context

Choose **Add read-only context repo** beneath the composer to attach another local repository to
the conversation. Osade tells agents where the context repositories are, but only the primary
worktree is editable. Remove a context repository from the notice above the transcript.

## Plan before implementation

Open **Plan** from the command center when you want a repository-level coordination conversation
before starting implementation. The plan stays attached to the repository checkout and uses the
same chat experience.

See [Branches and worktrees](branches-and-worktrees.md) for checkout isolation and
[Browser view](browser-view.md) for visual context.
