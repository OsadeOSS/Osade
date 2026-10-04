---
title: Branches and worktrees
description: Understand when Osade uses your current checkout, when it creates an isolated worktree, and how to move work between branches.
---

# Branches and worktrees

Osade makes the checkout location visible because it determines where an agent can write.

## The first chat uses your checkout

The first chat in a repository can attach to the working tree and branch you already opened. This
preserves uncommitted changes and avoids creating a branch before you have decided the work is
worth keeping. The session header shows a **checkout** badge for an attached lane.

When an attached agent starts implementing, Osade offers two choices:

- **Use a worktree** to move the session onto an isolated branch, optionally carrying your
  uncommitted changes.
- **Keep working here** to let the agent edit the current checkout in place.

Enter `/branch` in the composer to branch out with an automatic name, or `/branch my-name` to
choose one.

## Additional work is isolated

Additional chats and additional agents in one conversation use isolated Git worktrees when
needed. Each lane gets its own branch and working directory, so two agents do not write to the
same tree.

The branch menu in the session header identifies worktree lanes and provides:

- **Use a worktree** for an attached checkout;
- **Switch branch** for the real checkout;
- **Move to another branch** for an isolated lane;
- **New chat on this branch** to check out an existing branch in a new session;
- **New chat from this commit** to cut a fresh branch from the current revision.

Git does not allow the same branch to be checked out in two worktrees. Osade shows which chat
holds a branch and disables choices that would violate that rule.

## Working with review feedback

When a pull request receives requested changes, Osade offers to open a lane directly on the pull
request's branch. It adopts the existing branch and PR relationship instead of creating a second
pull request or a fork of the work.

Changing the real checkout can require approval, especially when it is dirty. Review the branch
name and action in the gate before approving it.

See [Agents and conversations](agents-and-conversations.md) for multi-agent lanes and
[Verification and publishing](verification-and-publishing.md) for pull requests.
