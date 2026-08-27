# Upstream VS Code Integration

Osade is built on top of [Microsoft VS Code](https://github.com/microsoft/vscode).

This document explains how Osade maintains its relationship with the VS Code repository and how upstream changes are brought into Osade.

## Repository Architecture

Osade uses two long-lived branches:

| Branch   | Purpose                            | Rule                                    |
| -------- | ---------------------------------- | --------------------------------------- |
| `main`   | Osade's product/development branch | All Osade development happens here      |
| `vscode` | Clean mirror of VS Code `main`     | Must contain only upstream VS Code code |

And two remotes:

| Remote     | Purpose                      |
| ---------- | ---------------------------- |
| `origin`   | Osade's GitHub repository    |
| `upstream` | Microsoft VS Code repository |

```text
origin
└── Osade
    └── main          ← Osade development

upstream
└── microsoft/vscode
    └── main          ← VS Code upstream

vscode                ← local mirror of upstream/main
```

### Important distinction

`main` is **Osade's branch**.

`vscode` is **only an upstream reference branch**. It must not contain Osade-specific changes.

VS Code changes are **never automatically merged into `main`**.

They are deliberately selected and brought into Osade when needed.

---

# Keeping the `vscode` Mirror Updated

The `vscode` branch should always represent the latest `upstream/main`.

First fetch upstream:

```bash
git fetch upstream
```

Then update the mirror:

```bash
git switch vscode
git merge --ff-only upstream/main
```

`--ff-only` is intentional. If this fails, something was committed to `vscode` that does not exist in VS Code upstream.

Do **not** resolve this by merging or force-pushing.

Check what happened:

```bash
git log upstream/main..vscode --oneline
```

If there are unexpected commits, preserve them on another branch before fixing `vscode`.

The goal is:

```text
vscode == upstream/main
```

After updating the mirror, it can optionally be pushed to Osade's GitHub repository:

```bash
git push origin vscode
```

Contributors do not need to maintain this branch.

---

# Comparing Osade With VS Code

To see what Osade has changed relative to upstream:

```bash
git diff vscode..main --stat
```

To inspect a specific area:

```bash
git diff vscode..main -- src/vs/workbench
```

To see Osade commits that are not in the upstream mirror:

```bash
git log vscode..main --oneline
```

To see upstream commits that are not in Osade:

```bash
git log main..vscode --oneline
```

To find their common ancestor:

```bash
git merge-base main vscode
```

---

# Bringing Upstream Changes Into Osade

**Do not merge the entire `vscode` branch into `main` just to update Osade.**

Osade intentionally diverges from VS Code.

Instead, bring upstream changes into `main` deliberately.

## Single commit

Find the desired commit:

```bash
git log vscode --oneline -20
```

Switch to Osade's branch:

```bash
git switch main
```

Apply the commit:

```bash
git cherry-pick <commit-sha>
```

Example:

```bash
git cherry-pick 1a4a18dd247
```

This preserves the upstream commit as a commit in Osade's history.

---

## Multiple commits

For a contiguous range:

```bash
git cherry-pick <old-sha>..<new-sha>
```

Git applies the commits after `<old-sha>` through `<new-sha>`.

For unrelated individual commits:

```bash
git cherry-pick <sha1> <sha2> <sha3>
```

---

# Previewing a Commit

Before committing an upstream change, you can apply it without creating a commit:

```bash
git cherry-pick -n <commit-sha>
```

Inspect the result:

```bash
git diff --cached
```

If you want to keep it:

```bash
git commit -m "Apply upstream VS Code change"
```

If you want to discard it:

```bash
git cherry-pick --abort
```

---

# Taking a Specific Upstream File

Sometimes an entire commit is unnecessary and only one upstream file is wanted.

From `main`:

```bash
git switch main
git restore --source=vscode -- path/to/file.ts
```

Then inspect the change:

```bash
git diff
```

If correct:

```bash
git add path/to/file.ts
git commit -m "Sync file with upstream VS Code"
```

The same approach can be used for a directory when appropriate.

---

# Conflict Handling

Conflicts are expected.

Osade modifies parts of VS Code, so an upstream commit may not apply cleanly.

When a cherry-pick reports conflicts:

```bash
git status
```

Resolve the conflicted files manually.

Then:

```bash
git add <resolved-files>
git cherry-pick --continue
```

If the upstream change is not suitable for Osade:

```bash
git cherry-pick --abort
```

Never blindly choose "theirs" or "ours" for a conflict. Understand what the upstream change does before resolving it.

---

# Osade-Owned Files

The following files/directories are owned by Osade:

```text
docs/
CONTRIBUTING.md
```

Upstream synchronization must **not overwrite Osade's versions** of these files.

If VS Code introduces files with the same paths, Osade's versions take priority.

---

# Working on Upstream-Shaped Changes

If you are developing a change that may eventually be contributed back to VS Code, create the branch from `vscode`:

```bash
git switch vscode
git switch -c feature/my-change
```

Make and commit the change normally.

To update the feature branch with newer upstream changes:

```bash
git fetch upstream
git rebase upstream/main
```

These branches are separate from normal Osade development.

---

# Contributor Workflow

Most contributors should simply work from `main`.

```bash
git switch main
git pull origin main
git switch -c feature/my-osade-feature
```

Make changes, commit them, and open a pull request against Osade's `main`.

Contributors generally do **not** need to interact with the `upstream` remote or maintain the `vscode` mirror.

---

# Rules

### `main`

* `main` is the Osade product branch.
* Never force-push `main`.
* Never rewrite `main` history.
* Do not replace `main` with `upstream/main`.
* Osade-specific changes belong here.

### `vscode`

* `vscode` is a clean mirror of `upstream/main`.
* No Osade-specific code should be committed directly to `vscode`.
* Update it using fast-forward-only operations.
* Do not force-push it.
* If it diverges, preserve any unexpected commits on another branch and restore the mirror to `upstream/main`.

### Upstream changes

* Do not automatically merge all VS Code changes into Osade.
* Review upstream changes before bringing them into `main`.
* Prefer `cherry-pick` for individual upstream commits.
* Resolve conflicts deliberately.
* Keep Osade-owned files such as `docs/` and `CONTRIBUTING.md` intact.

The overall flow is:

```text
Microsoft VS Code
       │
       │ upstream/main
       ▼
    vscode
       │
       │ select changes
       │ cherry-pick / targeted sync
       ▼
     main
       │
       ▼
     Osade
```
