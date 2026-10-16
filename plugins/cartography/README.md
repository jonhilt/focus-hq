# Cartography

A plugin (`FOCUS_PLUGINS=cartography`, [plugins](../../docs/plugins.md)), switched on per project: **Architecture map** in a project's settings (the manager's **Projects** tab). It maps only the projects it's on for, maps one as soon as it's switched on, and forgets one switched off; their leads get the map tool, and their holodecks the stellar cartography screen that takes you into their architecture space.

Each project's architecture, as a map that keeps up with its code. A repo keeps its model in `.focus/cartography.yaml`, versioned with the code. The model says only two things:

- **Which code belongs to which part.** Each part names its paths: a folder (ending in `/`) or a file. When paths overlap, the longest wins, so a part can claim a file out of another part's folder.
- **Its views.** Each view is a question the map answers, with the parts it takes to answer it.

Nobody draws the connections. The office reads what every source file uses of the others, in the languages it knows (`languages.ts`, a reader per language behind the one interface), and adds them up part to part, with the names each takes, so a connection on the map is one the code makes, and says what goes across it. Tests are left out, since they import whatever they test.

- **TypeScript and JavaScript** (`scan.ts`): each file's imports, re-exports and `import('…')` calls, read with TypeScript's parser (without type-checking), and the relative ones followed to the file they lead to. Tests (`*.test.*`, `*.spec.*`) and declarations are left out.
- **Java** (`java.ts`): each file's package and imports, read from its text without its comments and strings, with no compiler or build file. A class is found by the package its file declares, wherever its source root is (`src/main/java`, a module's, or none), so a repo of several modules maps the same way. An import leads to its class's file (a nested class's, to the file it's in; a static import's, to its class, taking the member); a package imported with `.*` leads to the classes of it the file names; and a file uses the classes of its own package it names, which need no import. Test trees (`src/test/`), `…Test`, `…Tests` and `…IT` classes, and `package-info` and `module-info` are left out. A Java repo's model names its parts by folder, like any other: `paths: [src/main/java/org/springframework/samples/petclinic/owner/]`.

Git history and recorded runs don't care what a file's written in.

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

### Scenarios: a question of how something happens

A view that asks how something happens is better answered in order than as a web of imports, so a view can be a **scenario**: an `answer` (the whole of it in a line) and `steps`, each a part reaching another and what happens, in a few words.

```yaml
  show-to-screen:
    question: How does a lead's show reach the station's screen?
    parts: [office-tools, manager, client-net, ship, artifacts, panels]   # optional: the steps' parts, in order, if left out
    answer: "The office tools keep the page on the lead, the manager sends the lead to the browser over /ws, and the station's screen draws its picture."
    steps:
      - { from: office-tools, to: manager, says: "keeps the shown page on the lead" }
      - { from: manager, to: client-net, says: "sends the lead's update over /ws" }
```

It's drawn as a sequence diagram (`sequence.ts`): a lifeline per part in the order the steps reach them, and each step an arrow down the page, numbered, with what it says over it. The office checks each step against the code (`steps.ts`): a message the recorded run saw from one part to the other (a dashed gold arrow), or an import between them either way (solid: one calls the other, or reads from it). A step nothing backs is drawn red and said so, never left out. Under the drawing, each numbered step opens on its evidence: the imports and their names, the recorded messages and how many. That's the detail the old sentences crammed in all at once.

Imports alone can't put a scenario in order: a shortest path through them runs through whatever module everything imports (the plugin API, say), not the way the code actually goes. So a scenario's steps are either written, by whoever adds the view or by a lead with the map tool, and checked; or **found in a recorded run**.

### Cited steps: a scenario for any project

Most projects can't be recorded, so the base of a scenario is a written one whose steps each **cite** where in the code they happen (`cite: path:line`, from the repo's root). An agent reading the code writes them, in any language, and the office checks each against the code as it stands (`steps.ts` `checkCite`), every time it maps:

```yaml
      - { from: office-tools, to: manager, says: "keeps the shown page on the lead", cite: server/agents/manager/goalTools.ts:55 }
      - { from: manager, to: client-net, says: "sends the lead's update over /ws", cite: server/agents/manager/core.ts:169 }
```

- The cited file has to be in one of the step's two parts' code: where it calls the other, or where it reads from it.
- Its line, or one within two of it (`CITE_SLACK`), the nearest first, has to name something one part uses of the other (the names their imports take), or a message between them as a string (`'agent'`, not any variable called `agent`), or reach a member through a class of the other part's it extends (`this.update(…)` in `class GoalTools extends Part`: `map.ts` `inheritsIn`).
- That line is the step's first evidence, quoted under it: *server/agents/manager/core.ts:169: this.hub.send({ type: 'agent', agent }); (agent, of Mirror of the office)*.
- A cite that checks out draws its step lilac, unless a recorded run saw it (gold). A cite that fails (no such file or line, a file in neither part, a line that names nothing of the other's) draws the step red and says why first. Code moves, so a scenario whose cite has drifted shows it. It's a warning, not a failing test: other goals move cited code all the time.
- With nothing on the map joining the two parts (a language the map can't read yet), a cite in the right part is taken as it is, and says the map can't tell what it reaches.

The map tool tells a lead how to cite, and which of their cites fail and why, so they can fix them before the view ships.

### Steps found in a recorded run

As the recorded run sends each event over /ws, it keeps the whole stack the event was sent from, not only its sender: the repo's frames, outermost first, with their functions (`shared/flows.ts` `chainOf`, kept as the recording's `traces`). That's the order imports can't give: who called whom to send it. The map puts each chain's frames to their parts (`graph.ts` `partTraces`), a run of frames in one part being one hop, entered by its first function, with the message's receiver last.

A view with a `trace` instead of steps has them found there:

```yaml
  note-to-browser:
    question: How does a lead's note reach the browser?
    parts: [agents, manager, office-tools, client-net]
    answer: "The lead's session calls the note tool, the office tools update the lead, and the manager sends it to the browser over /ws."
    trace: { message: agent, through: office-tools }
```

Of the chains that sent `message` (an event's type) and went `through` the part, it takes the one through the most parts (a chain cut short where it awaited is busier, but tells less), and makes a step of each hop: *calls note*, *calls update*, *calls back into it* for an anonymous callback, and *sends "agent" over /ws* last. A recorded call backs a step too, written or found: a solid gold arrow, its evidence saying which functions and how often. A chain is what one run did, from the demo office (where a demo runner stands in for a lead's Claude Code session): what the run didn't do has no chain, and the map tool says so.

**Legibility is tested** (`legibility.ts`): every scenario in Focus's own model is held to a budget as a station's screen shows it (at most 7 lifelines and 8 steps, no label cut short, no text under 13 px once shrunk to fit), and every step must be backed. A view that grows past it fails `pnpm test`.

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

## Diagrams leads draw, kept

The diagram most worth having is the one asked for: the captain asks a lead how part of the system works, and the lead draws it with the office's `model` tool (cited, checked, stepped through as a sequence, `docs/studio.md`). The office tells the plugins each time (`modelShown`), and cartography keeps it with the project (`diagrams.ts`, `keeper.ts`), so it's there after the goal closes:

- **What's kept**: a model of how the code works. One of what a change does (parts or connections marked added, changed or removed) is about a slice, and goes stale the moment it merges, so it isn't kept. The same lead drawing the same id again replaces theirs; a project keeps its 24 newest (`KEPT_MAX`).
- **Where**: the page the lead drew and its picture, as files in the plugin's data folder (`diagrams/`), with an index by project beside them (`index.json`), read again as the office starts, unlike the maps.
- **Each file it cites**, as a repo's file with a hash of what was in it when it was drawn (from the lead's checkout).
- **In the architecture space**, after each repo's whole map and before the rest: its question over its picture, and when and by whom it was drawn. E on it opens the page itself up close, live, to step through.
- **Out of date**: whenever a project's maps are made (as the office starts, and as a pull request merges), each diagram's cited files are hashed again on the repos' default branches. One that's changed, or gone, marks it out of date, said on it (a red band across its hologram's top) and up close (which files), It's a warning: the diagram may still be right, but the code under it has moved.
- **Draw it again**, up close: the office draws it afresh from its repos' default branches as they are now (`PluginHost.drawModel`: a read-only session reads the code and answers its question in the model tool's own shape, then the office checks and draws it as it does a lead's), in its place, drawn *by the office*. Its hologram says it's being drawn meanwhile, or why drawing it failed. A session costs, so it's only ever drawn again when the captain asks.
- **Forget it**, up close, once the captain confirms: it goes, page and picture too. One whose page has gone from the folder still opens, saying so, to be drawn again or forgotten.

## A lead's map tool

The plugin adds `mcp__office__map` to every goal lead's office (`leadTool.ts`), so a lead puts a view on their station's screen with one call rather than drawing a diagram of the system afresh:

- **With no view**, it lists each repo's views and their questions.
- **With a view** (`show-to-screen`, `whole` for the matrix, or `changes` for how it changes), it maps the lead's own checkout (their branch, uncommitted work and all) and shows the view as a page (`page.ts`): its question, the drawing and its numbered sentences, like show's visuals. It says how many parts it took, and any drift between the model and their code.

When no view answers what a lead wants to show, they add one to the model in their slice, a question and its parts, and show it at once; once it merges, every later goal has it, on the engineering station and in the architecture space too.

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

**In the project's holodeck** hangs a stellar cartography screen, a hologram on the wall on the entrance's side, opposite the PADD rack, where plugins' screens hang (`chart.ts`, `hallChart`): the project's map as a star chart in an LCARS frame, each layer an orbit round the middle, each part a star on it in its layer's colour, as bright as its share of the code and named beside it, and a faint gold line for each import (`miniature.ts`). It's drawn again as the project's maps change. E on it (*Step into stellar cartography*) and the view rushes into it (`ui.dive`), and you come out in the **architecture space** (`space.ts`): a platform out among the stars, the project's whole map straight ahead, big, and its other views floating round you in two rings, each a hologram with its question over its drawing, solid as you aim at it. E on one, from anywhere on the platform, opens it up close, filling the window, with its numbered sentences. Each repo's whole map comes first, then what each goal under way does to it (below), then the repos' own views, then how each changes, 17 at most (`spaceLayout.ts`, `spaceViews`). You leave by the holodeck's arch behind you (`arch.ts`: *Computer, exit*, its grid showing through it), back to the holodeck you came from, standing in front of its screen. One space serves every project: it shows the views of the project whose screen you came through, and puts them up again as its maps change while you're there. The space is the plugin's own (`ShipHost.space`), far out beyond the rest of the ship and drawn only while you're in it.

**A project of more than one repo** keeps a model in each, mapped on its own. Repos don't import each other, so what joins them is read from two kinds of evidence: the HTTP routes one calls on another, and their histories.

- **Calls** (`routes.ts`): the routes each repo declares, matched to the paths the others call, from the text alone. A route is declared by a Spring controller's `@GetMapping`s and the like (under its class's `@RequestMapping`), an Express-style handler (`app.get('/x', …)`, `router.post(…)`), or an OpenAPI or Swagger spec's `paths` (`openapi.yml`, `swagger.json`…), whose routes go to the part implementing the generated API interface named for the route (`/owners/…` to whoever `implements OwnersApi`). A path is called by a string in a file that makes HTTP calls (`fetch`, Angular's `HttpClient`, axios, `RestTemplate`, `WebClient`…), however its URL's glued together: `environment.REST_API_URL + 'owners'` and `` `owners/${ownerId}/pets` `` both count. A called path matches a route when one ends with the other, a parameter matching anything there and a name only itself, and a path that matches several goes to the nearest (`pets` to `/pets`, not `/v2/pets`). Each part that calls another repo's routes gets a dashed gold arrow to the part that declares them, saying which.
- **Change coupling** (`crossRepo.ts`), since a commit never spans two repos. A change that needs two repos shows as one person's commits to each, close together: an author's commits each within two hours of the one before are one change set, across all the project's repos. Two parts in different repos that turn up in the same change sets at least twice, and in a quarter of those that touched either, are tied, the ten most tied kept (`CROSS`). A bot's commits to lockfiles touch no part, and the same commit seen in two repos (a mirror) ties nothing. The project gets a view of its own, *How do its repos connect?*: a column per repo, the parts the evidence joins, a dashed gold arrow for each call and a dotted lilac line for each tie, numbered, and its sentence saying which routes, or how often (*Pets (o/web) and Mapper (o/api) changed together in 2 of the 6 change sets that touched either*). It hangs in the architecture space beside the whole maps, and on the station's **Maps** under the project (or a line saying nothing ties them yet). Checked on the Spring PetClinic REST API (routes in its OpenAPI spec) and its Angular front end (URLs glued from an environment's base): each Angular screen's service calls exactly its routes on the API's REST controllers (*Pets calls /pets, /owners/{ownerId}/pets on REST controllers*), and over 90 days around a change to both, the pets and visits screens tie to the API's DTO mappers.

**What each goal's slice changes** (`slice.ts`): as a goal's lead finishes a turn, the plugin maps their checkout (`leadCheckouts`; in the demo, the office's own checkout stands in for each lead's) and lays it against the project's map of the default branch: which parts the files the slice has changed fall in (committed or not, since it forked from the branch it ships into: `changedFiles`), which parts its model adds or drops, and which imports between parts it makes or breaks. A goal whose slice changes nothing a map shows, or that's closing, drops off; the rest are worked out again against the new maps whenever a pull request merges. Each shows as a view of its own, in the architecture space beside the whole map and under its project on the engineering station's **Maps**: *What does "<the slice's heading>" change?*, the parts it touches outlined in gold with how many lines, what it adds in green, what it takes out red and dashed, and its numbered sentences saying which imports are new. It's the map as the slice will leave it, before it merges, so the captain can see where a goal is taking the architecture while it's under way.

The drawings are SVG made by `draw.ts`, at their own size, shrunk to fit the station but never blown up. **Map again** makes a project's maps again.

Maps are made from each repo's default branch, checked out in the plugin's own folder, under `~/.focus/plugins/cartography/`: 20 seconds after the office starts, and again whenever a pull request merges into one of the project's repos. They're kept in memory only, not in `state.json`. The demo office's repos are made up, so it maps the office's own checkout for each of them.

## What's next

- Call chains for /api requests too (the browser's stack, and the handler's), and runs that cover more of what a captain and a lead do.
- The model itself compared across merged pull requests: parts and connections that came and went, slice by slice.

## Where it lives

- `shared.ts`: the model and the map's types.
- `model.ts`: reading a model from its YAML, and a recorded run from its JSON, saying what's wrong with either.
- `graph.ts`: the map's rules, pure: which files it reads, where an import leads, which part owns a file, connections, a recorded run's flows part to part, and drift.
- `languages.ts`: the languages the map reads, each behind the one interface (which files are its source, and what each uses of the others). `scan.ts`: what a TypeScript file imports, and the names it takes (TypeScript's parser, no type-checking). `java.ts`: what a Java file uses of the others (its package, imports and own package's classes), pure.
- `history.ts`: how the parts change, from git: hotspots and change coupling, pure.
- `routes.ts`: the HTTP routes a repo declares (Spring, Express-style, OpenAPI) and the paths it calls, and the calls between a project's repos, pure.
- `crossRepo.ts`: what ties a project's repos together, from their histories: change sets across repos, and the parts in different repos that change together, pure.
- `slice.ts`: what a goal's slice does to the architecture, from its lead's checkout against the default branch's map, and its view, pure.
- `map.ts`: making a repo's map from a checkout (git ls-files, then each language's reader, and git log for history.ts).
- `steps.ts`: a scenario's steps, written or found in the recorded run's call chains, checked against the map's imports, flows and calls, pure. `sequence.ts`: a scenario drawn as a sequence diagram. `legibility.ts`: how legible a drawing is where it's seen, and the budget a scenario's held to.
- `draw.ts`: drawing a view, the matrix and the changes as SVG, with their sentences (`viewDrawing`, which every place a view shows goes through).
- `views.ts`: a map's views, and what the Maps view says in words.
- `leadTool.ts`: the lead's map tool. `page.ts`: a view as a page for a station's screen.
- `server.ts`: when maps are made, and the `/map` route. `client.ts`: the **Maps** view. `panel.ts`: a view as the browser shows it, and up close. `chart.ts`: the stellar cartography screen's star chart, from `miniature.ts` (the map in miniature, pure). `space.ts`: the architecture space, its arch in `arch.ts`, with `spaceLayout.ts` (where its views and the platform stand, and the holodeck's screen hangs, pure) and `screen.ts` (a view drawn as a screen).
