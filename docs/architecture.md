# Architecture

Where things live, by folder. What a file does is in the file.

```
shared/              pure logic and types shared by server and client (shared/types/, a file per feature)
server/              express + WebSocket (/ws), the store (~/.focus/), REST routes, previews, auto update
  github/            GitHub as an Effect service: gh CLI (live), in memory (demo)
  plugins/           what a plugin is to Focus, and loading the ones FOCUS_PLUGINS names (docs/plugins.md)
  agents/            the agents: Claude Code sessions, journals, QA, leads, workspaces, Ops' MCP tools
    manager/         AgentManager's parts, a concern each (seating, sessions, delivery, conflicts, leads, slices, reviews…)
client/src/          the 3D client: renderer, loop and input (main.ts), walking (player.ts)
  world/             the ship, holodecks, stations, characters, screens
  ui/                HUD and panels
  tricorder/         the phone view at /tricorder (no three.js)
plugin-api/          all a plugin may import of Focus
plugins/             what Focus does beyond its core, a folder per plugin
tools/               dev tooling, never part of the running Focus (demo ship, bug corpus, replays, ship build)
deploy/vps/          running Focus on a Linux server over Tailscale
blender/             the scripts that build the decks; client/public/ship/ holds the GLBs they write
```

The client mirrors server state over the WebSocket; every action is a small REST call. Screens are canvases drawn into textures and redrawn only when something changes and you can see them (`world/screenRedraw.ts`), since each drawing sends the whole canvas to the GPU again. `world/warmUp.ts` compiles the ship's shaders before you come aboard, so the first step into a room doesn't stall.

## Decisions

A decision (what happens next, whether something may run, merge, retry or wait) lives in a `*Rules.ts` file, with its `*Rules.test.ts` beside it. The caller gathers what the decision reads, asks it, and does what it says: the I/O, the timers, the saving. We took this from a codebase that does the same job (cubefarm, whose decision modules were its best-tested part while its orchestrator grew to one 5,500-line class around them), and it was already how Focus's best-tested code was written; the suffix makes it findable and checkable.

- **Pure.** A rules file reads no clock or dice and does no I/O: no `Date.now()`, `Math.random()`, timers, `process` or `console`; no file system, processes, network, the store, `run()`, or an Effect, service or Layer (Schema and Option are fine). Time comes in as `now`. ESLint refuses each of these in a `*Rules.ts` file (`eslint.config.js`), and nothing it imports may reach them either, however far down: a helper that imports a barrel which loads `node:fs` brings the file system in with it (`tools/decisionFiles.test.ts` follows the value imports).
- **The next step as a value.** It answers with a `{ kind: … }` union, each step carrying what the caller writes, so the caller is a `switch` and nothing is decided twice.
- **Narrow inputs.** It takes the fields it reads (`Pick<…>`), not whole records, so its test builds only those and its type says what it depends on.
- **Tested beside it.** Every `*Rules.ts` has its `*Rules.test.ts` (`tools/decisionFiles.test.ts`). Tests build inputs with small builders over defaults (`pr({ checks: 'failing' })`) at a fixed `NOW`.

These are decision rules, not [the state rules](invariants.md#describing-a-part), which describe the parts that keep something across a restart.
