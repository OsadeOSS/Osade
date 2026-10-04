---
name: dream-rsi
description: Improve an exploration strategy for repeated open-ended discovery by recording scored search trees, replaying past trajectories offline, and redeploying a better policy. Use for algorithm, performance, scientific, or design search with an objective evaluator and multiple proposal rounds; do not activate for a single ordinary coding solution.
---

# Dream RSI

Use accumulated discovery history as a grounded replay world for improving how search is allocated. Keep the discovery agent, evaluator, and execution interface fixed; evolve only the explicit exploration policy.

## Preconditions

Use this workflow only when all of the following exist:

- a repeatable proposal–evaluation loop;
- an objective or consistently applied evaluator;
- enough budget for multiple attempts;
- meaningful choices between opening new directions and refining old ones.

Record the execution budget, worker limit, maximum decision rounds, and score direction before starting. Parallel work is permitted only when the current task and environment authorize it.

## Represent discovery as a tree

Create a root for the initial workspace. Every attempt becomes one node with exactly one primary parent and records:

- inherited context and parent identifier;
- the proposal or mechanism tried;
- the resulting artifact or workspace snapshot;
- evaluator score and diagnostics;
- validity, error class, work, latency, and decision round.

The policy may select the root to open a new direction or a current leaf to refine a direction. It selects a batch no larger than the available worker count. Preserve failed nodes: they distinguish bad mechanisms from repairable implementations.

## Online exploration

At each decision round:

1. Reconstruct every opened branch as a trajectory, including its best successful anchor, gains, regressions, failures, repairs, and remaining depth.
2. Classify failed frontiers as hard-unrecoverable, repairable, weak but underexplored, or repeatedly unpromising with sufficient evidence.
3. Rank legal roots and frontiers using only observations already revealed.
4. Build a dynamic portfolio batch: strong refinements, structurally new directions, and at most one justified recovery when eligible.
5. Stop only after considering the whole portfolio. Do not stop while a high-priority recovery or underexplored direction remains.

Read the complete available history before proposing. Trust measured evaluator results over proposal claims. When one mechanism dominates with flattening gains, prefer a structurally different mechanism, a new combination of proven pieces, or a targeted repair backed by a located defect.

## Construct replay worlds

After an online rollout, freeze its completed tree. During replay, expose only the root initially. When the policy selects a recorded leaf, reveal its next recorded child; selecting the root reveals the next recorded root branch. Never invent an outcome for an unrecorded action or let the policy inspect unrevealed scores.

Evaluate every candidate policy on the same frozen set of historical trees. Reset per-rollout state for each policy–world pair.

Use a score that makes the trade-off explicit:

`replay score = best discovered quality - cost_weight × probes + parallel_weight × probes / max(1, decision_rounds)`

Choose weights and score direction before comparing policies. Also inspect attainment-versus-work curves so a policy cannot hide waste behind one lucky maximum.

## Improve the exploration policy

Review replay trajectories for premature stopping, serial execution, over-pruning, redundant branches, and wasted recovery. Revise policy code or instructions, then replay again on the unchanged worlds.

Keep the current policy in the candidate set. Select a replacement only when it is no worse on the fixed replay set and improves the declared objective or its cost tie-breaker. Use a small bounded live canary before committing substantial new online budget.

Use one exploration scalar, `beta`, consistently:

- lower beta favors fewer probes, earlier stopping, and stronger pruning;
- higher beta favors more width, deeper patience, and weaker pruning.

Hold beta fixed within an episode. Sweep it offline, then change the next cycle's default only from both live trends and replay evidence. Do not adapt it from unrevealed outcomes during a run.

## Plan width and depth

Choose the next grid from completed live evidence:

- broaden when distinct roots improve early or major mechanism classes remain uncovered;
- deepen when gains arrive late along a small set of repeatable directions;
- reduce both when branches are redundant or repeatedly hard-unrecoverable;
- use a conservative explicit bootstrap when history is insufficient.

State the reason and hard caps for every plan. Replay support is limited to the width and depth present in recorded trees.

## Integrity and stopping rules

- Keep evaluator, model, and environment changes separate from policy improvement.
- Never hardcode winning node IDs, absolute target scores, or trace-specific outcomes.
- Do not treat one compile, shape, resource, or output-format failure as proof that the parent direction is bad.
- Do not let a repairable latest failure erase an earlier successful anchor.
- Make every prune, batch, deepen, widen, and stop decision explainable from the revealed prefix.
- Stop when the live budget is exhausted, all legal candidates have evidence-based closure, or replay gains fail to survive the bounded live canary.

Report the selected policy, tree/budget statistics, replay objective, live canary result, and which exploration behavior changed.

