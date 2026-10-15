# Plugins

The office's core is what anyone who adds a project needs: rooms and boards, goal leads, developers, QA, delivery and the ship itself. Anything beyond that is a plugin, switched on by name. Without a plugin, the office has no trace of it: no crew member, no card, no route, no saved state in use.

## Switching plugins on

`FOCUS_PLUGINS` lists the plugins to switch on, comma-separated, in the order they start:

```sh
FOCUS_PLUGINS=scorecard,climber pnpm start
```

- **A bare name** is a folder under the office's own `plugins/`, like `climber`.
- **A path** (anything with a slash, relative to where the office starts) is a plugin folder anywhere, like `../my-plugins/auditor`.
- **`all`** is every folder under the office's own `plugins/`, so `FOCUS_PLUGINS=all` switches the lot on (and `all,../my-plugins/auditor` one more besides).

A fresh office has none switched on. The demo office (`pnpm run demo`, `demo:start`) has them all unless `FOCUS_PLUGINS` says otherwise (`FOCUS_PLUGINS= pnpm run demo` for one with none, or a list to check a feature with and without it). The scripts that start a demo office of their own (smoke, perf, the studio's recorder, the gap and z-fighting scans, through `startDemo` in `scripts/demoOffice.ts`) always switch every plugin on, whatever `FOCUS_PLUGINS` the caller has (an agent inherits the office's), so none of them quietly loses a feature; the theme shots are taken from a demo office already running.

A plugin that can't be found, or doesn't load, is left out with a line in the office's log saying why. A typo never keeps the office from starting. `info.plugins` in the snapshot lists the plugins that did start.

A plugin's saved state stays in `state.json` while it's switched off, so switching it back on picks up where it was. Nothing of it runs meanwhile, not even its hold on pull requests only the captain merges, so the office warns as it starts when there's saved state for a plugin that isn't switched on.

## Plugins today

- [Where goals' time goes](../plugins/flow/README.md) (`flow`): each open goal's flow (what it's waiting on now, for how long, and where its time has gone) on its goal board, its card in the goals list and its lines in Comms. The `pnpm run flow` and [`pnpm run qa-catch`](../plugins/flow/qa-catch.md) scripts live in it too, and work whether it's switched on or not.
- [Number One](../plugins/number-one/README.md) (`number-one`): Cmdr. Adair, the ship's first officer, across the captain's desk in the ready room: a read-only chat about any project's code or the ship (<kbd>E</kbd> on them, or <kbd>1</kbd> anywhere aboard), with voice mode, a toast when a reply lands while you're elsewhere, and [calls](../plugins/number-one/calls.md) hands-free that start goals on your spoken yes. Without it nobody sits across the desk. Voice mode stays the core's kit (dictation and Kokoro, which the narrator shares): Number One brings their own voice to it.
- [The chief engineer's retro](../plugins/retro/README.md) (`retro`): Lt. Brennan reads the frictions in the agents' sessions and drafts an issue for each that keeps coming back, for the captain to accept (it's filed) or reject. Its card and Retro view are on the engineering station, and while one runs or waits on the captain, Brennan says so at his station. The ledger's frictions and retro decisions stay the core's vocabulary: without the plugin they're still read and shown, but no new ones are written.
- [The scorecard](../plugins/scorecard/README.md) (`scorecard`): main engineering's scorecards of the office's own repo, on the engineering station and the MSD. The `pnpm run scorecard` and `pnpm run crap` scripts live in it too, and work whether it's switched on or not.
- [Cartography](../plugins/cartography/README.md) (`cartography`): each project's architecture map, from the model its repos keep in `.focus/cartography.yaml` and the imports their code makes: on the engineering station's **Maps** view, each view drawn with numbered arrows and said in sentences, the whole map as a dependency matrix, and how it changes (hotspots and change coupling from git).
- [The climber](../plugins/climber/README.md) (`climber`): main engineering's crew member, who fixes the scorecard's worst gap in the office's own repo, one pull request at a time. It requires the scorecard plugin: switched on without it, it's left out, saying why.

## Plugins that need each other

A plugin that can't work without another says so: `requires: ['scorecard']` on its `FocusPlugin`. The office starts every plugin after the ones it requires, whatever order `FOCUS_PLUGINS` lists them in, and leaves out a plugin whose requirement isn't switched on, saying why in its log (`it requires scorecard, which isn't switched on (add it to FOCUS_PLUGINS)`). The plugins that require a left-out plugin are left out in turn, and so are plugins that require each other round a loop. The plugins left out, and why, are in `Plugins.leftOut`.

A required plugin lends what it shares through `provides`, returned from its `start` (the scorecard provides main's scorecards: `history` and `noise`). The plugin that requires it asks the host: `host.uses<ScorecardService>('scorecard')`, typed with the providing plugin's own interface, imported as a type only, so no code passes between them. Asking for a plugin it didn't require throws.

| Climber | Scorecard | What happens |
| --- | --- | --- |
| on | on | both start, the scorecard first, and the climber's briefs read main's scorecards through it |
| off | on | the scorecard alone: it needs nothing |
| on | off | the climber is left out, saying why: its routes, card and briefs aren't there, and its saved state waits |

The scorecard provides how to read a number too (`direction`: whether it's moved past its wobble; `formatValue`: how it's written), so the climber's pure rules take them from what it provides rather than from its code. Only the climber's replay script (`pnpm run climb:replay`), a tool for working on the climber's prompt, imports the scorecard's code by path.

## Switched on per project

`FOCUS_PLUGINS` switches a plugin on for the office. A plugin that works per project, like cartography, also has to be switched on for each project it should work on: a switch in the project's settings (the manager's **Projects** tab, under **Plugins**), off until you switch it on. The project keeps the list (`Project.plugins`, `shared/projectPlugins.ts`), and the office:

- shows the switch only for the plugins switched on in the office whose `client.ts` declares `project` (a `label` and an `about`);
- keeps a plugin's lead tools out of the offices of goals in projects it's off for, and its holodeck screens out of their halls;
- tells the plugins when a project's settings change (`projectChanged`), so one switched on starts its work there at once, and one switched off drops what it had;
- answers `host.on(projectId)` for the plugin to ask itself.

Plugins about the office as a whole (the scorecard, the climber) don't declare `project`, and take no notice of the switch. The demo switches every plugin on for its two projects.

## What a plugin adds

A plugin is a folder with a `server.ts` that default-exports a `FocusPlugin` (`server/plugins/contract.ts`): an `id` and a `start(host)` that returns what it adds. Every part is optional:

- **Briefs.** A brief is work the plugin hands an agent in place of an issue. The agent has task `brief`, and `agent.brief` says whose brief it is (plugin and kind), with a label and icon for the name tag, the panels and the Tricorder. Like an issue, a brief starts a new branch from the repo's default one and ends in a pull request the office opens. The plugin's `BriefSpec` supplies:
  - the system prompt's assignment and what the final message must be;
  - the first message (`brief`, an Effect that may read GitHub);
  - the pull request's title and body from the final message (no `Closes #…` is added, since there's no issue);
  - whether they work away from the room's desks (`away`: `AWAY_DESK`, outside the room's limit);
  - what the demo office's scripted stand-in writes up (`demo`).
- **Routes.** Each `PluginRoute` is mounted under `/api/plugins/<id>`. A handler's return value goes back as JSON, and a throw becomes a 400 with its message.
- **Hooks.**
  - `boardRefreshed`: a project's board was read from GitHub again (about once a minute), a moment to look at how its work stands.
  - `prOpened`: the office opened or updated the pull request of an agent on one of its briefs.
  - `prClosed`: any pull request merged or closed, a goal's too (once the goal has heard).
  - `turn`: an agent's turn started or ended, any agent's (the flow plugin keeps leads). A turn cut short still ends, and a turn can start and end more than once in what looks like one (carrying on, a retry, a new session), so take each as how the agent stands now. `end` comes before the office acts on how the turn went, so the agent's status still says `working`: go by the phase.
  - `ledgerRecorded`: a line went in the ship's log, any kind. It's heard as it's written, before the office has acted on what it says (a goal's pull request merging is logged before the goal knows), so read the office afresh a moment later rather than straight away.
  - `projectChanged`: a project's settings changed, a plugin switched on or off for it, say.
  - `captainMerges`: whether only the captain merges a pull request, whatever QA and auto-merge say. It goes by branch, since a pull request outlives its agent.
- **Lead tools.** `leadTools`: tools added to the office of every goal lead whose project the plugin's switched on for beside ship, note and show, as `mcp__office__<name>`. Each has a `name` (lowercase, digits and underscores; one the office's own tools have, or another plugin's already took, is left out), a `description` the lead reads, an `input` of zod fields, and `run(lead, input)`, which answers in words (a throw is said back as the tool failing). `lead` is a `LeadToolContext`: the lead's agent, their `checkouts` of the goal's repos as they stand in their workspace, and `show(page)`, which puts a page on their station's screen as their show tool does. The cartography plugin's `map` tool is the first.

A hook that throws is logged and skipped, so one plugin's bug never stops the office's loops.

## What the office lends a plugin

`start` gets a `PluginHost`:

- **State.** `host.state(fresh)` is the plugin's own slot in `state.json` (`plugins.<id>`). `set` saves it and sends it to every browser as a `plugin` event; the snapshot carries each plugin's state in `plugins`. A field the plugin adds later starts at its `fresh()` value. With `{ saved: false }` it's kept in memory only, for state the plugin reads again as the office starts (the scorecards, read from disk). A plugin can keep both on its id: the browser gets them side by side, so their keys mustn't meet (Number One saves its `chat`, but not what it's reading this moment, nor the call, which change too often or mean nothing after a restart). Nothing is saved until it's first set, so an office that never used a plugin has nothing of it waiting.
- **Seating.** `host.seat` hands one of its briefs to an agent: someone new, or `crew` when it's always the same person, who keeps one record (and terminal) from brief to brief. `host.forget` drops what the office kept of their last session, so the next starts afresh.
- **Reading the office.** Its projects, an agent by id or every agent (`agents`), the ledger, an agent session's Claude Code transcript by its session id (`transcript`: none for a cloud session's, and the scripted stand-ins in the demo, its pretend leads' and its older sessions'), the captain's settings (`settings`: the model a read-only session runs on, say), and the office's own repo (`ownRepo`, from its checkout's remote; none in the demo).
- **Writing the ledger.** `record` writes a line in the ship's log and sends the new report card. Every plugin hears it on `ledgerRecorded`, the one writing it too.
- **Filing an issue.** `fileIssue` files one on GitHub and puts it on the project's board straight away. Only in one of that project's own repos: the office refuses any other.
- **The whole office.** `snapshot` is the office as a browser gets it when it connects: projects, every agent with their recent terminal lines, boards, QA's reviews, the Ops stations' drafts and every plugin's state. It's a lot, so ask for it when it's needed (a call's answer), not on a timer, and only read it. `shipStatus` is the ship as the crew's `ship_status` tool tells it (`server/agents/shipStatus.ts`, which the studio's computer reads too): who's on what and where their worktree is, the open pull requests, what needs the captain, and each closed goal's pull requests looked up on GitHub now. Number One reads both.
- **The captain's goals.** `goals.start` starts a goal with a lead of its own at a free team station, or queues it when every station has one, saying where it came `from` (Number One's calls start theirs `from: 'a call'`); `goals.startQueued` starts a queued one at a station; `goals.message` passes a lead a word, as the captain's. Do these only on the captain's word.
- **Talking.** A line in an agent's terminal (`print`), and a toast.

## In the browser

A plugin's `client.ts` default-exports a `ClientPlugin` (`client/src/plugins.ts`). The client finds every `plugins/*/client.ts` as it's built, and shows only those the office switched on. In the browser, a plugin's state is `state.plugins[id]`, and the `plugin` event says whose changed. A plugin can add:

- **To the engineering station** (`engineering`), which the panel draws again whenever the plugin's state changes, or an agent on a brief does:
  - `card`: a card on the overview, beside the others (the climber's, the retro's), with `go` to open one of the station's views from it;
  - `overview`: the overview's main block, with every card laid out in it (the scorecard puts them beside what moved); the first plugin's wins, and without one the cards stand on their own;
  - `readout`: what the overview's button on the side nav reads;
  - `views`: views of its own on the side nav, after the overview (the scorecard's Code and Office, the retro's Retro), each with a readout. A view gets `go`, to move to another view and scroll to what's in it;
  - `station`: what the chief engineer is busy with at his station in main engineering, when it's the plugin's work, or null: a status and one line, which his bubble says and his screen shows under the report card (the retro's `Retro: 2 drafts waiting`). The first plugin with something to say is heard; with none, he's keeping the ship running. It's drawn again as the plugin's state changes.

  The station's own views are the overview (your plan's usage, then the plugins' parts) and the **Ledger** (the report card as it stands, the open frictions, and **Digest them** for older sessions).
- **A word on each goal under way** (`goal`), which the core places on the goal's own surfaces:
  - `tag`: a readout on the goal's card in the goals list (`card`, under a label) or a tag on its lines in Comms (`line`). The core gives it its look (`goal-readout`, `goal-tag`) in the colour of its `--tone`. The goals list is drawn again as the plugin's state changes; Comms keeps lines from render to render, so a line's tag should keep itself up to date (the flow plugin's does, each minute and as its state changes).
  - `board`: a strip along the bottom of the goal board in its briefing room, with its height and a key: the board makes room for it, and draws it again when its key changes, as the plugin's state changes, and each minute while it's shown, so a time in it can count up.
- **A board on the MSD** (`msd`): what it draws beside the ship in main engineering while it's put up there, with `ui.showOnMsd({ plugin: id })`. It's drawn again as the plugin's state changes.
- **Screens in a project's holodeck** (`hall`): given a project's id, the screens it hangs round that holodeck's wall, either side of the entrance, each a hologram you walk up to (`world/hallScreens.ts`). A screen has a `key`, a `title` (aiming at it reads *Look at …*), a `version`, and `draw(ctx, w, h)` on a 1280 × 800 canvas, which may be async. It's drawn again only when its `version` changes, at most as often as the board is. `closeUp(ui)` is what E on it opens. They're asked for again whenever the plugin's state changes. A hall has room for `HALL_SCREENS` (6) in all, given out in the order `FOCUS_PLUGINS` lists the plugins. The cartography plugin hangs a screen per view.
- **What it does from the start** (`start`): called once with the app (`{ ui }`), when the office's first snapshot says the plugin is on, for what it does outside any panel: Number One's toast when a reply lands (with **Read it**, a toast action that opens its panel), and letting go of the call's mic when the office ends the call. It returns the parts that run from then on: `keydown`, a key pressed while the captain walks the ship (not typing, nor in a panel that hides the view), heard before the core's own keys, true when it used it. Use only keys of the plugin's own, and check `ui.panels.isOpen` (Number One's <kbd>1</kbd> does nothing with a panel open).
- **Keys in the legend** (`legend`): `{ key, label }`s added to the controls listed on the splash screen and along the bottom of the view (`1 Number One`).
- **A part of the ship** (`ship`): built with the rest each time the World builds the ship (as projects come and go), and disposed before the next. Its `ShipHost` lends a deck's seat marker by name (`seat('command', 'ready-room-guest')`, undefined when the deck has none), `mount` to put something on a deck (drawn and culled with it, taken off on the next build), `collide` for a box the player can't walk into, and `interactive` to make something usable with <kbd>E</kbd> (its hint, and what it does with the app: `use` is handed the `Ui`, since the World that builds the ship has none of its own, which is why `world/builder.ts` imports the `Ui` type). The part follows its own state (subscribing as it's built, and unsubscribing in `dispose`), and `update` runs each frame with the camera. What a part asks of its host is held until its `ship` returns: one that throws is logged and left out with all it asked for (`shipParts`), so the ship is built without it. Parts are built only as the World builds the ship, so a plugin the office switches on while a browser stays connected (a restart with a different `FOCUS_PLUGINS`) starts at once but stands in the ship only from the next build, and one switched off isn't stopped until the page reloads. Number One's figure is one: a chair, the character and their PADD at the ready room's guest seat.

A plugin's `client.ts` is loaded whether it's switched on or not (the client finds every one as it's built), so it must do nothing as it loads: no listeners, no timers. Anything that runs goes in `start` or `ship`, which only run for plugins switched on. Its CSS (imported from its `client.ts`) is always bundled too, so give its classes names of its own (`number-one-call`).

## Writing one

```
plugins/<id>/
  server.ts     default-exports the FocusPlugin
  client.ts     optional: default-exports the ClientPlugin
  <id>.css      optional: its styles, imported by client.ts (bundled whether it's on or not, so its own class names)
  shared.ts     types and constants both halves use (its state's type)
  README.md     what it does, and where it lives
  *.test.ts     its tests (vitest finds plugins/**/*.test.ts)
```

A plugin imports the office's code by path (`../../server/plugins/contract`, `../../shared/types`): its contract, its types, and helpers like `server/agents/fakeOffice.ts`, a pretend office its tests can switch it on in. For another plugin, see [plugins that need each other](#plugins-that-need-each-other): it reaches what that plugin provides through the host, not its code. Typecheck, lint (no non-null assertions outside tests, as in `server/`), the scorecard's fence and CRAP cover `plugins/` like the rest.

A plugin outside the office's folder can be switched on by path, but for now it still imports the office's code by relative path, and its `client.ts` isn't found (only `plugins/` inside the checkout is). Plugins in repos of their own need a published contract first.

## Where it lives

- `server/plugins/contract.ts`: what a plugin is, what it adds and what the office lends it.
- `server/plugins/registry.ts`: `Plugins`, the core's one way to the plugins switched on (briefs, states, routes, hooks). The manager's core holds it (`core.plugins`), and the office reaches it through `office.agents.plugins`.
- `server/plugins/load.ts`: finding and loading what `FOCUS_PLUGINS` names (`all` too).
- `server/agents/manager/pluginHost.ts`: the `PluginHost` the manager lends each plugin, and its state slot.
- `server/plugins/migrate.ts`: state saved before parts of the office became plugins, moved into their slots as `state.json` is read (or dropped, like a goal's flow, which the flow plugin works out again).
- `client/src/plugins.ts`: the plugins' parts in the browser, `goalTags` and `goalStrips`, which the goals list, Comms and the goal board place, and `stationSays`, what the engineer at the engineering station says. `main.ts` starts each plugin once and asks their `keydown`s before its own keys; the World builds their parts of the ship (`world/shipParts.ts`) after the decks.
- `server/agents/shipStatus.ts`: the ship's status lent as `host.shipStatus` (the office builds it in `index.ts`, with GitHub and the agents' worktrees).
