# Contributing to OSADe

Thanks for contributing to **OSADe** — an open-source IDE built on top of VS Code, focused on making open-source development easier.

## Before You Start

OSADe has two important branches:

* **`main`** → OSADe's product and development branch.
* **`vscode`** → clean VS Code tracking branch. This follows Microsoft's upstream VS Code codebase.

**Most contributors should work from `main`.**

Do not add OSADe-specific changes directly to `vscode`.

## Development Workflow

Clone the repository and switch to `main`:

```bash
git clone <your-osaDe-repository>
cd osaDe
git checkout main
```

Create a feature branch:

```bash
git checkout -b feature/<short-description>
```

Examples:

```bash
git checkout -b feature/pr-review-agent
git checkout -b feature/oss-dashboard
git checkout -b fix/git-authentication
```

Make your changes, test them locally, then commit:

```bash
git add .
git commit -m "feat: add PR review workflow"
```

Push your branch:

```bash
git push origin feature/<short-description>
```

Then open a Pull Request against **`main`**.

## Pull Requests

PRs should:

* Have a clear, focused purpose.
* Include tests when applicable.
* Keep unrelated changes out of the PR.
* Explain what changed and why.
* Include screenshots/GIFs for meaningful UI changes.
* Be based on the latest `main` when possible.

Use conventional commit-style messages where practical:

```text
feat: add contributor dashboard
fix: handle failed git authentication
refactor: simplify repository indexing
docs: improve contributor guide
```

## VS Code Upstream

OSADe is built on VS Code, so we continuously track Microsoft's upstream repository.

```text
microsoft/vscode
       ↓
    vscode
       ↓
    OSADe main
```

The `vscode` branch exists to track upstream VS Code changes.

Contributors **should not normally modify `vscode`**.

To update it:

```bash
git fetch upstream
git checkout vscode
git merge --ff-only upstream/main
```

Only changes that we intentionally want in OSADe should be brought from `vscode` into `main`.

If you are working on a change that originates from VS Code itself, discuss it with the maintainers before porting or substantially modifying upstream code.

## Bringing VS Code Changes Into OSADe

Do not automatically merge all upstream changes into `main`.

First understand the change and whether OSADe needs it.

When a specific upstream commit is required, a maintainer may selectively bring it into an OSADe feature branch:

```bash
git checkout main
git pull origin main

git checkout -b feature/upstream-<description>

git cherry-pick <commit>
```

Resolve conflicts carefully, test the result, and open a PR against `main`.

For larger upstream changes, discuss the approach before attempting the integration.

## Keep Changes Focused

Avoid combining unrelated work.

Bad:

```text
feat: add agent system + redesign sidebar + fix GitHub auth + update dependencies
```

Better:

```text
feat: add agent system
```

and separate PRs for unrelated changes.

## Testing

Before opening a PR:

```bash
npm install
npm run compile
```

Run any relevant tests or checks for the area you modified.

For UI changes, verify the affected functionality manually.

## Reporting Bugs

When reporting a bug, include:

* What you expected.
* What actually happened.
* Steps to reproduce.
* Relevant logs/errors.
* OS and environment information.
* Screenshots when useful.

## Security

Do not publicly disclose security vulnerabilities in GitHub issues.

Contact the maintainers privately with enough information to reproduce and investigate the issue.

## Code of Conduct

Be respectful and constructive.

OSADe is built by contributors from different backgrounds and experience levels. Good contributions include both code and useful feedback.

## The Goal

OSADe is not trying to reinvent VS Code.

We want to **build on top of VS Code while creating a better development experience for open-source contributors**.

If you're unsure whether something belongs in OSADe, open an issue or discussion before spending significant time implementing it.

Thanks for building with us. 🚀
