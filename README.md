![Osade](./assets/banner.png)

# Osade

**Run all your coding agents together on real repositories — from one desktop app.**

Local-first · Bring your own agent · Nothing leaves your machine

---

Osade is a desktop workspace for working with coding agents on real codebases. Open a repo, type
into a chat, and an agent starts working in a terminal you don't have to look at. Mention a second
agent and it gets its own branch and runs alongside the first. When work is worth shipping, Osade
verifies it, shows you the diff, and asks before anything leaves your machine.

It doesn't ship a model. It drives the agent CLIs you already pay for.

## Quickstart

You need **Node.js 22+**, **pnpm** (`corepack enable`), **git**, and at least one agent CLI on your
`PATH` — `claude`, `codex`, `opencode` or `pi`.

```bash
git clone https://github.com/OsadeOSS/Osade.git
cd Osade
pnpm install
node scripts/fetch-substrate-binaries.mjs
pnpm --filter @osade/desktop start
```

The window opens. Open a folder, type something, press Enter.

Or put `osade` on your PATH from this checkout (Windows and POSIX):

```bash
node scripts/install-cli.mjs
```

Open a new terminal, `cd` into any repo, and type `osade .` — the window opens (or comes
to the front) on that repository, the way `code .` does.

macOS, Linux and Windows. Everything Osade writes lives in `~/.osade`
(`%USERPROFILE%\.osade` on Windows) — delete it to reset completely.

Optional: run `gh auth login` first and Osade reuses that login for issues and pull requests
instead of asking you to authorize a second OAuth app.

Windows desktop shortcut

After a successful start, so that `apps/desktop/dist` exists:

```powershell
powershell -File scripts/install-desktop-shortcut.ps1
```

This launches the checkout, not a packaged installer.

## What you can do with it

**Talk to an agent instead of configuring a task.** A new chat is an empty box. Type, and the agent
starts. Branch names and titles come from what you wrote.

**Run several agents in one conversation.** `@claude` and `@codex` on separate lines fan out to two
agents, each on its own branch, sharing one transcript. Each one gets a short digest of what the
others have done.

**Stay on your real checkout by default.** The first chat in a repo attaches to your working tree on
whatever branch is already checked out — no surprise branch, no worktree you didn't ask for. Branch
out when you're ready, bringing uncommitted changes with you. Additional chats and extra agents get
isolated worktrees automatically, so two agents are never writing to the same tree.

**Browse, diff and verify without leaving the window.** Files, Checks, Diff and Rules sit next to the
chat. The composer stays live on all of them and attaches what you're looking at, so "why did you
change this" works while you're reading a hunk.

**Approve anything that leaves the machine.** Commits, pushes, PRs and comments are gated. Osade
never merges.

## How it works

Three processes. Two of them keep running when you close the window, so agents don't die with the
app.

```text
Electron app        chats, lanes, files, diffs, checks, gates
      │  tRPC + WebSocket, 127.0.0.1 only
Osade daemon        chats, lanes, verification, gates, GitHub, conventions
      │             SQLite + change_log + CDC
      │  JSON API over a local socket
terminal substrate  PTYs, worktrees, agent detection, session persistence
```

Osade doesn't reimplement terminals. A headless substrate owns PTYs, VT parsing, git worktrees and
agent process detection; Osade drives it over a JSON API. Watching an agent live opens a real
terminal client attached to the same session — embedding the terminal is deliberately deferred
([ADR 0001](docs/architechture/adr/0001-no-embedded-terminal-in-m0.md)).

Two invariants are worth knowing if you read the code:

- **No** `status` **column.** Task status is a pure function over durable facts — what the substrate
observed, what verification returned, what GitHub reported — recomputed on every read. A flaky
probe can't kill a live agent.
- **One event path.** Every change reaches the UI through a SQLite trigger into `change_log`. If the
UI didn't update, the write didn't go through the database.


## Why it works this way

Open source is closing the door on autonomous AI contributions. Godot banned autonomous agent use.
curl shut down its bug bounty. Maintainers report roughly 1 in 10 AI PRs meets their bar.

The bottleneck is review capacity, not code production — so a tool that produces more agent PRs
makes things worse. Osade optimizes for the opposite: **reduce the review cost of a contribution
until an agent-assisted PR is cheaper to review than a human one.** That's why verification,
evidence-cited conventions and human gates are core rather than optional, and why the highest-value
thing an agent can do is often triage that produces no PR at all — reproduce a bug, bisect a
regression, write a failing test.

The long version is in [docs/OSADE.md](docs/OSADE.md).

## Status

Early and moving fast. Usable, not stable.

## Docs


|                                    |                                                              |
| ---------------------------------- | ------------------------------------------------------------ |
| [docs/OSADE.md](docs/OSADE.md)     | Full spec — architecture, data model, invariants, milestones |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to work on Osade                                         |




## Contributing

Issues and PRs welcome. If you're adding an agent, it's a catalog entry plus a detection manifest —
no orchestration changes. Behaviour branches on declared capabilities (`plan-mode`, `resume`,
`hook-reporting`, `headless-run`), never on which agent it is.

## License

Apache-2.0. See [LICENSE](LICENSE).