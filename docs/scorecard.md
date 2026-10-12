# The scorecard

`pnpm run scorecard` measures Focus against its own standard and keeps each result, so you can see whether the code and the office are getting better or worse over time. Every number comes from a command it runs or a syntax tree it walks, never from reading code by eye. It's the first step of a hill-climb (after [ratstack's hill-climb prompt](https://ratstack.sh/prompts/hill-climb)): measure, take the worst gap, fix it, and prove the fix with the same numbers before and after.

It takes about a minute and a quarter. It always exits 0: it measures, it doesn't judge. It only exits non-zero when it couldn't measure at all.

| | |
| --- | --- |
| `pnpm run scorecard` | measures, saves the result in `~/.focus/scorecards/`, and prints it next to the latest saved one |
| `pnpm run scorecard --no-save` | measures and compares, without saving (on a branch you're still working on, say) |
| `pnpm run scorecard --json` | prints the scorecard as JSON |

## What it measures

- **Gate:** whether `typecheck`, `lint`, the unit tests and `build` all pass, and how long each takes. Typecheck errors are tsc's plus the Effect language service's. Lint errors and warnings come from ESLint's JSON report. The tests run once, with coverage, and the CRAP numbers below come from that same run.
- **Fence:** over `server/`, `shared/`, `client/src/` and `scripts/`, tests left out: type assertions (`as T` and `<T>x`, but not `as const`), non-null assertions (`x!`), `any` written out, `eslint-disable` comments and `@ts-ignore`/`@ts-expect-error`/`@ts-nocheck`. Comments are read with TypeScript's scanner, so the same words inside a string don't count.
- **Effect:** in `server/` (demo code left out):
  - how many files import Effect, and what share of the server that is;
  - the calls that run an Effect (`runPromise`, `runFork`, `runSync`, `runCallback` and their `…Exit` forms), each an edge where Effect hands over to Promise code, and how many files they're in;
  - how many XState machines there are.
  See the [Effect assessment](effect-assessment.md) for the migration path.
- **Tests:** how many tests and test files there are, how many test files use property tests (`fast-check`), and, for `server/` and `shared/`, how many functions score over [CRAP](crap.md) 30 and the total CRAP.
- **Office:** from [the ledger](ledger.md):
  - the report card's numbers over 30 days: QA passed first time, failed QA rounds per merge, merges without a QA pass, conflicts that needed an agent, checks sent back, cost and wasted tool calls per merge, and retro fixes that stopped their friction;
  - the open friction patterns (3 or more sessions in 14 days, with no retro decision yet; see [the retro](retro.md)) and the five most widespread.

## In main engineering

The [climber](climber.md) works from it: each climb measures the scorecard before and after its one change.


The engineering panel (<kbd>E</kbd> at Lt. Brennan's station on deck 5) opens with the latest scorecard, above the report card and the retro:
- each number, a section at a time;
- its change since the one before, ▲ or ▼;
- a little line of its last ten, green when it last climbed and red when it last slipped;
- the most widespread open friction.

**Measure now** runs `pnpm run scorecard` on the office's own checkout (the one it runs from, which auto update keeps on the latest main). It takes about a minute and a half, one measurement at a time, and the panel says when it's under way or why it failed. **Show on the MSD** puts the scorecard up on the master systems display beside the ship: four big numbers (the gate's time, type assertions, functions over CRAP 30, the server's share on Effect) and then the rest, with what moved since the one before listed first. It stays up until you pick a trace at the table or **Clear the MSD**. The demo office's scorecards are made up and kept in memory, so the demo never writes to `~/.focus/scorecards/`.

**After each merge.** Two minutes after it starts, the office measures the commit it runs from by itself, if that commit has no scorecard yet and the checkout has no uncommitted changes (`measureNewCommit` in `server/scorecards.ts`). [Auto update](auto-update.md) restarts the office on each merge to main, so every merge gets a scorecard, and the trend fills in without anyone pressing Measure now. The panel says when a measurement is one of these. The demo office doesn't do it.

The office reads the latest ten from `~/.focus/scorecards/` when it starts and after each measurement (`server/scorecards.ts`, which decodes each with Effect Schema and skips a file that isn't one). A scorecard saved from the terminal shows up after the next restart or measurement. The build step builds into a temporary folder, never the `dist/` the office may be serving.

## Comparing

Each number knows which way is better. The printout marks a change since the latest saved scorecard with ▲ (better) or ▼ (worse). A time has to move by more than 10% to count, because timings wobble from run to run. The comparison header names the commit and branch it compares against, and a scorecard measured with uncommitted changes says so.

To show a change's before and after:

1. Run it on the base branch first.
2. Run it on the change with `--no-save`, so the base stays the latest saved one to compare against.

The rules live in `scripts/scorecardRules.ts` and, for how a scorecard reads wherever it's shown, `shared/scorecard.ts` (both pure, tested next to them). `scripts/scorecard.ts` runs the commands, reads the files and the ledger, and saves the result.
