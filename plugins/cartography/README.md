# Cartography

A plugin (`FOCUS_PLUGINS=cartography`, [plugins](../../docs/plugins.md)).

Each project's architecture, as a map that keeps up with its code. A repo keeps its model in `.focus/cartography.yaml`, versioned with the code. The model says only two things:

- **Which code belongs to which part.** Each part names its paths: a folder (ending in `/`) or a file. When paths overlap, the longest wins, so a part can claim a file out of another part's folder.
- **Its views.** Each view is a question the map answers, with the parts it takes to answer it.

Nobody draws the connections. The office reads every source file's imports with TypeScript's own scanner and adds them up part to part, so a connection on the map is one the code makes. Tests (`*.test.*`, `*.spec.*`) and declarations are left out, since tests import whatever they test.

```yaml
parts:
  api: { label: API, layer: Server, kind: route, paths: [server/routes.ts] }
  core: { label: Core, layer: Server, paths: [server/] }   # kind: service unless it says
  types: { label: Shared types, layer: Shared, kind: type, paths: [shared/types/] }
ignore: [scripts/]
views:
  requests:
    question: How does a request reach the core?
    parts: [api, core, types]
```

A part's `kind` is one of the studio's (ui, route, handler, service, store, queue, external, job, type), and its `layer` gives it its colour, as in a lead's system model. Focus's own model is [`.focus/cartography.yaml`](../../.focus/cartography.yaml).

## When the map and the code disagree

The map lists its drift beside it, and the station's **Maps** button shows how much:

- a part's path that names no code (renamed or deleted);
- a part that owns no code, because other parts claim all of it.

It also says how many of the repo's source files a part owns. `map.test.ts` holds Focus's own model to all of it, so a pull request that leaves a new file without a part, or renames one from under its part, fails `pnpm test`.

## Where it shows

On the engineering station (<kbd>E</kbd> at Lt. Brennan's station on deck 5), under **Maps**: each project, each of its repos, and each view drawn as the studio draws a lead's models. The model's first view opens first, and the whole map (every part) is a view of its own. **Map again** makes a project's maps again.

Maps are made from each repo's default branch, checked out under `~/.focus/cartography/`: 20 seconds after the office starts, and again whenever a pull request merges into one of the project's repos. They're kept in memory only, not in `state.json`. The demo office's repos are made up, so it maps the office's own checkout for each of them.

## What's next

- A place in the ship for the views, one per wall, rather than a panel.
- Connections that imports can't show (HTTP, the WebSocket, events), from traces of a seeded demo run.
- How the map changes over time, from the model compared across merged pull requests and the repo's history.

## Where it lives

- `shared.ts`: the model and the map's types.
- `model.ts`: reading a model from its YAML, saying what's wrong with one.
- `graph.ts`: the map's rules, pure: which files it reads, where an import leads, which part owns a file, connections and drift.
- `map.ts`: making a repo's map from a checkout (git ls-files, TypeScript's `preProcessFile`).
- `views.ts`: a map's views as system models, for `shared/modelDrawing.ts` to draw.
- `server.ts`: when maps are made, and the `/map` route. `client.ts`: the **Maps** view.
