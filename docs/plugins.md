# Plugins

Focus's core is what anyone who adds a project needs: rooms and boards, goal leads, developers, QA, delivery and the ship itself. Anything beyond that is a plugin, switched on by name. Without a plugin, Focus has no trace of it: no crew member, no card, no route, no saved state in use.

## Switching plugins on

`FOCUS_PLUGINS` lists the plugins to switch on, comma-separated, in the order they start:

```sh
FOCUS_PLUGINS=scorecard,climber pnpm start
```

- **A bare name** is a folder under Focus's own `plugins/`, like `climber`.
- **A path** (anything with a slash, relative to where Focus starts) is a plugin folder anywhere, like `../my-plugins/auditor`.
- **`all`** is every folder under Focus's own `plugins/`, so `FOCUS_PLUGINS=all` switches the lot on (and `all,../my-plugins/auditor` one more besides).

A fresh Focus has none switched on. The demo ship (`pnpm run demo`, `demo:start`) has them all unless `FOCUS_PLUGINS` says otherwise (`FOCUS_PLUGINS= pnpm run demo` for one with none, or a list to check a feature with and without it). The scripts that start a demo ship of their own (smoke, perf, flows, the gap and z-fighting scans) always switch every plugin on, whatever `FOCUS_PLUGINS` the caller has (an agent inherits Focus's), so none of them quietly loses a feature.

A plugin that can't be found, or doesn't load, is left out with a line in Focus's log saying why. A typo never keeps Focus from starting.

A plugin's saved state stays in `state.json` while it's switched off, so switching it back on picks up where it was. Nothing of it runs meanwhile, not even its hold on pull requests only the captain merges, so Focus warns as it starts when there's saved state for a plugin that isn't switched on.

## Plugins today

Each folder under `plugins/` is one, and its README (where it has one) says what it does: `flow`, `number-one`, `retro`, `scorecard`, `cartography`, `briefings`, `usage`, `astrometrics`, `captains-log`, `chief-of-staff` and `climber`. Without a plugin, what it brings isn't there, but the vocabulary the core shares with it stays the core's: the ledger's frictions and retro decisions are still read and shown without the retro, voice mode (dictation and Kokoro) stays the core's kit without Number One, and carrying on with your API key when the plan's limit is reached stays the core's without the usage plugin.

## Plugins that need each other

A plugin that can't work without another says so (`requires`). Focus starts every plugin after the ones it requires, whatever order `FOCUS_PLUGINS` lists them in, and leaves out a plugin whose requirement isn't switched on, saying why in its log. The plugins that require a left-out plugin are left out in turn, and so are plugins that require each other round a loop.

A required plugin lends what it shares through what it `provides`; the plugin that requires it asks the host for it (`host.uses`), typed with the providing plugin's own interface. Asking for a plugin it didn't require throws.

| Climber | Scorecard | What happens |
| --- | --- | --- |
| on | on | both start, the scorecard first, and the climber's briefs read main's scorecards through it |
| off | on | the scorecard alone: it needs nothing |
| on | off | the climber is left out, saying why: its routes, card and briefs aren't there, and its saved state waits |

The scorecard provides how to read a number too, so the climber's pure rules take it from what it provides rather than from its code. A plugin that others require can publish an `api.ts`: the one file of it another plugin may import, as `plugin-api/` is the one way into the core. Anything else of it can change without the plugins that require it noticing.

## Switched on per project

`FOCUS_PLUGINS` switches a plugin on for Focus. A plugin that works per project (its `client.ts` declares `project`) also has to be switched on for each project it should work on, off until you do. Focus keeps its lead tools and holodeck screens out of projects it's off for, and tells it when a project's settings change (`projectChanged`), so one switched on starts its work there at once and one switched off drops what it had. A plugin that stands something in a hall with `ship` checks `pluginOn` itself. Plugins about the ship as a whole (the scorecard, the climber) don't declare `project`, and take no notice of the switch.

## What a plugin adds

A plugin is a folder with a `server.ts` that default-exports a `FocusPlugin` (`server/plugins/contract.ts`, which says what each part is). Every part is optional. The rules a plugin must keep to:

- **A brief** is work the plugin hands an agent in place of an issue. Like an issue, it starts a new branch from the repo's default one and ends in a pull request Ops opens.
- **Hooks.** A hook that throws is logged and skipped, so one plugin's bug never stops Focus's loops. A turn cut short still ends, and a turn can start and end more than once in what looks like one (carrying on, a retry, a new session), so take each `turn` as how the agent stands now; its `end` comes before Ops acts on how the turn went, so go by the phase, not the status. `ledgerRecorded` is heard as the line is written, before Ops has acted on what it says, so read Focus afresh a moment later rather than straight away. `captainMerges` goes by branch, since a pull request outlives its agent. `leadNoted` is how a plugin hears the news Ops left a goal's lead as a note (QA's verdict, their slice landing): the core never wakes a lead for it, so a plugin that should (the chief of staff) messages the lead itself, and the note goes ahead of its message. A plugin notes what it makes of a goal lead's turn on the lead itself (`host.goals.mark`), in its own shape: kept with the lead and sent to the browser until their next turn starts, so a plugin that judges turns (the chief of staff) can file one without the core knowing what it means. A mark is taken once the turn has ended (from its `turn` end on), and refused once a later turn has started, so a verdict that comes too late is dropped. `captainAnswered` is heard once the captain's answer from an agent's panel has gone through, with the agent as it stood before it: how a plugin keeps a record of what the captain decided without standing between them and the agent.
- **Lead tools.** A name one of Ops' own tools has, or another plugin's already took, is left out.
- **Routes for a bot.** A route marked `bot` is mounted at `/api/bot<path>` rather than under the plugin's prefix, open only to Focus's bot token (`FOCUS_BOT_TOKEN`), and the bot's settings are lent (`host.bot`): the path is a bot's public contract, so it doesn't move with the plugin. Two plugins with the same bot path is a mistake: the first started answers.

## What Focus lends a plugin

`start` gets a `PluginHost`. What it reads of Focus is a copy of its own (`server/plugins/lend.ts`): it can keep and change it, but that never changes Focus's, or what another plugin hears. The API types them read-only too, so writing to one is a compile error. Its limits:

- **State.** A field the plugin adds later starts at its `fresh()` value, and nothing is saved until it's first set, so a Focus that never used a plugin has nothing of it waiting. What it keeps saved and what it keeps in memory only (`{ saved: false }`) reach the browser side by side, so their keys mustn't meet.
- **Filing an issue** and **checking out** a repo work only in Focus's projects' repos: Ops refuses any other. A goal lead's checkouts (`leadCheckouts`) are only to read, since the lead's at work in them.
- **The whole ship** (`snapshot`) is a lot: ask for it when it's needed (a call's answer), not on a timer, and only read it.
- **The captain's personal log and goals**: jot a thought down only when the captain asks, and start or message a goal only on the captain's word.

## In the browser

A plugin's `client.ts` default-exports a `ClientPlugin` (`client/src/plugins.ts`). It's loaded whether the plugin's switched on or not (the client finds every one as it's built), so it must do nothing as it loads: no listeners, no timers. Anything that runs goes in `start` or `ship`, which only run for plugins switched on. Its CSS (imported from its `client.ts`) is always bundled too, so give its classes names of its own (`number-one-call`).

- **Keys**: use only keys of the plugin's own, and check `ui.panels.isOpen`, since a plugin's keys are heard before the core's.
- **A panel of its own** (`panel`) is opened with `ui.openPlugin(id)`, and from the pause panel; **a chair** the core leaves empty (the bridge's, `chair`) puts something of the plugin's to hand there; **a view of every goal** (`everyGoal`) is what L opens off a holodeck, with a way back out to it in each project's goals panel. With the plugin off, none is there: the core puts nothing in the bridge's chair, and L off a holodeck opens the first project's goals.
- **What waits on the captain**: the core counts it on the HUD, toasts each agent as it comes to need the captain, and lists it at the top of the phone (`needsYou`), so a lead's turn never ends unseen. A plugin that puts it in front of them its own way says so (`hails`, on its `client.ts` and its `phone.ts`), and the core's plain ones step aside while it's on.
- **Its settings in a project** (`project.settings`) show beside its switch in the project's card, while it's on there.
- **What throws is left out**: a `hud` that throws is logged and left out, and a `ship` part that throws is logged and left out with all it asked for, so the ship is built without it.
- **A part of the ship** is built only as the World builds the ship, so a plugin Focus switches on while a browser stays connected stands in the ship only from the next build, and one switched off isn't stopped until the page reloads.
- **Its part of the station's screen**: when the lead shows the same id again, the new version's `screen` gets the old one's part as `before`, which the screen doesn't end: the plugin carries over what should outlast it and ends the rest.
- **On the phone**: a plugin's `phone.ts` default-exports a `PhonePlugin` (`client/src/tricorder/phonePlugins.ts`), found as the Tricorder's built, with sections for the top of its home screen. It imports only `plugin-api/phone.ts` (the same view of Focus as `client.ts` has, from `plugin-api/browser.ts`), so nothing of three.js comes with it (`tricorder/imports.test.ts` checks), and its CSS goes into the Tricorder alone.
- **Screens in a holodeck** (`hall`): no plugin hangs one today. The cartography plugin's views moved to a space of its own, since six screens round the wall crowded the team pods.

## Writing one

```
plugins/<id>/
  server.ts     default-exports the FocusPlugin
  client.ts     optional: default-exports the ClientPlugin
  phone.ts      optional: default-exports the PhonePlugin, its part on the phone
  <id>.css      optional: its styles, imported by client.ts (bundled whether it's on or not, so its own class names)
  shared.ts     types and constants both halves use (its state's type)
  README.md     what it does, and where it lives
  *.test.ts     its tests (vitest finds plugins/**/*.test.ts)
```

### The plugin API

A plugin reaches Focus only through `plugin-api/`, the core's one published surface for plugins: `shared.ts` (types and pure values both halves use), `server.ts` (the contract a `server.ts` implements, and what its scripts use without a host), `client.ts` (the contract a `client.ts` implements, and the UI kits), `phone.ts` (the contract a `phone.ts` implements), `browser.ts` (what both browser parts read of Focus, and their own routes), `layout.ts` (where the ship's spaces are, loadable without the browser), and `testing.ts`, for its tests only (a pretend Focus, and Focus's [two rules for state](invariants.md)).

Whatever the API doesn't re-export, the core can change without a plugin noticing. When a plugin needs more of Focus, the API grows: what Focus does for a plugin (files, checkouts, GitHub, sessions) goes on the host, so the core decides what a plugin can do and a test can lend it a fake; a type or a pure helper is re-exported. For another plugin, see [plugins that need each other](#plugins-that-need-each-other): it reaches what that plugin provides through the host, and imports only that plugin's `api.ts`.

`plugin-api/boundary.test.ts` holds the repo to it, resolving every import as TypeScript does: a plugin imports only its own files, `plugin-api/` (`testing.ts` from tests alone), npm packages and another plugin's `api.ts`, and the core never imports a plugin. Every plugin is held to it, a new one from the start: an import past the API fails the suite, naming the file, the line and why.

Typecheck, lint (no non-null assertions outside tests, as in `server/`), the scorecard's fence and CRAP cover `plugins/` like the rest.

A plugin outside Focus's folder can be switched on by path, but for now it still imports `plugin-api/` by relative path, and its `client.ts` isn't found (only `plugins/` inside the checkout is). Plugins in repos of their own need the API published as a package first.

Both sides stand on their own. The core needs no plugin: with `plugins/` deleted, it typechecks, its tests pass (they load plugins of their own making, never Focus's by name), the client builds and the demo ship runs, with the engineering station's own Overview and Ledger. And a plugin needs nothing of the core but the API: each of Focus's plugins typechecks in a folder of its own outside the checkout, against `plugin-api/` emitted as declarations (`tsc --declaration --emitDeclarationOnly`), with no source of the core beside it. Those declarations still carry the core's own types that the API's reach (a published package would bundle only the API's, with API Extractor or the like), so it's `boundary.test.ts`, not the build, that keeps a plugin from importing past the API.
