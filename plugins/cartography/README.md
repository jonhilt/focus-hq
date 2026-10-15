# Cartography

A plugin (`FOCUS_PLUGINS=cartography`, [plugins](../../docs/plugins.md)).

Each project's architecture, as a map that keeps up with its code. A repo keeps its model in `.focus/cartography.yaml`, versioned with the code. The model says only two things:

- **Which code belongs to which part.** Each part names its paths: a folder (ending in `/`) or a file. When paths overlap, the longest wins, so a part can claim a file out of another part's folder.
- **Its views.** Each view is a question the map answers, with the parts it takes to answer it.

Nobody draws the connections. The office reads every source file's imports with TypeScript's parser and adds them up part to part, with the names each takes, so a connection on the map is one the code makes, and says what goes across it. Tests (`*.test.*`, `*.spec.*`) and declarations are left out, since tests import whatever they test.

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

A part's `does` is what it does, in a line, shown in its box. Its `layer` puts it in a column, and gives it its colour; the layers go left to right in the order the model first names them. Its `kind` is one of the studio's (ui, route, handler, service, store, queue, external, job, type). Focus's own model is [`.focus/cartography.yaml`](../../.focus/cartography.yaml).

## When the map and the code disagree

The map lists its drift beside it, and the station's **Maps** button shows how much:

- a part's path that names no code (renamed or deleted);
- a part that owns no code, because other parts claim all of it.

It also says how many of the repo's source files a part owns. `map.test.ts` holds Focus's own model to all of it, so a pull request that leaves a new file without a part, or renames one from under its part, fails `pnpm test`.

## Where it shows

On the engineering station (<kbd>E</kbd> at Lt. Brennan's station on deck 5), under **Maps**: each project, each of its repos, and each of its views, with a line on how to read it. The model's first view opens first.

- **A view** stands each of its parts in its layer's column, with what it does. An arrow goes from a part to a part whose code it uses, as thick as its imports. Each arrow carries a number, and the numbered sentences under the drawing say what goes across it: *Panels and HUD uses state, api, attention, markRead from Mirror of the office (63 imports)*. A view reads best with up to about nine parts.
- **The whole map** (every part) is a dependency matrix, since a drawing of every connection is more lines than anyone can follow. Each row imports from the columns it has a number in, and the number is how many imports. Orange cells are two parts that import each other, where the code is tangled. Its key reads out its busiest cell as an example, and hovering a cell says what it takes.

**In the project's holodeck**, each view has a screen of its own round the wall, either side of the entrance: its question over its drawing, solid as you aim at it. E on one opens it up close, filling the window, with its numbered sentences. The repos' own views come first, then each repo's whole map, six at most (the hall's room for plugins' screens).

The drawings are SVG made by `draw.ts`, at their own size, shrunk to fit the station but never blown up. **Map again** makes a project's maps again.

Maps are made from each repo's default branch, checked out under `~/.focus/cartography/`: 20 seconds after the office starts, and again whenever a pull request merges into one of the project's repos. They're kept in memory only, not in `state.json`. The demo office's repos are made up, so it maps the office's own checkout for each of them.

## What's next

- Connections that imports can't show (HTTP, the WebSocket, events), from traces of a seeded demo run.
- How the map changes over time, from the model compared across merged pull requests and the repo's history.

## Where it lives

- `shared.ts`: the model and the map's types.
- `model.ts`: reading a model from its YAML, saying what's wrong with one.
- `graph.ts`: the map's rules, pure: which files it reads, where an import leads, which part owns a file, connections and drift.
- `scan.ts`: what a file imports, and the names it takes (TypeScript's parser, no type-checking).
- `map.ts`: making a repo's map from a checkout (git ls-files, then scan.ts).
- `draw.ts`: drawing a view and the matrix as SVG, and a view's connections as sentences.
- `views.ts`: a map's views, and what the Maps view says in words.
- `server.ts`: when maps are made, and the `/map` route. `client.ts`: the **Maps** view. `panel.ts`: a view as the browser shows it, and up close. `hall.ts`: the holodeck's screens.
