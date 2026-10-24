# The crew

Who each of Focus's agents is and what it's told, one file a role: `<role>.md`. They live here, not in the code, so a
prompt reads as the words the agent gets and changes by pull request like anything else, an agent's own included.
The code still decides what a prompt can refer to and which settings it reads (`server/agents/crewRoles.ts`).

A file is YAML frontmatter between `---` lines, then the system prompt:

- `description`: who the role is, in a line.
- `texts`: short pieces the code picks between (which assignment, which closing line), for the roles that have them.
- `model`, `effort`, `maxTurns`, `timeout` (`90s`, `8m`): only for the roles that read them, so none is set and then
  ignored. A machine's own settings (`~/.focus/state.json`) still win over them.

The prompt and texts are templates: `{{name}}` is text the code fills in, `{{#flag}}…{{/flag}}` is kept when the flag
is on and `{{^flag}}…{{/flag}}` when it's off. A section tag alone on its line takes the line with it.

Focus reads every file when it starts and won't start with one that's wrong, saying which file and line: a name the role
hasn't got, a section left open, a text missing, a setting nothing reads.

A plugin keeps its crew beside its code, in a folder of the same files (`crewFolder` in `plugin-api/server.ts`), so
the core never names it. Each file's digest, a short hash of its prompt and texts, can stand for its version: the same
words always give the same one.

A benchmark (`.focus/benchmarks/`) can tell a role its file as another branch has it, beside this checkout's, to see
whether a change to it does better before it merges.

The prompts are pinned word for word (`server/agents/crewGolden.test.ts`). Changing one on purpose, run
`pnpm test -- -u` and the snapshot's diff shows what the agent will now be told.
