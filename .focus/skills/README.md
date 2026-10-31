# Skills

Procedures an agent loads when it needs one, one folder each: `<name>/SKILL.md`, in Claude Code's own skill format
(YAML frontmatter with `name`, the folder's name, and `description`, which says when to use it; then the steps).

A role's prompt (`.focus/crew/`) says who the agent is and what it's for, and is read every turn. A skill says how to do
one thing, with the exact commands where they must be exact, and is read only when it's used. So a how-to that only
matters some of the time belongs here, where it costs nothing until then. What must hold every time stays in the engine
(a hook, a gate, a refusal): an agent can skip a skill.

Ops copies this folder into each lead's workspace, as `.claude/skills/`, at the start of every turn
(`server/agents/skills.ts`), where Claude Code finds them as the project's own. A lead's system prompt is fixed for its
session; the workspace always holds Focus's skills as they are now. Focus checks every skill when it starts, and won't
start with one that's wrong.
