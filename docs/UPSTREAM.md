# Upstream (VS Code) integration

This repo has two long-lived branches and two remotes.

| Branch   | Purpose                                              | Rule |
|----------|------------------------------------------------------|------|
| `main`   | OSADe product/development branch. All OSADe work.    | Never rewritten, never replaced. |
| `vscode` | Clean mirror of `microsoft/vscode:main`. No OSADe code. | Fast-forward only. Never commit here. |

| Remote     | URL |
|------------|-----|
| `origin`   | https://github.com/rajarshidattapy/Osade.git |
| `upstream` | https://github.com/microsoft/vscode.git (fetches `main` only, no tags) |

`vscode` tracks `upstream/main`, so it stays byte-identical to upstream. `main` never
receives VS Code commits automatically — everything crosses over by explicit
cherry-pick or merge, described below.

## Updating `vscode`

```bash
git fetch upstream
git checkout vscode
git merge --ff-only upstream/main
```

`--ff-only` is the safety net: if it refuses, `vscode` has diverged (something got
committed on it). Do not force it — see [Conflict handling](#conflict-handling).

Push the mirror to your fork if you want it there:

```bash
git push origin vscode
```

## Comparing `main` and `vscode`

```bash
git diff vscode..main --stat              # everything OSADe changed vs upstream
git diff vscode..main -- src/vs/workbench # scoped to one area
git log vscode..main --oneline            # OSADe commits not in upstream
git log main..vscode --oneline            # upstream commits not in OSADe
git merge-base main vscode                # last shared commit
```

## Creating a VS Code feature branch

Branch off `vscode`, not `main`, when the work is upstream-shaped (a patch you might
send to microsoft/vscode, or a change you want to rebase cleanly on future upstream):

```bash
git fetch upstream
git checkout -b feature/my-change vscode
# ...work, commit...
```

Keep it current with upstream by rebasing:

```bash
git fetch upstream
git rebase upstream/main feature/my-change
```

## Bringing a VS Code change into `main`

Never merge `vscode` into `main` wholesale. Pick what you need.

Single commit:

```bash
git log vscode --oneline -20                # find the commit
git checkout main
git cherry-pick <sha>
```

Range of commits (oldest..newest, exclusive of the first):

```bash
git cherry-pick <old-sha>..<new-sha>
```

One file or directory at the upstream version:

```bash
git checkout main
git checkout vscode -- path/to/file.ts
git commit -m "Take upstream version of path/to/file.ts"
```

Preview before committing to it:

```bash
git cherry-pick -n <sha>     # stage without committing; `git cherry-pick --abort` to back out
git diff --cached
```

## Conflict handling

**Cherry-pick conflicts** — expected, since `main` has diverged:

```bash
git status                   # lists conflicted paths
# edit files, resolve markers
git add <resolved-paths>
git cherry-pick --continue
# or, to walk away cleanly:
git cherry-pick --abort
```

**`merge --ff-only` refused on `vscode`** — the branch has commits upstream does not.
Do not reset or force. Move the stray work off, then fast-forward:

```bash
git checkout vscode
git log upstream/main..vscode --oneline    # what is extra
git branch salvage/vscode-extras vscode    # keep it, nothing is lost
git checkout -B vscode upstream/main       # re-point vscode at upstream
```

Then cherry-pick anything worth keeping from `salvage/vscode-extras` onto `main`.

**Rules that do not bend**

- No `reset --hard`, no force push, no branch deletion on `main` or `vscode`.
- No OSADe code on `vscode`.
- No automatic merge or cherry-pick from `vscode` into `main`.
