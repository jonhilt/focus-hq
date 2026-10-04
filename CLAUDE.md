# Focus HQ

Browser-based cartoon 3D office (Three.js) visualising a swarm of Claude Code agents (Claude Agent SDK) that work GitHub issues (gh CLI) and open PRs. See README.md for the feature tour and architecture map.

## Commands

- `npm run typecheck`: run after every change; covers `server/`, `client/src/` and `shared/`.
- `npm run demo`: fake GitHub + scripted agents (`FOCUS_DEMO_SPEED=3` speeds them up). Use it to check UI and 3D changes.
- `npm run build`: Vite build of the client into `dist/`.

There is no test suite yet. Verify 3D/UI changes by running the demo and taking screenshots with Playwright. `window.focusHQ` exposes `{ state, world, player, ui }`, so a script can teleport (`ui.goTo(ui.places()[i])`, `ui.goToAgent(id)`) and open panels without pointer lock.

## Conventions

- Server and client share types through `shared/types.ts`; server→client traffic is `ServerEvent`s over `/ws`, client→server is REST under `/api`.
- Agents never push or open PRs themselves; `server/agents/manager.ts` does that after the session ends.
- Anything shell-like goes through `run()` in `server/util.ts` (execFile, no shell). The one exception is the manager's own preview commands in `server/previews.ts`, which run through a shell on purpose (`&&`, `npm.cmd` on Windows, project CLIs).
- 3D: toon materials from `world/materials.ts`. Text surfaces (screens, signs, boards) use `flat()` so they're unlit and skip the outline pass. Room contents are built in room-local coordinates; walls and colliders are in world coordinates via `Builder`.
- Room landscapes (`world/themes.ts`) are drawn through a stencil mask, so build them only with the `Kit` from `world/scenery.ts` (its materials carry the mask; with a plain `toon()` material, the object would turn up in whichever room or hallway it physically overlaps). Keep landscape objects out of the room footprint (|x| < 7, |z| < 6 in room-local coordinates).
- Imports are extensionless (Vite + tsx both resolve them).
