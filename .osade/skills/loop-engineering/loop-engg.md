# Loop Engineering Practice

Loop engineering means designing the shortest trustworthy feedback cycle between an observed
state and the next coding decision. It is not "keep trying until green." Every iteration must
reduce uncertainty or improve a declared metric while preserving an attributable change.

## Trigger signals

Use this practice when one or more signals appear:

- a test, typecheck, lint rule, reproduction, benchmark, or log signature can be rerun;
- implementation can land in small vertical slices with observable contracts;
- a failure changes after each edit and the next step should depend on that evidence;
- flakiness, resource use, latency, or correctness needs repeated measurement;
- two attempts have failed and the agent needs an explicit hypothesis/feedback discipline.

Do not use it when the task is a single obvious edit followed by one normal verification, when
the feedback signal is subjective or unavailable, or when running the loop costs more than the
decision justifies.

## Workflow

1. **Name the loop contract.** Record the target behavior, exact observation/evaluator, pass
   condition, budget, and stop condition. Reproduce the baseline once.
2. **Shorten the cycle.** Find the narrowest deterministic command or probe that exercises the
   failure. Separate setup failures from product failures before editing product logic.
3. **Form one hypothesis.** Tie it to observed evidence and predict how the next signal should
   change. If the prediction is vague, gather evidence instead of editing.
4. **Make one attributable change.** Keep unrelated cleanup outside the loop. Preserve the last
   known-good state and note the delta.
5. **Run and interpret.** Execute the same narrow evaluator. Record result, duration, and the
   relevant diagnostic—not the entire log. A different failure is new evidence, not success.
6. **Decide deliberately.** Keep the change, revert it, repair the loop itself, or choose a new
   hypothesis. After the same signature repeats twice, change the hypothesis class rather than
   nudging the same fix again.
7. **Close broadly.** Once the narrow loop passes, run the required surrounding and regression
   checks. Report the baseline, material iterations, final evidence, and remaining uncertainty.

## Good and bad usage

Good usage has a reproducible baseline, one meaningful variable per iteration, a fixed
evaluator, bounded retries, recorded evidence, and a broader completion gate. It stops when the
target passes, the budget ends, or no new information is produced.

Bad usage reruns an unchanged flaky command, edits several layers at once, changes the test to
hide a failure, treats compilation as behavioral proof, loops without a budget, or remembers
only successful trials.

## Interaction with other practices

- **Prime Agent:** owns the long task and ledger; use this loop inside a recursive leaf. Feed
  back only the compact result and evidence.
- **Graph Engineering:** the graph selects the next dependency or edge to validate; this loop
  closes that node before advancing.
- **Memory Harness (`memo-harness`):** activate after multiple comparable loops exist and the
  workflow itself can be measured. Store failure signatures and effective loop configurations,
  not raw logs.
- **Dream RSI:** use Loop Engineering as the inner evaluator for each proposal. Dream RSI owns
  branch allocation and policy improvement; this skill does not invent a search tree.

The output is a validated change plus a short loop record: baseline, hypothesis/change pairs,
checks, result, and stop reason.
