---
title: Verification and publishing
description: Review evidence-backed checks, inspect changes, and approve the exact action before anything is published.
---

# Verification and publishing

Osade separates local agent work from actions performed under your name. You can inspect files,
diffs, and checks freely; commits, pushes, pull requests, public comments, and similar external
actions stop at a human approval gate. Osade never merges pull requests.

## Build a verification plan

Open **Checks** and select **Detect checks**. Osade derives candidate commands from repository
evidence such as CI workflows, manifests, and project documentation. Every step shows its source
and evidence.

The inferred plan does not run the first time until you review it. You can:

- edit a step name or command;
- add or remove steps;
- mark a step required or optional;
- confirm the plan and save later changes;
- run verification and inspect the log for each command.

Verification results are tied to the current Git commit. A failure from an older commit does not
block a newer revision as though it were still current. A failing required check prevents a pull
request approval.

## Review the diff

The Diff view separates uncommitted working-tree changes from committed but unpushed changes. It
shows each changed file, insertion/deletion counts, outgoing commits, and a unified diff. Select a
hunk or individual lines and ask an agent about exactly that change.

## Prepare a pull request

Expand **Open pull request** in Diff or choose **Request pull request** from the command center.
For a multi-agent conversation, select which lane owns the branch. Review the target repository,
base and head branches, title, body, and draft setting.

If you cannot push to the upstream repository, Osade detects an existing fork or proposes the
fork route. Creating a fork is itself gated.

Requesting the pull request creates an approval card; it does not publish immediately.

## Approval gates

A gate shows the exact action and payload about to run. Choose:

- **Approve** to run exactly what is shown;
- **Deny** to reject it;
- **Edit** to change the payload and approve the edited version.

Approvals are bound to the exact payload bytes. If the action changes after approval, Osade
refuses to execute it. Public writes receive an explicit warning because they are published under
your identity. Gates expire after 24 hours and can be requested again.

Approve the visible gate with `Ctrl+Enter`/`Cmd+Enter` or deny it with
`Ctrl+Backspace`/`Cmd+Backspace` when focus is not inside an editor.

## GitHub sign-in

The status area shows the active GitHub account. Sign in with the device flow, reuse an existing
GitHub CLI login, or provide a token. Credentials are stored locally and are used only for GitHub
operations you request and approve.
