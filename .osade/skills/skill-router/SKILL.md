---
name: skill-router
description: Select and switch repository-local practices for the coding agent already handling a task by comparing current context with each discovered skill's trigger description. Use at task start and material phase changes; never create a replacement agent or activate a skill that will not change the work.
---

# Skill Router

Route the current coding agent to the smallest useful set of skills. This is a decision layer,
not an autonomous agent, dispatcher, planner service, or permission grant.

## Discover

From the repository root, run:

```text
node .osade/skills/skill-router/scripts/catalog-skills.mjs
```

The script scans direct child folders for `SKILL.md` and returns each skill's standard `name`,
`description`, and path. If Node is unavailable, read the frontmatter of
`.osade/skills/*/SKILL.md` directly. Ignore `skill-router` itself when selecting a practice.
Adding a skill with a valid `SKILL.md` therefore requires no router change.

`memory-harness` is an accepted human-facing alias for the existing canonical skill named
`memo-harness`. Do not rename or duplicate that skill.

## Select and load

1. Reduce the current context to objective, phase, constraints, uncertainty, feedback signals,
   and expected output.
2. Compare those signals with every catalog description. A skill qualifies only if following it
   changes the next action, evidence collected, or completion gate.
3. Prefer zero or one skill. Select multiple only when their responsibilities are distinct and
   complementary; state which part of the task each owns.
4. Read every selected `SKILL.md` completely and follow its linked practice file before acting.
   An explicit user request for a skill takes priority, subject to existing permissions.
5. Announce the active set with exactly one machine-readable line in the next normal progress
   update. Osade removes this line from chat and shows the selection in the workspace header:

```text
<osade_skills>graph-engineering, loop-engineering</osade_skills>
```

Use canonical frontmatter names, comma-separated. To clear the set, emit
`<osade_skills></osade_skills>`. Do not emit the marker repeatedly when the set is unchanged.

## Re-route

Re-evaluate when the objective changes, investigation becomes implementation, a new evaluator
appears, the same failure repeats, or the current skill's stop condition is met. Load a newly
relevant skill before following it, emit one updated marker, and stop following skills that no
longer affect the work. Keep shared evidence when switching; do not restart the task.

Never select a skill because its words merely resemble the prompt. Do not use all skills as a
default, invent capabilities the host does not provide, spawn a router agent, or treat skill
selection as authorization for extra workers, network access, destructive actions, or expanded
scope.
