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
Closing the tab (`Ctrl+W` / `Cmd+W`, or its ×) ends the shell and discards its saved output.

### Terminal tabs persist

Terminal tabs come back when you reopen Osade, in the same order, with the same tab selected.
Shells run in the Osade daemon, which keeps running after the window closes. So closing the window
does not stop a terminal or anything running in it, such as an agent mid-task. When the window
opens again, each tab reconnects to its shell and shows its recent output (about the last 256 KB).

If the daemon itself stopped, for example after a reboot or an Osade update, the shell is gone. The
tab still comes back: it shows the output saved before the daemon stopped, a line saying Osade
restarted, and a fresh shell in the same folder. Output is saved to `~/.osade/terminals/` about
once a second while a terminal is busy. A crash can lose the last second, but a normal shutdown
saves everything.

Open tabs are remembered on this computer. If a terminal's folder no longer exists, the
reopened tab shows the error instead of a shell.

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

### Agents started in a terminal tab

If you start a coding agent yourself in a terminal tab, Osade notices it and lists it in the
sidebar under the project, in a **Terminal** card. Clicking the row switches to that tab, and the
tab itself shows the agent's icon and topic in place of the shell's name.

Osade finds the agent by checking the processes running under the tab's shell about every two
seconds, so detection does not depend on the agent cooperating. It recognises Claude Code, Codex,
Gemini, Antigravity (`agy`), OpenCode, Cline, Kiro (`kiro-cli`), Freebuff, Codebuff, Aider,
Goose, Amp, Kilo Code, Crush, Auggie, GitHub Copilot, Cursor (`cursor-agent`), Droid, Qwen Code,
Kimi, Mistral Vibe, Continue (`cn`), Hermes, OpenClaw, Grok, Devin, Qoder, CodeBuddy, OpenClaude,
Pi, Trae, Autohand, Command Code, MiMo Code, ZCode, and Jcode. They are recognised:

- by executable name (`claude.exe`, `kiro-cli`, platform builds such as `codex-x86_64-…`);
- or, for agents installed as Node or Python packages, by the script being run
  (`node …/node_modules/cline/…`, `python -m aider`).

The row leaves the sidebar when the agent process exits.

Each row shows one of three states:

- **Running**: the agent is open. Agents that do not report their state stay here.
- **Working** (pulsing): the agent is busy.
- **Done**: it finished a turn, or is asking for permission, and is waiting for you.

**Working** and **Done** come from the window title the agent sets. Claude Code (`✳` and spinner
titles) and Gemini (`✦`, `◇`, `✋`) report them, and so does any agent that puts a spinner glyph
in front of its title. If the agent writes a topic into the title, the row shows that topic.

These agents are not chats: Osade does not record their conversation, and the rows disappear
when the tab closes. Only terminal tabs are checked, not a lane's **Terminal** view. An agent
running on another machine over `ssh` is not detected.

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

A conversation shows only the chat. To work in a terminal, open a terminal tab for the project
(see [Terminal tabs](#terminal-tabs)); terminal output never becomes chat history.

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
