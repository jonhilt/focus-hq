# Plugins

The office's core is what anyone who adds a project needs: rooms and boards, goal leads, developers, QA, delivery and the ship itself. Anything beyond that is a plugin, switched on by name. Without a plugin, the office has no trace of it: no crew member, no card, no route, no saved state in use.

## Switching plugins on

`FOCUS_PLUGINS` lists the plugins to switch on, comma-separated, in the order they start:

```sh
FOCUS_PLUGINS=climber pnpm start
```

- **A bare name** is a folder under the office's own `plugins/`, like `climber`.
- **A path** (anything with a slash, relative to where the office starts) is a plugin folder anywhere, like `../my-plugins/auditor`.

A plugin that can't be found, or doesn't load, is left out with a line in the office's log saying why. A typo never keeps the office from starting. `info.plugins` in the snapshot lists the plugins that did start.

A plugin's saved state stays in `state.json` while it's switched off, so switching it back on picks up where it was. Nothing of it runs meanwhile, not even its hold on pull requests only the captain merges, so the office warns as it starts when there's saved state for a plugin that isn't switched on.

## Plugins today

- [The scorecard](../plugins/scorecard/README.md) (`scorecard`): main engineering's scorecards of the office's own repo, on the engineering station and the MSD. The `pnpm run scorecard` and `pnpm run crap` scripts live in it too, and work whether it's switched on or not.
- [The climber](../plugins/climber/README.md) (`climber`): main engineering's crew member, who fixes the scorecard's worst gap in the office's own repo, one pull request at a time. It reads the scorecards through the scorecard plugin's code (`officeScorecards`), so it works without that plugin switched on, but you'll want both.

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
  - `prClosed`: any pull request merged or closed.
  - `captainMerges`: whether only the captain merges a pull request, whatever QA and auto-merge say. It goes by branch, since a pull request outlives its agent.

A hook that throws is logged and skipped, so one plugin's bug never stops the office's loops.

## What the office lends a plugin

`start` gets a `PluginHost`:

- **State.** `host.state(fresh)` is the plugin's own slot in `state.json` (`plugins.<id>`). `set` saves it and sends it to every browser as a `plugin` event; the snapshot carries each plugin's state in `plugins`. A field the plugin adds later starts at its `fresh()` value. With `{ saved: false }` it's kept in memory only, for state the plugin reads again as the office starts (the scorecards, read from disk).
- **Seating.** `host.seat` hands one of its briefs to an agent: someone new, or `crew` when it's always the same person, who keeps one record (and terminal) from brief to brief. `host.forget` drops what the office kept of their last session, so the next starts afresh.
- **Reading the office.** Its projects, an agent by id, the ledger, and the office's own repo (`ownRepo`, from its checkout's remote; none in the demo).
- **Talking.** A line in an agent's terminal (`print`), and a toast.

## In the browser

A plugin's `client.ts` default-exports a `ClientPlugin` (`client/src/plugins.ts`). The client finds every `plugins/*/client.ts` as it's built, and shows only those the office switched on. In the browser, a plugin's state is `state.plugins[id]`, and the `plugin` event says whose changed. A plugin can add:

- **To the engineering station** (`engineering`), which the panel draws again whenever the plugin's state changes, or an agent on a brief does:
  - `card`: a card on the overview, beside the others (the climber's);
  - `overview`: the overview's main block, with every card laid out in it (the scorecard puts them beside what moved); the first plugin's wins, and without one the cards stand on their own;
  - `readout`: what the overview's button on the side nav reads;
  - `views`: views of its own on the side nav, after the overview (the scorecard's Code and Office), each with a readout. A view gets `go`, to move to another view and scroll to what's in it.

  The station's own views are the overview (your plan's usage, then the plugins' parts and the retro), the **Ledger** (the report card as it stands, and the open frictions) and the **Retro**.
- **A board on the MSD** (`msd`): what it draws beside the ship in main engineering while it's put up there, with `ui.showOnMsd({ plugin: id })`. It's drawn again as the plugin's state changes.

## Writing one

```
plugins/<id>/
  server.ts     default-exports the FocusPlugin
  client.ts     optional: default-exports the ClientPlugin
  shared.ts     types and constants both halves use (its state's type)
  README.md     what it does, and where it lives
  *.test.ts     its tests (vitest finds plugins/**/*.test.ts)
```

A plugin imports the office's code by path (`../../server/plugins/contract`, `../../shared/types`): its contract, its types, and helpers like `server/agents/fakeOffice.ts`, a pretend office its tests can switch it on in. It can import another plugin's code the same way (the climber reads scorecards through `../scorecard/desk`). Typecheck, lint (no non-null assertions outside tests, as in `server/`), the scorecard's fence and CRAP cover `plugins/` like the rest.

A plugin outside the office's folder can be switched on by path, but for now it still imports the office's code by relative path, and its `client.ts` isn't found (only `plugins/` inside the checkout is). Plugins in repos of their own need a published contract first.

## Where it lives

- `server/plugins/contract.ts`: what a plugin is, what it adds and what the office lends it.
- `server/plugins/registry.ts`: `Plugins`, the core's one way to the plugins switched on (briefs, states, routes, hooks). The manager's core holds it (`core.plugins`), and the office reaches it through `office.agents.plugins`.
- `server/plugins/load.ts`: finding and loading what `FOCUS_PLUGINS` names.
- `server/agents/manager/pluginHost.ts`: the `PluginHost` the manager lends each plugin, and its state slot.
- `server/plugins/migrate.ts`: state saved before parts of the office became plugins, moved into their slots as `state.json` is read.
- `client/src/plugins.ts`: the plugins' parts in the browser.
