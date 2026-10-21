# The scorecard

A plugin (`FOCUS_PLUGINS=scorecard`, [plugins](../../docs/plugins.md)). `pnpm run scorecard` and `pnpm run crap` work in the terminal either way; the plugin puts the scorecards in main engineering.

`pnpm run scorecard` measures Focus against its own standard and keeps each result, so you can see whether the code and Ops are getting better or worse over time. Every number comes from a command it runs or a syntax tree it walks, never from reading code by eye. It's the first step of a hill-climb (after [ratstack's hill-climb prompt](https://ratstack.sh/prompts/hill-climb)): measure, take the worst gap, fix it, and prove the fix with the same numbers before and after.

It always exits 0: it measures, it doesn't judge. It only exits non-zero when it couldn't measure at all.

| | |
| --- | --- |
| `pnpm run scorecard` | measures, saves the result in `~/.focus/plugins/scorecard/`, and prints it next to the latest saved one |
| `pnpm run scorecard --no-save` | measures and compares, without saving (on a branch you're still working on, say) |
| `pnpm run scorecard --json` | prints the scorecard as JSON |
| `pnpm run scorecard --repeat 5` | measures 5 times on this commit and saves how far each number wobbles, its [noise floor](#noise-floor), in `~/.focus/plugins/scorecard/noise/` (with `--no-save`, only prints it) |

## What it measures

- **Gate:** whether `typecheck`, `lint`, the unit tests and `build` all pass, and how long each takes. The tests run once, with coverage, and the CRAP numbers come from that same run. A failing test prints the command that runs it again on the same seed, so a red gate says what to look at instead of being put down to load.
- **Fence:** type assertions, non-null assertions, `any` written out, and comments that switch a check off, tests left out.
- **Effect:** in `server/`, the share of the files doing I/O that are on Effect, and the edges where Effect hands over to Promise code. A file that only decides counts neither way: those are meant to stay plain. See the [Effect assessment](../../docs/effect-assessment.md) for the migration path.
- **Tests:** how many tests there are, how many test files use property tests, and how many functions score over [CRAP](crap.md) 30.
- **Ops:** from [the ledger](../../docs/ledger.md): the report card's numbers and the open friction patterns.

The [climber](../climber/README.md) plugin works from it: each climb measures the scorecard before and after its one change. With the plugin on, Focus measures each merge to main by itself, so the trend fills in without anyone running it. The build step builds into a temporary folder, never the `dist/` Focus may be serving.

## Comparing

Each number knows which way is better. The printout marks a change since the latest saved scorecard with ▲ (better) or ▼ (worse), but only when it moved further than it wobbles: past its spread in the latest [noise floor](#noise-floor), or, for a number without one, past 10% for a time and any change at all for a count.

### Noise floor

`pnpm run scorecard --repeat 5` measures the same commit 5 times (it needs no uncommitted changes) and keeps each number's lowest and highest (`noiseOf` in `scorecard.ts`). The counts read from the code hold still; the times don't, and Ops' numbers drift as the ledger fills. Every comparison in the terminal uses the latest saved one, and says which. Take a new one when the machine or the gate changes a lot. The panel and the MSD still use the 10% rule for times. The comparison header names the commit and branch it compares against, and a scorecard measured with uncommitted changes says so.

To show a change's before and after:

1. Run it on the base branch first.
2. Run it on the change with `--no-save`, so the base stays the latest saved one to compare against.

## The ratchets

The scorecard only measures; the ratchets hold the line. Two numbers may only go down, file by file: each file's type assertions (counted the way the fence counts them) and its functions over CRAP 30 (as `pnpm run crap` scores them). A baseline committed here holds each file's count, `fence-baseline.json` and `crap-baseline.json`, and the check fails

- a file above its count, a new file with any at all among them. Narrow a cast instead (a type guard, `in`/`typeof`, an Effect Schema decode, a type that says what the value is); move a complex function's decisions into small pure functions with tests, or test it. Don't raise the baseline to pass;
- a file below its count: lower the baseline and commit it, so the gain can't be spent again.

A third only goes up: how much of each file that keeps state the [state rules](../../docs/invariants.md#describing-a-part)' checks reach (`rules-baseline.json`, whole percent of its lines). It fails a file reached less than its count, and a new file that keeps state with none of it reached: describe the part instead.

| | checked by | a gain locked in by |
| --- | --- | --- |
| type assertions | a test in the gate (`fenceRatchet.test.ts`), so `pnpm test` | `pnpm run fence:lower` |
| the state rules' reach of each file that keeps state (only goes up) | `pnpm run rules --ratchet` (a coverage run of the descriptions' checks alone, on seed 1), before an agent finishes and in QA's review | `pnpm run rules --raise` |
| functions over CRAP 30 | `pnpm run crap --ratchet` (it needs a coverage run, which `pnpm test` doesn't do), before an agent finishes and in QA's review | `pnpm run crap --lower` |

It counts per file, so a gain in one file can't pay for a loss in another, and two pull requests only meet in a baseline when they change the same file's count. The lowering commands only ever lower a count; raising one is a hand edit that shows in the diff. A function's CRAP is counted per file, not per function, since names repeat (two `(callback to Effect.gen)` in one file) and lines move; so a function that gets worse but was already over 30 isn't caught, nor is one that goes over while another in its file comes under. The count over 30 held still across test seeds, so the CRAP ratchet doesn't flake on coverage.

Renaming or moving a file carries no count across: its old line drops to 0 and its new path counts as new, so move its line in the baseline by hand. The rules are in `scripts/fenceRatchet.ts` (pure, tested beside it), the I/O in `scripts/fenceFiles.ts` and `scripts/crap.ts`.
