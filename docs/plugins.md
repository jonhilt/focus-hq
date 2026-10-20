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

A fresh office has none switched on. The demo office (`pnpm run demo`, `demo:start`) has them all unless `FOCUS_PLUGINS` says otherwise (`FOCUS_PLUGINS= pnpm run demo` for one with none, or a list to check a feature with and without it). The scripts that start a demo office of their own (smoke, perf, flows, the gap and z-fighting scans) always switch every plugin on, whatever `FOCUS_PLUGINS` the caller has (an agent inherits the office's), so none of them quietly loses a feature.

A plugin that can't be found, or doesn't load, is left out with a line in the office's log saying why. A typo never keeps the office from starting.

A plugin's saved state stays in `state.json` while it's switched off, so switching it back on picks up where it was. Nothing of it runs meanwhile, not even its hold on pull requests only the captain merges, so the office warns as it starts when there's saved state for a plugin that isn't switched on.

## Plugins today

Each folder under `plugins/` is one, and its README (where it has one) says what it does: `flow`, `number-one`, `retro`, `scorecard`, `cartography`, `briefings`, `usage`, `astrometrics`, `captains-log`, `chief-of-staff` and `climber`. Without a plugin, what it brings isn't there, but the vocabulary the core shares with it stays the core's: the ledger's frictions and retro decisions are still read and shown without the retro, voice mode (dictation and Kokoro) stays the core's kit without Number One, and carrying on with your API key when the plan's limit is reached stays the core's without the usage plugin.

## Plugins that need each other

A plugin that can't work without another says so (`requires`). The office starts every plugin after the ones it requires, whatever order `FOCUS_PLUGINS` lists them in, and leaves out a plugin whose requirement isn't switched on, saying why in its log. The plugins that require a left-out plugin are left out in turn, and so are plugins that require each other round a loop.

A required plugin lends what it shares through what it `provides`; the plugin that requires it asks the host for it (`host.uses`), typed with the providing plugin's own interface. Asking for a plugin it didn't require throws.

| Climber | Scorecard | What happens |
| --- | --- | --- |
| on | on | both start, the scorecard first, and the climber's briefs read main's scorecards through it |
| off | on | the scorecard alone: it needs nothing |
| on | off | the climber is left out, saying why: its routes, card and briefs aren't there, and its saved state waits |

The scorecard provides how to read a number too, so the climber's pure rules take it from what it provides rather than from its code. A plugin that others require can publish an `api.ts`: the one file of it another plugin may import, as `plugin-api/` is the one way into the core. Anything else of it can change without the plugins that require it noticing.

## Switched on per project

`FOCUS_PLUGINS` switches a plugin on for the office. A plugin that works per project (its `client.ts` declares `project`) also has to be switched on for each project it should work on, off until you do. The office keeps its lead tools and holodeck screens out of projects it's off for, and tells it when a project's settings change (`projectChanged`), so one switched on starts its work there at once and one switched off drops what it had. A plugin that stands something in a hall with `ship` checks `pluginOn` itself. Plugins about the office as a whole (the scorecard, the climber) don't declare `project`, and take no notice of the switch.

## What a plugin adds

A plugin is a folder with a `server.ts` that default-exports a `FocusPlugin` (`server/plugins/contract.ts`, which says what each part is). Every part is optional. The rules a plugin must keep to:

- **A brief** is work the plugin hands an agent in place of an issue. Like an issue, it starts a new branch from the repo's default one and ends in a pull request the office opens.
- **Hooks.** A hook that throws is logged and skipped, so one plugin's bug never stops the office's loops. A turn cut short still ends, and a turn can start and end more than once in what looks like one (carrying on, a retry, a new session), so take each `turn` as how the agent stands now; its `end` comes before the office acts on how the turn went, so go by the phase, not the status. `ledgerRecorded` is heard as the line is written, before the office has acted on what it says, so read the office afresh a moment later rather than straight away. `captainMerges` goes by branch, since a pull request outlives its agent.
- **Lead tools.** A name one of the office's own tools has, or another plugin's already took, is left out.

## What the office lends a plugin

`start` gets a `PluginHost`. What it reads of the office is a copy of its own (`server/plugins/lend.ts`): it can keep and change it, but that never changes the office's, or what another plugin hears. The API types them read-only too, so writing to one is a compile error. Its limits:

- **State.** A field the plugin adds later starts at its `fresh()` value, and nothing is saved until it's first set, so an office that never used a plugin has nothing of it waiting. What it keeps saved and what it keeps in memory only (`{ saved: false }`) reach the browser side by side, so their keys mustn't meet.
- **Filing an issue** and **checking out** a repo work only in the office's projects' repos: the office refuses any other. A goal lead's checkouts (`leadCheckouts`) are only to read, since the lead's at work in them.
- **The whole office** (`snapshot`) is a lot: ask for it when it's needed (a call's answer), not on a timer, and only read it.
- **The captain's personal log and goals**: jot a thought down only when the captain asks, and start or message a goal only on the captain's word.

## In the browser

A plugin's `client.ts` default-exports a `ClientPlugin` (`client/src/plugins.ts`). It's loaded whether the plugin's switched on or not (the client finds every one as it's built), so it must do nothing as it loads: no listeners, no timers. Anything that runs goes in `start` or `ship`, which only run for plugins switched on. Its CSS (imported from its `client.ts`) is always bundled too, so give its classes names of its own (`number-one-call`).

- **Keys**: use only keys of the plugin's own, and check `ui.panels.isOpen`, since a plugin's keys are heard before the core's.
- **What throws is left out**: a `hud` that throws is logged and left out, and a `ship` part that throws is logged and left out with all it asked for, so the ship is built without it.
- **A part of the ship** is built only as the World builds the ship, so a plugin the office switches on while a browser stays connected stands in the ship only from the next build, and one switched off isn't stopped until the page reloads.
- **Its part of the station's screen**: when the lead shows the same id again, the new version's `screen` gets the old one's part as `before`, which the screen doesn't end: the plugin carries over what should outlast it and ends the rest.
- **Screens in a holodeck** (`hall`): no plugin hangs one today. The cartography plugin's views moved to a space of its own, since six screens round the wall crowded the team pods.

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

### The plugin API

A plugin reaches the office only through `plugin-api/`, the core's one published surface for plugins: `shared.ts` (types and pure values both halves use), `server.ts` (the contract a `server.ts` implements, and what its scripts use without a host), `client.ts` (the contract a `client.ts` implements, and the UI kits), `layout.ts` (where the ship's spaces are, loadable without the browser), and `testing.ts`, for its tests only (a pretend office, and the office's [two rules for state](invariants.md)).

Whatever the API doesn't re-export, the core can change without a plugin noticing. When a plugin needs more of the office, the API grows: what the office does for a plugin (files, checkouts, GitHub, sessions) goes on the host, so the core decides what a plugin can do and a test can lend it a fake; a type or a pure helper is re-exported. For another plugin, see [plugins that need each other](#plugins-that-need-each-other): it reaches what that plugin provides through the host, and imports only that plugin's `api.ts`.

`plugin-api/boundary.test.ts` holds the repo to it, resolving every import as TypeScript does: a plugin imports only its own files, `plugin-api/` (`testing.ts` from tests alone), npm packages and another plugin's `api.ts`, and the core never imports a plugin. Every plugin is held to it, a new one from the start: an import past the API fails the suite, naming the file, the line and why.

Typecheck, lint (no non-null assertions outside tests, as in `server/`), the scorecard's fence and CRAP cover `plugins/` like the rest.

A plugin outside the office's folder can be switched on by path, but for now it still imports `plugin-api/` by relative path, and its `client.ts` isn't found (only `plugins/` inside the checkout is). Plugins in repos of their own need the API published as a package first.

Both sides stand on their own. The core needs no plugin: with `plugins/` deleted, it typechecks, its tests pass (they load plugins of their own making, never the office's by name), the client builds and the demo office runs, with the engineering station's own Overview and Ledger. And a plugin needs nothing of the core but the API: each of the office's plugins typechecks in a folder of its own outside the checkout, against `plugin-api/` emitted as declarations (`tsc --declaration --emitDeclarationOnly`), with no source of the core beside it. Those declarations still carry the core's own types that the API's reach (a published package would bundle only the API's, with API Extractor or the like), so it's `boundary.test.ts`, not the build, that keeps a plugin from importing past the API.
