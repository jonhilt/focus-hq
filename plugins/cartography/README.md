# Cartography

A plugin (`FOCUS_PLUGINS=cartography`, [plugins](../../docs/plugins.md)), switched on per project: **Architecture map** in a project's settings (the manager's **Projects** tab). It maps only the projects it's on for, maps one as soon as it's switched on, and forgets one switched off; their leads get the map tool, and their holodecks its screens.

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

## What the imports can't show

A browser and its server don't import each other: they talk over HTTP and WebSockets. A repo can keep a recorded run of that traffic beside its model, in `.focus/cartography-flows.json` (`shared/flows.ts`): each kind of message (an event's type, or a request's method and route), which file sent it, which received it, and how often, with what the run was and the commit it was recorded on.

```json
{ "run": "the demo office at speed 3 for 120 s…", "commit": "eec5747…",
  "flows": [{ "via": "ws", "name": "agent", "from": "server/agents/manager/core.ts", "to": "client/src/net/state.ts", "count": 36 }] }
```

The map puts each file under its part, as it does an import, and a view draws what one part sends another as a dashed gold arrow, numbered on after the imports: *Agent manager sends lines, agent, plugin to Mirror of the office over the WebSocket (78 events in the recorded run)*.

Focus records its own with `pnpm run record-flows` ([scripts](../../docs/scripts.md)): a demo office with `FOCUS_FLOWS` set counts each event the hub sends against the file that asked it to (its stack), and each `/api` request against the browser's file that made it, which the browser names in a header while it's opened with `?flows`. Another project records its own however suits it, in the same shape. The recording is evidence from one run, not every path: what the run didn't do isn't in it.

## How it changes

Every map with a git history has a **changes** view too (`history.ts`): the default branch's last 90 days, read with one `git log --numstat`, its files put under their parts as the map puts them now. Git is a witness here that neither the model nor anyone drawing it is:

- **Hotspots**: a bar per part for how many commits changed it (and how many lines), the busiest first. What changes most is where change costs most, and where a map is most worth keeping right.
- **Change coupling**: the pairs of parts that keep changing in the same commits, at least 5 times and in at least 30% of the commits that changed either, each said in a sentence: *Agent sessions and Agent manager changed together in 95 of the 204 commits that changed either (47%)*. A commit touching more than 40 source files is a sweep (a rename, a reformat) and couples nothing.
- **What ties them**: a coupled pair with an import between them is explained by the map's arrows. One without says so: either they talk over the wire (the recorded run has a flow between them), or what ties them isn't on the map at all, which is worth a look.

## A lead's map tool

The plugin adds `mcp__office__map` to every goal lead's office (`leadTool.ts`), so a lead puts a view on their station's screen with one call rather than drawing a diagram of the system afresh:

- **With no view**, it lists each repo's views and their questions.
- **With a view** (`show-to-screen`, `whole` for the matrix, or `changes` for how it changes), it maps the lead's own checkout (their branch, uncommitted work and all) and shows the view as a page (`page.ts`): its question, the drawing and its numbered sentences, like show's visuals. It says how many parts it took, and any drift between the model and their code.

When no view answers what a lead wants to show, they add one to the model in their slice, a question and its parts, and show it at once; once it merges, every later goal has it, on the engineering station and in the holodeck too.

## When the map and the code disagree

The map lists its drift beside it, and the station's **Maps** button shows how much:

- a part's path that names no code (renamed or deleted);
- a part that owns no code, because other parts claim all of it;
- a recorded run that names files gone from the code since: time to record it again.

It also says how many of the repo's source files a part owns. `map.test.ts` holds Focus's own model to all of it, so a pull request that leaves a new file without a part, or renames one from under its part, fails `pnpm test`.

## Where it shows

On the engineering station (<kbd>E</kbd> at Lt. Brennan's station on deck 5), under **Maps**: each project, each of its repos, and each of its views, with a line on how to read it. The model's first view opens first.

- **A view** stands each of its parts in its layer's column, with what it does. An arrow goes from a part to a part whose code it uses, as thick as its imports. Each arrow carries a number, and the numbered sentences under the drawing say what goes across it: *Panels and HUD uses state, api, attention, markRead from Mirror of the office (63 imports)*. A view reads best with up to about nine parts.
- **The whole map** (every part) is a dependency matrix, since a drawing of every connection is more lines than anyone can follow. Each row imports from the columns it has a number in, and the number is how many imports. Orange cells are two parts that import each other, where the code is tangled. Its key reads out its busiest cell as an example, and hovering a cell says what it takes.

**In the project's holodeck**, each view has a screen of its own round the wall, either side of the entrance: its question over its drawing, solid as you aim at it. E on one opens it up close, filling the window, with its numbered sentences. The repos' own views come first, then each repo's whole map, then how each changes, six at most (the hall's room for plugins' screens).

The drawings are SVG made by `draw.ts`, at their own size, shrunk to fit the station but never blown up. **Map again** makes a project's maps again.

Maps are made from each repo's default branch, checked out under `~/.focus/cartography/`: 20 seconds after the office starts, and again whenever a pull request merges into one of the project's repos. They're kept in memory only, not in `state.json`. The demo office's repos are made up, so it maps the office's own checkout for each of them.

## What's next

- Recorded flows inside the office too (events between its own parts, Effect's spans), and runs that cover more of what a captain does.
- The model itself compared across merged pull requests: parts and connections that came and went, slice by slice.

## Where it lives

- `shared.ts`: the model and the map's types.
- `model.ts`: reading a model from its YAML, and a recorded run from its JSON, saying what's wrong with either.
- `graph.ts`: the map's rules, pure: which files it reads, where an import leads, which part owns a file, connections, a recorded run's flows part to part, and drift.
- `scan.ts`: what a file imports, and the names it takes (TypeScript's parser, no type-checking).
- `history.ts`: how the parts change, from git: hotspots and change coupling, pure.
- `map.ts`: making a repo's map from a checkout (git ls-files, then scan.ts, and git log for history.ts).
- `draw.ts`: drawing a view, the matrix and the changes as SVG, with their sentences (`viewDrawing`, which every place a view shows goes through).
- `views.ts`: a map's views, and what the Maps view says in words.
- `leadTool.ts`: the lead's map tool. `page.ts`: a view as a page for a station's screen.
- `server.ts`: when maps are made, and the `/map` route. `client.ts`: the **Maps** view. `panel.ts`: a view as the browser shows it, and up close. `hall.ts`: the holodeck's screens.
