# Osade skill routing

The current coding agent reads `skill-router/SKILL.md`, discovers sibling skills from their
frontmatter, and loads only the practices that change how the current task should be solved.
There is no router agent and no fixed task-to-skill lookup table.

Initial practices:

- Memory Harness: `memo-harness/SKILL.md` (`memory-harness` is its human-facing alias)
- Prime Agent: `prime-agent/SKILL.md`
- Dream RSI: `dream-rsi/SKILL.md`
- Loop Engineering: `loop-engineering/SKILL.md`
- Graph Engineering: `graph-engineering/SKILL.md`

## Routing example

Task: "Fix intermittent token refresh across the desktop, daemon, and API, then prevent the
regression."

1. The router sees cross-boundary dependencies and a reproducible failure. It loads Graph
   Engineering to map the refresh path and Loop Engineering to drive a tight failing-test cycle,
   then emits `<osade_skills>graph-engineering, loop-engineering</osade_skills>`.
2. Once the dependency edge is known, the graph no longer changes the next action. The agent
   switches to `<osade_skills>loop-engineering</osade_skills>` for implementation and regression
   checks without restarting the task.
3. If the same harness failure has now appeared across several comparable cases, the agent may
   add `memo-harness` to improve that repeatable workflow. It does not activate Dream RSI because
   this task has no scored multi-branch discovery search, or Prime Agent unless the work becomes
   long-running and recursively decomposed.

To add a practice, create `.osade/skills/<name>/SKILL.md` with standard `name` and a description
that says when to activate and when not to. The catalog discovers it automatically.
