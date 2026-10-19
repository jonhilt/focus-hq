# Focus HQ

A browser-based 3D office (Three.js) where Claude Code agents (Claude Agent SDK) work GitHub issues and open PRs. `docs/architecture.md` maps the code; each feature has a page under `docs/`. When you change a feature, update its page there, not the README.

## Commands

- pnpm only (`corepack enable`, `pnpm install`); never add a `package-lock.json`.
- Before you finish: `pnpm run typecheck`, `pnpm run lint`, `pnpm test`, `pnpm run crap --ratchet`, `pnpm run rules --ratchet`.
- A failing test prints its seed (`FOCUS_TEST_SEED`): rerun on that seed rather than calling it flaky. Don't write tests that need randomness to tell things apart.
- Check UI and 3D changes in a demo office: `pnpm run demo:start` (background, free port, prints its URL), `pnpm run demo:stop` to stop yours. Never kill a demo by port or process name: other agents' are running too.
- Other scripts (perf, zfight, gaps, ship, scorecard, crap, flow…) are in `docs/scripts.md`.

## Rules

- Keep decisions (what happens next, can this merge) in small pure functions with a test next to them; the I/O stays in the caller.
- A part that keeps something across a restart (a journal, a saved file, the store) or waits on Claude Code, git or GitHub is described to the office's two rules, with its docs page's promises as tests (`docs/invariants.md#describing-a-part`). Adding or changing one, add or change its description.
- Agents never push or open PRs themselves; the manager does (`server/agents/manager/delivery.ts`).
- Type assertions and functions over CRAP 30 only go down, file by file (`plugins/scorecard/README.md#the-ratchets`). Narrow instead of casting; split or test a complex function. After removing some, `pnpm run fence:lower` or `pnpm run crap --lower`. Never raise a baseline.
- Shell commands go through `run()` in `server/util.ts` (no shell), `gh` through `GhRunner`.
- The core never refers to a plugin by name, only through `Plugins` (`docs/plugins.md`).
- A goal lead's system prompt can't change mid-session (Claude Code keeps the first on resume): send anything that changes as a message.
- The server uses **Effect v4**. Read `node_modules/effect/CLAUDE.md` before writing Effect code, and don't write its APIs from memory: `Context.Tag`, `Effect.Service`, `Effect.async`, `catchAll` and `either` are v3 and don't exist here.

## Reviewing a pull request

Run `pnpm run crap --changed origin/<base branch> --ratchet` and report the touched functions as an advisory check, **CRAP (advisory)** (`plugins/scorecard/crap.md`). The ratchet is not advisory: fail a PR whose file gained a function over CRAP 30, or that lowered one without lowering the baseline.

Run `pnpm run rules --ratchet` too, and fail a PR it fails: a file that keeps state the state rules now reach less of, or a new one no description reaches (`docs/invariants.md#describing-a-part`).
