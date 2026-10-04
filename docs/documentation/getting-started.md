---
title: Getting started
description: Install Osade, open a repository, choose an agent, and start your first local coding session.
---

# Getting started

Osade is a desktop workspace for running coding agents against real local repositories. It does
not ship a model or an agent subscription. It launches supported agent CLIs already installed on
your machine.

## Requirements

- Node.js 22 or newer
- pnpm (`corepack enable`)
- Git
- At least one supported agent CLI on `PATH`: Claude Code (`claude`), Codex (`codex`), OpenCode
  (`opencode`), or Pi (`pi`)

## Run from a checkout

```bash
git clone https://github.com/OsadeOSS/Osade.git
cd Osade
pnpm install
node scripts/fetch-substrate-binaries.mjs
pnpm --filter @osade/desktop start
```

Osade supports macOS, Linux, and Windows. To reset local Osade state completely, remove
`~/.osade` (`%USERPROFILE%\.osade` on Windows).

## Add the `osade` command

From the Osade checkout, run:

```bash
node scripts/install-cli.mjs
```

Open a new terminal, move into a Git repository, and run:

```bash
osade .
```

This opens Osade on the current repository, similar to `code .`. You can also open a repository
from the desktop app's folder picker.

## Start a session

1. Select **New chat** or press `Ctrl+T` on Windows/Linux or `Cmd+T` on macOS.
2. Choose an installed agent.
3. Describe the outcome you want and press Enter.

The first chat can work on the repository's current checkout. Osade shows the active agent,
branch, status, and workspace views beside the transcript. Additional chats and additional agents
are isolated when needed so they do not write to the same working tree.

Set a repository's default agent from the settings button beside its name. Agents missing from
`PATH` remain visible in the picker but cannot be selected.

## GitHub is optional

Local chat, file review, diffs, notes, and verification do not require GitHub sign-in. Sign in
when you want Osade to read issues or prepare pull requests. If the GitHub CLI is already
authenticated, Osade can reuse that login; otherwise use the in-app device flow or a token. The
credential remains on your machine.

Next, see [Agents and conversations](agents-and-conversations.md) and
[Workspace and review](workspace-and-review.md).
