# Cartography

A plugin (`FOCUS_PLUGINS=cartography`, [plugins](../../docs/plugins.md)), switched on per project: **Architecture map** in a project's settings (the manager's **Projects** tab).

Each project's architecture, as a map that keeps up with its code. A repo keeps its model in `.focus/cartography.yaml`, versioned with the code. The model says only two things:

- **Which code belongs to which part.** Each part names its paths: a folder (ending in `/`) or a file. When paths overlap, the longest wins, so a part can claim a file out of another part's folder.
- **Its views.** Each view is a question the map answers, with the parts it takes to answer it.

Nobody draws the connections. The office reads what every source file uses of the others, in the languages it knows (`languages.ts`, a reader per language behind the one interface), and adds them up part to part, so a connection on the map is one the code makes, and says what goes across it. Tests are left out, since they import whatever they test. A Java repo's model names its parts by folder, like any other: `paths: [src/main/java/org/springframework/samples/petclinic/owner/]`.

```yaml
parts:
  api: { label: API, layer: Server, kind: route, paths: [server/routes.ts], does: "Answers the browser's requests" }
  core: { label: Core, layer: Server, paths: [server/] }   # kind: service unless it says
  types: { label: Shared types, layer: Shared, kind: type, paths: [shared/types/] }
ignore: [scripts/]
views:
  requests:
    question: How does a request reach the core?
    parts: [api, core, types]
```

## What the imports can't show

A browser and its server don't import each other: they talk over HTTP and WebSockets. A repo can keep a recorded run of that traffic beside its model, in `.focus/cartography-flows.json` (`shared/flows.ts`): each kind of message (an event's type, or a request's method and route), which file sent it, which received it, and how often, with what the run was and the commit it was recorded on.

```json
{ "run": "the demo office at speed 3 for 120 s…", "commit": "eec5747…",
  "flows": [{ "via": "ws", "name": "agent", "from": "server/agents/manager/core.ts", "to": "client/src/net/state.ts", "count": 36 }] }
```

Focus records its own with `pnpm run record-flows` ([scripts](../../docs/scripts.md)). Another project records its own however suits it, in the same shape. The recording is evidence from one run, not every path: what the run didn't do isn't in it.

## How it changes

Every map with a git history has a **changes** view too (`history.ts`): hotspots and change coupling from the default branch's history. Git is a witness here that neither the model nor anyone drawing it is. What changes most is where change costs most, and where a map is most worth keeping right. A coupled pair with no import between them is the one worth a look: either they talk over the wire (the recorded run has a flow between them), or what ties them isn't on the map at all.

## Diagrams leads draw, kept

The diagram most worth having is the one asked for: the captain asks a lead how part of the system works, and the lead draws it with the office's `model` tool ([docs/goals.md](../../docs/goals.md)). Cartography keeps it with the project, so it's there after the goal closes:

- **What's kept**: a model of how the code works. One of what a change does (parts or connections marked added, changed or removed) is about a slice, and goes stale the moment it merges, so it isn't kept.
- **Out of date**: when a file it cites has changed or gone on the default branch. It's a warning: the diagram may still be right, but the code under it has moved.
- **Draw it again** only when the captain asks, since a session costs.

## A lead's map tool

The plugin adds `mcp__office__map` to every goal lead's office (`leadTool.ts`), so a lead puts a view on their station's screen with one call rather than drawing a diagram of the system afresh. With no view, it lists each repo's views; with a view (or `whole`, or `changes`), it maps the lead's own checkout, uncommitted work and all.

When no view answers what a lead wants to show, they add one to the model in their slice, a question and its parts, and show it at once; once it merges, every later goal has it. A view reads best with up to about nine parts.

## When the map and the code disagree

The map lists its drift beside it:

- a part's path that names no code (renamed or deleted);
- a part that owns no code, because other parts claim all of it;
- a recorded run that names files gone from the code since: time to record it again.

`map.test.ts` holds Focus's own model to all of it, so a pull request that leaves a new file without a part, or renames one from under its part, fails `pnpm test`.

## More than one repo

A project of more than one repo keeps a model in each, mapped on its own. Repos don't import each other, so what joins them is read from two kinds of evidence:

- **Calls** (`routes.ts`): the HTTP routes each repo declares, matched to the paths the others call, from the text alone.
- **Change coupling** (`crossRepo.ts`), since a commit never spans two repos. A change that needs two repos shows as one person's commits to each, close together, so those are read as one change set across the project's repos.

Checked on the Spring PetClinic REST API (routes in its OpenAPI spec) and its Angular front end (URLs glued from an environment's base): each Angular screen's service calls exactly its routes on the API's REST controllers, and over 90 days around a change to both, the pets and visits screens tie to the API's DTO mappers.

Maps are made from each repo's default branch, and kept in memory only, not in `state.json`.
