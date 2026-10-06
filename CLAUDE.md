# Focus HQ

Browser-based cartoon 3D office (Three.js) visualising a swarm of Claude Code agents (Claude Agent SDK) that work GitHub issues (gh CLI) and open PRs. See README.md for the feature tour and architecture map.

## Commands

- `npm run typecheck`: run after every change; covers `server/`, `client/src/` and `shared/`. It runs `tsc`, then `@effect/language-service`'s diagnostics, which fail on a floating (un-yielded, un-run) Effect.
- `npm run lint`: run after every change; ESLint with type-aware typescript-eslint rules (floating and misused promises) over the same files.
- `npm run demo`: fake GitHub + scripted agents (`FOCUS_DEMO_SPEED=3` speeds them up). Use it to check UI and 3D changes.
- `npm run build`: Vite build of the client into `dist/`.
- `npm test`: vitest unit tests (`*.test.ts` next to the code they cover).
- `npm run smoke`: Playwright smoke test of the splash screen against a demo office on a free port; screenshots land in `smoke-shots/`.
- `npm run zfight`: scans a demo office's 3D scene for z-fighting (faces from different meshes in the same plane, less than 0.002 apart) and exits non-zero listing each pair with a world position. Run it after any 3D or world change. The scan lives in `client/src/world/zfight.ts`; intentional overlaps go in the allowlist in `scripts/zfight.ts`, each with a reason.

Unit tests cover the pure decision code (QA verdicts and badges, prompts). Keep new decisions (what happens next, can this merge) in small pure functions with a test next to them, and leave the I/O to the caller. Verify 3D/UI changes by running the demo and taking screenshots with Playwright. `window.focusHQ` exposes `{ state, world, player, ui }`, so a script can teleport (`ui.goTo(ui.places()[i])`, `ui.goToAgent(id)`) and open panels without pointer lock.

## Conventions

- Server and client share types through `shared/types.ts`; server→client traffic is `ServerEvent`s over `/ws`, client→server is REST under `/api`.
- Agents never push or open PRs themselves; `server/agents/manager.ts` does that after the session ends.
- The permanent crew (each room's ops officer at the New issue stand, who also runs briefings in the observation lounge) are read-only Claude Code sessions built in `server/agents/claudeCrew.ts`: Read/Glob/Grep (plus WebSearch/WebFetch in briefings) and the office's own tools, `dontAsk`, no settings loaded. They draft; the manager files.
- Cloud agents (`agent.cloud`) run through the bundled CLI's headless `--cloud` mode (`extraArgs`), relayed in the same SDK message stream; `sessionId` is the cloud session's id. The CLI only starts a new one headlessly while Anthropic's server-side rollout allows it; when it refuses (`cloudRefused` in `cloud.ts`), the agent fails with `CLOUD_UNAVAILABLE` and isn't retried in a new session. They push their own `focus/…` branch and nothing else; the manager publishes the branch first and still opens the PR. Screenshots reach their laptop through image blocks in tool results (`screenshotFrame` in `render.ts`).
- Each room's QA officer is an agent with `task: 'review'`: one record per room (`qa_<projectId>`, `desk: QA_DESK`) reused from review to review, run by the same runner as developers but with a JSON-schema report. QA never touches GitHub; `manager.ts` posts the report as a PR comment.
- Anything shell-like goes through `run()` in `server/util.ts` (execFile, no shell), and `gh` through `GhRunner` in `server/github/runner.ts`. The one exception is the manager's own preview commands, which `PreviewMachine` in `server/previewMachine.ts` runs through a shell on purpose (`&&`, `npm.cmd` on Windows, project CLIs), each in its own process group; `previews.ts` ties each process tree to the preview's `Scope`, so closing it runs the stop command and kills the tree.
- 3D: toon materials from `world/materials.ts`. Text surfaces (screens, signs, boards) use `flat()` so they're unlit and skip the outline pass. Room contents are built in room-local coordinates; walls and colliders are in world coordinates via `Builder`. Never put two faces from different meshes in the same plane: keep them at least 0.002 apart, or give one material `polygonOffset` when moving it would visibly change the look.
- The building's look (bulkhead palette, LCARS signs and screens, sliding doors, space viewports) lives in `world/starship.ts`; every doorway `Builder.wall` cuts gets sliding doors. Sounds live in `sound.ts`: the console chirps, button presses, combadge alerts and transporter beam are CC0 clips from `client/public/sfx/` (credited in its `CREDITS.md`), each falling back to a synthesised version until they've loaded or if they fail to; doors, station tapping and the engine thrum are synthesised with Web Audio. The `AudioContext` starts, and the clips load, on the splash screen's click.
- Room landscapes (`world/themes.ts`) are drawn through a stencil mask, so build them only with the `Kit` from `world/scenery.ts` (its materials carry the mask; with a plain `toon()` material, the object would turn up in whichever room or hallway it physically overlaps). Keep landscape objects out of the room footprint (|x| < 7, |z| < 6 in room-local coordinates).
- Imports are extensionless (Vite + tsx both resolve them).

## Effect

`server/github/` and `server/previews.ts` run on [Effect](https://effect.website/); the rest of the server is still Promise-based and reaches them through adapters at the edge (`toProvider` in `server/github/service.ts`, the `Previews` class's one `ManagedRuntime`). `docs/effect-assessment.md` has the background and the migration path.

- We're on **Effect v4** (`effect` is pinned exactly). Read `node_modules/effect/CLAUDE.md` and `node_modules/effect/ai-docs/` before writing Effect code, and don't write APIs from memory: `Context.Tag`, `Effect.Service`, `Effect.async`, `catchAll` and `either` are v3 names that don't exist here (`Context.Service`, `Effect.callback`, `Effect.catch`, `Effect.result`).
- Services are `Context.Service` classes; their implementations (live, demo) are Layers, usually a static `layer`. Tests provide fake Layers (and `TestClock` from `effect/testing` for time) rather than `vi.mock` or real sleeps.
- Errors are `Data.TaggedError` classes with a `message` getter that reads well in the UI and logs. Classify failures once, at the I/O boundary (`classify` in `server/github/runner.ts`); never fail with a bare string.
- Give a helper an explicit `Effect.Effect<A, E>` return type when it can return either `succeed` or `fail`; otherwise TypeScript infers a union of two Effects and later errors point nowhere near the cause.
- Style: `pipe` for one or two steps, `Effect.gen` for anything with control flow, `return yield* new SomeError(...)` to fail.
- Do side effects inside `Effect.sync`/`Effect.suspend` (or an `Effect.gen` body), never while *building* an Effect: a service method that pushes to an array before returning `Effect.succeed` runs at the wrong time.
- Resources that need cleaning up (processes, servers) are acquired with `Effect.acquireRelease` into a `Scope`; polling is `Effect.repeat` with a `Schedule`; deadlines are `Effect.timeout`/`timeoutOrElse`.
- Decode external JSON with Effect Schema. zod stays only at the Claude Agent SDK's tool boundary (`claudeCrew.ts`, `browserTool.ts`), which requires it.
