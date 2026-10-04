# Repository skills

At the start of a task, and whenever its objective or phase materially changes, read
`.osade/skills/skill-router/SKILL.md` and use it to select the smallest useful set of
repository skills. The router is a decision layer for the coding agent already doing the work;
it never hands control to a separate autonomous agent.

If the user names a skill explicitly, load it. `memory-harness` is the human-facing name of the
existing `.osade/skills/memo-harness/SKILL.md` skill. During open source development, continue
to follow the existing `$open-source` guidelines. Skill selection does not authorize extra
agents, external services, expensive runs, or broader filesystem changes.
