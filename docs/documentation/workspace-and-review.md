---
title: Workspace and review
description: Follow every conversation, inspect files and diffs, run checks, and keep the active context attached to your message.
---

# Workspace and review

Osade keeps the conversation, implementation evidence, and repository context in one window,
arranged in four parts:

- **Left sidebar** — Search, the **Tasks**, **Browser**, and **Notes** views, and your projects.
- **Centre** — open conversations and terminals as tabs, with the selected one below them.
- **Side panel** — Files, Checks, Changes, Rules, and Notes for the conversation in front of you.
- **Status bar** — running agents, chat count, daemon connection, and GitHub sign-in.

Switching tabs does not stop any agent.

## The sidebar

The top row has buttons to hide the sidebar and to go back and forward through the tabs you have
viewed. **Search** opens the command center.

Under **Projects**, each repository shows its conversations grouped by branch. A branch marked
**primary** is the repository's own checkout rather than an isolated worktree. Each conversation
row shows its status colour, its agent, its title, and how long ago it was last active. Click a
project or a branch's chat count to fold it. Double-click or right-click a project's name to rename
it. Hover over a project to show its **+** button, which starts a new session there. The
open-folder button beside **Projects** opens another repository and shows the new-session menu
for it. The gear at the bottom of the sidebar sets the repository's default agent.

Use `J` and `K` when you are not typing to select the next or previous conversation.

## Tasks (Kanban)

Select **Tasks** for a workspace-wide status board in the centre. Select it again, or open a
conversation, to go back. Cards are derived into these columns:

- **Needs you** for approvals or other human input
- **Working** for implementing or verifying sessions
- **Failed** for failed verification, CI, or external blocks
- **In review** for open pull requests
- **Ready to merge** for merged work
- **The rest** for queued and inactive sessions

Right-click a conversation to archive it from the ledger. Archiving hides the task; it does not
kill its underlying agent process.

## The conversation and the side panel

The centre shows the conversation: durable user and agent turns, lane filters, approval requests,
and the composer. There is no session header; the conversation starts right below the tabs. A
switch above it moves the centre between **Chat**, **Terminal** (the live terminal), and, once you
have opened one, **File** and **Diff**. The branch menu sits at the right of that switch. When a conversation has more than one lane, a row of lane buttons above it
picks which lane the views and terminal follow.

The side panel holds the other views. Pick one from its icon row, or press `2` through `6` when
you are not typing:

- **Files** (`2`) — the task checkout's file tree, with Git status and insertion/deletion counts.
  Click a file to open it in the centre, where you can edit it, save with `Ctrl+S` (`Cmd+S`), and
  preview Markdown. Opened files get tabs along the top of the centre; double-click a file in the
  tree to keep its tab open.
- **Checks** (`3`) — detect, review, edit, confirm, and run the repository's verification plan;
  inspect the latest result and logs for every step.
- **Changes** (`4`) — working-tree changes and unpushed commits with per-file additions and
  deletions, plus **Open pull request**. Click a file to show its diff in the centre, then select
  lines to ask about.
- **Rules** (`5`) — maintain the repository instructions that are injected into agent sessions.
- **Notes** (`6`) — capture and manage repository-scoped reminders.

Show or hide the panel with the button at the right end of the tab strip. Drag its left edge to
resize it, and double-click the edge to reset the width. Osade remembers whether it was open and how
wide it was. In windows narrower than 960 px, the sidebar and the panel start hidden. With no
conversation open, the panel shows its icons disabled.

An open file or diff stays open while you look at another panel view. Switch back with **File** or
**Diff**. Focusing a different lane closes them, since that lane has its own working tree.

## Ask about what you are viewing

The composer stays below the centre. Osade prepares context from what you are looking at:

- the whole open file, or the selected lines, while a file is in the centre;
- the focused check and its log tail in Checks;
- the current diff hunk while a diff is in the centre;
- the focused rule in Rules.

The attachment appears above the composer and is prepended to the next message. Dismiss it when
you want to ask without that context. With a diff in the centre, the **Ask** button can also copy the
selected lines into the composer explicitly.

## Command center

Press `Ctrl+K` (`Cmd+K` on macOS) to search conversations and run workspace actions. It includes
new chat, Plan, List/Kanban, Browser, quick note, Notes, start agent, run checks, and request pull
request. Use the arrow keys and Enter to run an item.

See [Verification and publishing](verification-and-publishing.md) for checks and approval gates.
