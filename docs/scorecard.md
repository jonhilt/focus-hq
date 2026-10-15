# The scorecard

`pnpm run scorecard` measures Focus against its own standard and keeps each result, so you can see whether the code and the office are getting better or worse over time. Every number comes from a command it runs or a syntax tree it walks, never from reading code by eye. It's the first step of a hill-climb (after [ratstack's hill-climb prompt](https://ratstack.sh/prompts/hill-climb)): measure, take the worst gap, fix it, and prove the fix with the same numbers before and after.

It takes about a minute and a quarter. It always exits 0: it measures, it doesn't judge. It only exits non-zero when it couldn't measure at all.

| | |
| --- | --- |
| `pnpm run scorecard` | measures, saves the result in `~/.focus/scorecards/`, and prints it next to the latest saved one |
| `pnpm run scorecard --no-save` | measures and compares, without saving (on a branch you're still working on, say) |
| `pnpm run scorecard --json` | prints the scorecard as JSON |
| `pnpm run scorecard --repeat 5` | measures 5 times on this commit and saves how far each number wobbles, its [noise floor](#noise-floor), in `~/.focus/scorecards/noise/` (with `--no-save`, only prints it) |

## What it measures

- **Gate:** whether `typecheck`, `lint`, the unit tests and `build` all pass, and how long each takes. Typecheck errors are tsc's plus the Effect language service's. Lint errors and warnings come from ESLint's JSON report. The tests run once, with coverage, and the CRAP numbers below come from that same run. When a test fails, it prints each failure as it finishes the tests: the file and test, the error's first line, and the command that runs it again on the same seed (`FOCUS_TEST_SEED=… pnpm test <file> -t '<test>'`), so a red gate says what to look at instead of being put down to load.
- **Fence:** over `server/`, `shared/`, `client/src/` and `scripts/`, tests left out: type assertions (`as T` and `<T>x`, but not `as const`), non-null assertions (`x!`), `any` written out, `eslint-disable` comments and `@ts-ignore`/`@ts-expect-error`/`@ts-nocheck`. Comments are read with TypeScript's scanner, so the same words inside a string don't count. Lint forbids non-null assertions in `server/` and `shared/` outside tests, so the ones counted are in `client/src/` and `scripts/`.
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

The [climber](../plugins/climber/README.md) plugin works from it: each climb measures the scorecard before and after its one change.


The engineering panel (<kbd>E</kbd> at Lt. Brennan's station on deck 5) has four views down its side:
- **Overview**, where it opens: one sentence on whether the gate passes and how many numbers improved or slipped since the scorecard before; a tile per section, each with the question it answers, its headline number (the gate's pass and time, type assertions, the server's share on Effect, functions over CRAP 30, QA passed first time), a line of its last ten with the latest dot green or red, and the change in words (`3 fewer`, `12s slower`); what moved, the slips first; and beside them the climber and the retro, with the most widespread open frictions. A tile, or a number that moved, opens its section; a friction opens [the ledger review](ledger.md#reviewing-it) on its trace.
- **Code**: the gate, the fence, Effect and the tests in full, the gate's time split by step. Each section says what it's for, and each number opens to say what it counts, why it matters, which way is better, and its history (hover a point for when and how much).
- **Office**: the ledger's numbers as the scorecard measured them, the same way, then the ledger as it stands now (the report card, with what the scorecard doesn't count: conflicts, triage, closed PRs, goals, spend) and the open frictions.
- **Retro**: the [chief engineer's retro](retro.md), its drafts and the fixes it led to.

A time that moves less than its 10% wobble shows as `≈`, and a change too small to show isn't counted as a climb or a slip. The explanations live in `shared/scorecardAbout.ts`, and the overview's summary in `glance` (`shared/scorecard.ts`): a number added to the scorecard should get a line there too.

**Measure now** runs `pnpm run scorecard` on the office's own checkout (the one it runs from, which auto update keeps on the latest main). It takes about a minute and a half, one measurement at a time, and the panel says when it's under way or why it failed. **Show on the MSD** puts the scorecard up on the master systems display beside the ship, as the overview has it: the same sentence on the gate and what moved, the same tile per section (its headline number, a few words, and its change in words), then what moved, the slips first. The overview and the MSD share their wording (`verdictPhrases`, `tileFace` and `changeMark` in `shared/scorecard.ts`), so they always say the same thing. It stays up until you pick a trace at the table or **Clear the MSD**. The demo office's scorecards are made up and kept in memory, so the demo never writes to `~/.focus/scorecards/`.

**After each merge.** Two minutes after it starts, the office measures the commit it runs from by itself, if that commit has no scorecard yet and the checkout has no uncommitted changes to tracked files (an untracked folder, like an editor's `.idea/`, doesn't count: the scorecard only reads tracked files) (`measureNewCommit` in `server/scorecards.ts`). [Auto update](auto-update.md) restarts the office on each merge to main, so every merge gets a scorecard, and the trend fills in without anyone pressing Measure now. The panel says when a measurement is one of these. The demo office doesn't do it.

The office reads the latest ten from `~/.focus/scorecards/` when it starts and after each measurement (`server/scorecards.ts`, which decodes each with Effect Schema and skips a file that isn't one). A scorecard saved from the terminal shows up after the next restart or measurement. The build step builds into a temporary folder, never the `dist/` the office may be serving.

## Comparing

Each number knows which way is better. The printout marks a change since the latest saved scorecard with ▲ (better) or ▼ (worse), but only when it moved further than it wobbles: past its spread in the latest [noise floor](#noise-floor), or, for a number without one, past 10% for a time and any change at all for a count.

### Noise floor

`pnpm run scorecard --repeat 5` measures the same commit 5 times (it needs no uncommitted changes) and keeps each number's lowest and highest (`noiseOf` in `shared/scorecard.ts`). The counts read from the code hold still; the times don't, and the office's numbers drift as the ledger fills. Every comparison in the terminal uses the latest saved one, and says which. Take a new one when the machine or the gate changes a lot. The panel and the MSD still use the 10% rule for times. The comparison header names the commit and branch it compares against, and a scorecard measured with uncommitted changes says so.

To show a change's before and after:

1. Run it on the base branch first.
2. Run it on the change with `--no-save`, so the base stays the latest saved one to compare against.

The rules live in `scripts/scorecardRules.ts` and, for how a scorecard reads wherever it's shown, `shared/scorecard.ts` (both pure, tested next to them). `scripts/scorecard.ts` runs the commands, reads the files and the ledger, and saves the result.
