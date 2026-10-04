---
name: memo-harness
description: Improve a repeatable agent workflow from execution evidence by tuning its context, tools, generation, orchestration, memory, and validation. Use for benchmark loops, recurring coding tasks, or harness diagnosis with measurable outcomes; do not activate for ordinary one-off implementation without repeatable feedback.
---

# Memo Harness

Improve the control layer around an agent while keeping the underlying model and evaluator fixed. Treat prompts, tools, workflow, memory, and validation as separable decisions rather than one opaque prompt.

## Establish the experiment

Before changing the harness, record:

- the task distribution and a held-out evaluation split;
- the primary correctness metric and its exact evaluator;
- cost measures such as model calls, tokens, latency, or tool executions;
- the current harness and a reproducible baseline result;
- a bounded iteration, concurrency, and retry budget.

Do not optimize on held-out labels or silently change the evaluator. If there is only one task and no repeatable feedback, use the six dimensions as a diagnostic checklist and stop short of claiming that the harness learned.

## Audit the six dimensions

Classify each proposed change under one primary dimension:

- **D1 — Context assembly:** instructions, constraints, examples, retrieved evidence, and compression.
- **D2 — Tool interaction:** available tools, retrieval, tool protocol, and evidence selection.
- **D3 — Generation control:** model parameters, token budget, candidate count, and reasoning budget.
- **D4 — Orchestration:** call order, planning, branching, refinement, retries, and stopping.
- **D5 — Memory management:** state retained across calls, summaries, and removal of stale context.
- **D6 — Output processing:** extraction, schema checks, artifact checks, verification, and fallback behavior.

Change the smallest set of dimensions that explains the observed failure. Preserve the prior configuration and write down the delta so results remain attributable.

## Build an experience bank

Keep two layers:

1. **Case entries** with case features, harness configuration, delta from the previous configuration, execution trajectory, correctness reward, cost, and a failure diagnosis.
2. **Global patterns** distilled from repeated evidence, each naming its primary dimension, the supporting cases, and the expected effect.

For retrieval, prefer cases similar in task shape and failure signature. Include both successful and failed cases. A useful entry explains why the outcome happened; raw transcripts without a diagnosis are not memory.

Compress memory periodically or after the same case fails repeatedly. Keep recurring verifier signatures and proven guardrails. Remove duplicates, stale speculation, and hypotheses disproved by unchanged results.

## Run the improvement loop

For each iteration:

1. Retrieve relevant case entries and global patterns.
2. Form one explicit harness hypothesis and identify its primary D1–D6 dimension.
3. Execute on the training cases within the fixed budget.
4. Score correctness with the unchanged evaluator, then record cost.
5. Diagnose failures from actual traces and verifier output.
6. Store entries, update case statistics, and distill only patterns supported by multiple observations.
7. Keep the best correctness result; use cost only to break correctness ties.

When a failure signature repeats twice, pivot the hypothesis class instead of making another small edit. For process, environment, or entrypoint failures, repair runtime wiring before changing task logic.

## Adapt to a new case

At evaluation time, freeze the experience bank. Retrieve similar cases and relevant global patterns using only information available before the answer is known. Adapt the global harness once for the case, execute it, and return the validated result. Do not use test labels, evaluator feedback, or extra search rounds to select the case-specific harness.

## Completion gate

Before selecting or reporting a harness:

- rerun the exact failing or primary evaluator;
- verify required artifacts exist and are non-empty;
- probe the specific format, content, or stdout predicate that failed;
- report the configuration delta, checks executed, reward, and cost;
- state the remaining blocker and next hypothesis when validation still fails.

Never treat a model-written completion claim as evidence. Stop when the budget is exhausted, the metric is saturated across multiple iterations, or further variants repeat an unchanged failure without new evidence.

