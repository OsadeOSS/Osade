---
name: prime-agent
description: Use a bounded recursive-language-model workflow plus evidence-backed continual memory for long, context-heavy, multi-stage coding work. Activate when the current coding agent must decompose interacting subproblems, preserve a durable work ledger, or carry verified lessons forward; avoid for small linear changes or unmeasured speculative learning.
license: MIT
---

# Prime Agent

Use Prime Agent as a harness around the coding agent already assigned to the task. The agent
remains the controller. Do not launch a replacement agent or assume Prime Agent's daemon,
Python REPL, child-agent bridge, or commands exist in Osade.

This skill adapts the useful control logic from `ui-new/IDE/prime-agent`: prompt-as-a-variable,
bounded recursive decomposition, persistent goals and working state, explicit collection of
child results, context compaction, re-entry checkpoints, and small evidence-backed harness
refinements. The source implementation is MIT licensed by Prime Intellect Ltd.

## Invoke when

Use this skill when at least one condition is true:

- the task has several dependent stages and the whole context cannot be reasoned about reliably
  in one pass;
- investigation must recurse from a symptom into components, contracts, and concrete leaves;
- a long-running task needs an objective, progress ledger, checkpoints, or context compression;
- a verified success or repeated failure is likely to improve future work through a durable
  memory or focused harness rule.

Do not invoke it for a local one-file edit, a direct factual answer, a single deterministic
command, or merely to make ordinary reasoning look more elaborate. Use Dream RSI instead for
scored open-ended exploration, and Memory Harness instead when the main object being optimized
is a repeatable agent workflow.

## Inputs and outputs

Inputs:

- objective, acceptance criteria, scope, and authority boundaries;
- relevant source, documentation, task history, and current failures;
- verification commands and a time, token, recursion, or attempt budget;
- retrieved memories that match the task or failure signature.

Outputs:

- the requested validated code or analysis;
- a compact ledger of decomposition, decisions, evidence, and unresolved risks;
- verification results tied to the acceptance criteria;
- only when evidence warrants it, a focused memory candidate stating trigger, action, evidence,
  and expected future effect.

## RLM workflow

Treat large context as inspectable state, not as prose to hold in working memory.

1. **Frame the root.** Write the objective, constraints, completion checks, available context,
   and a hard recursion/attempt budget.
2. **Query before expanding.** Search the context for the smallest evidence set that can answer
   the current question. Keep paths, symbols, failures, and contracts in the ledger.
3. **Recurse only on uncertainty.** Split a question into non-overlapping children with a clear
   return contract. Prefer leaves that can be answered by reading, running one check, or making
   one bounded change. Set depth and breadth caps before branching.
4. **Execute leaves.** The current agent handles leaves serially by default. Use an environment's
   worker/subagent feature only when separately authorized and when independent parallel work
   has concrete value. A spawned handle is not a result; explicitly collect and verify results.
5. **Synthesize upward.** Merge leaf evidence at the parent, resolve contradictions against the
   repository or evaluator, and discard irrelevant detail. Never paste every leaf transcript.
6. **Verify at the root.** Run the narrowest relevant checks, then the required broader gate.
   Completion is determined by evidence, not by a child or model claiming success.

At a natural boundary, compact the ledger to: objective, decisions, changed files, executed
checks, failures, next action, and open risks. For a long wait or resumable task, record a
specific re-entry checkpoint; do not create polling or heartbeats without authorization.

## Continual learning

Before planning, retrieve only memories matching the task shape, component, or failure
signature. Treat them as hypotheses and revalidate them against the current repository.

After execution, update memory only when there is concrete evidence: a tactic succeeds across
more than one relevant case, the same failure recurs, or a repository invariant is directly
confirmed. Make the smallest useful update to a memory, prompt note, skill, or reusable role.
Keep it local to the repository/session by default, cite the supporting run or check, and retain
rollback context. Never rewrite the base instructions, persist secrets or incidental transcript
content, generalize from one ambiguous outcome, or let stale memory override current evidence.

Prime Agent can wrap Loop Engineering for each recursive leaf and Graph Engineering for the
dependency structure. Pair it with Memory Harness only when the repeated harness itself is being
measured, and with Dream RSI only when a bounded recursive branch contains a genuine scored
discovery search.
