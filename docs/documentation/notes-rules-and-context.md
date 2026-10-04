---
title: Notes, rules, and context
description: Preserve repository knowledge with quick notes, durable agent rules, and read-only context repositories.
---

# Notes, rules, and context

Osade keeps durable repository context separate from a single chat so useful information survives
across agents and worktrees.

## Quick notes

Press `Ctrl+Shift+N` (`Cmd+Shift+N` on macOS) to capture a note without leaving the current view.
If a file and line are open in Files, the note records that location. Notes are scoped to the
repository rather than to one conversation.

Open the Notes view with `Ctrl+Shift+Q` (`Cmd+Shift+Q` on macOS). From there you can:

- create and edit notes;
- resolve or reopen them;
- delete notes;
- click a file reference to reopen the relevant file and line.

Open notes are included with messages sent to agents in that repository. Resolve a note when it
should stop being injected.

## Repository rules

The Rules view edits `.osade/rules.md` in the repository. Put durable instructions there: coding
conventions, verification expectations, or boundaries every agent should follow. Save with the
button or `Ctrl+S`/`Cmd+S` while the editor is focused.

Rules are injected when an agent launches. When the Rules view is open, the focused rule is also
available as context for the next composer message.

## Read-only context repositories

Use **Add read-only context repo** under the composer when work depends on another local codebase.
The attached repositories are listed above the transcript and included in the agent prompt. Osade
explicitly marks the primary worktree as the only editable repository.

Context repositories belong to the conversation and can be removed at any time.

See [Workspace and review](workspace-and-review.md) for view-specific composer attachments.
