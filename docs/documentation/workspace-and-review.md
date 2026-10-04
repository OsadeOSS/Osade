---
title: Workspace and review
description: Follow every conversation, inspect files and diffs, run checks, and keep the active context attached to your message.
---

# Workspace and review

Osade keeps the conversation, implementation evidence, and repository context in one workspace.
The left sidebar groups conversations by repository and shows the work that needs attention first.
Open conversations appear as tabs and can be switched without stopping their agents.

## List and Kanban views

The conversation list is optimized for moving between active sessions. Use `J` and `K` when you
are not typing to select the next or previous conversation.

Switch to **Kanban** for a workspace-wide status view. Cards are derived into these columns:

- **Needs you** for approvals or other human input
- **Working** for implementing or verifying sessions
- **Failed** for failed verification, CI, or external blocks
- **In review** for open pull requests
- **Ready to merge** for merged work
- **The rest** for queued and inactive sessions

Right-click a conversation to archive it from the ledger. Archiving hides the task; it does not
kill its underlying agent process.

## The six workspace views

Use the tabs above the content area or press `1` through `6`:

1. **Chat** — durable user and agent turns, lane filters, approval requests, and the optional live
   terminal surface.
2. **Files** — browse the task checkout, open and edit text files, preview Markdown, and see Git
   status plus insertion/deletion counts.
3. **Checks** — detect, review, edit, confirm, and run the repository's verification plan; inspect
   the latest result and logs for every step.
4. **Diff** — review working-tree changes and unpushed commits, inspect per-file additions and
   deletions, and select lines to ask about.
5. **Rules** — maintain the repository instructions that are injected into agent sessions.
6. **Notes** — capture and manage repository-scoped reminders.

## Ask about what you are viewing

The composer stays available in Files, Checks, Diff, Rules, and Notes. Osade prepares context from
the current view:

- the whole open file or selected lines in Files;
- the focused check and its log tail in Checks;
- the current diff hunk in Diff;
- the focused rule in Rules.

The attachment appears above the composer and is prepended to the next message. Dismiss it when
you want to ask without that context. In Diff, the **Ask** button can also copy the selected lines
into the composer explicitly.

## Command center

Press `Ctrl+K` (`Cmd+K` on macOS) to search conversations and run workspace actions. It includes
new chat, Plan, List/Kanban, Browser, quick note, Notes, start agent, run checks, and request pull
request. Use the arrow keys and Enter to run an item.

See [Verification and publishing](verification-and-publishing.md) for checks and approval gates.
