# Focus HQ

A browser-based 3D starship (Three.js) where Claude Code agents (Claude Agent SDK) work GitHub issues and open PRs. `docs/architecture.md` maps the folders.

Docs hold only what the code can't: why it's built this way (and what was rejected), the promises it keeps (each tied to a test), and how to run it. Don't describe what code does in a doc: say it in a comment beside the code. Change a page only when a decision, a promise or a command changed, and don't copy numbers the code owns into it.

## Commands

- pnpm only (`corepack enable`, `pnpm install`); never add a `package-lock.json`.
- Before you finish: `pnpm run typecheck`, `pnpm run lint`, `pnpm test`, `pnpm run crap --ratchet`, `pnpm run rules --ratchet`.
- A failing test prints its seed (`FOCUS_TEST_SEED`): rerun on that seed rather than calling it flaky. Don't write tests that need randomness to tell things apart.
- Check UI and 3D changes in a demo ship: `pnpm run demo:start` (background, free port, prints its URL), `pnpm run demo:stop` to stop yours. Never kill a demo by port or process name: other agents' are running too.
- Other scripts (perf, zfight, gaps, ship, scorecard, crap, flow…) are in `docs/scripts.md`.

## Rules

- Keep decisions (what happens next, can this merge) in small pure functions with a test next to them; the I/O stays in the caller.
- A part that keeps something across a restart (a journal, a saved file, the store) or waits on Claude Code, git or GitHub is described to Focus's two rules, with its docs page's promises as tests (`docs/invariants.md#describing-a-part`). Adding or changing one, add or change its description.
- Only a goal's lead pushes or opens PRs itself, and Ops claims those as the goal's (`server/agents/manager/goalPrs.ts`). Other agents never do: the manager does (`server/agents/manager/delivery.ts`). Only Ops or the captain merges.
- Type assertions and functions over CRAP 30 only go down, file by file (`plugins/scorecard/README.md#the-ratchets`). Narrow instead of casting; split or test a complex function. After removing some, `pnpm run fence:lower` or `pnpm run crap --lower`. Never raise a baseline.
- Shell commands go through `run()` in `server/util.ts` (no shell), `gh` through `GhRunner`.
- The core never refers to a plugin by name, only through `Plugins` (`docs/plugins.md`).
- A goal lead's system prompt can't change mid-session (Claude Code keeps the first on resume): send anything that changes as a message.
- The server uses **Effect v4**. Read `node_modules/effect/CLAUDE.md` before writing Effect code, and don't write its APIs from memory: `Context.Tag`, `Effect.Service`, `Effect.async`, `catchAll` and `either` are v3 and don't exist here.

## Reviewing a pull request

Run `pnpm run crap --changed origin/<base branch> --ratchet` and report the touched functions as an advisory check, **CRAP (advisory)** (`plugins/scorecard/crap.md`). The ratchet is not advisory: fail a PR whose file gained a function over CRAP 30, or that lowered one without lowering the baseline.

Run `pnpm run rules --ratchet` too, and fail a PR it fails: a file that keeps state the state rules now reach less of, or a new one no description reaches (`docs/invariants.md#describing-a-part`).
