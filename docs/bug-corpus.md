# The bug corpus

A script of the office's own (it runs in the terminal, never in the office). It turns real bugs the office's agents shipped into a benchmark with a referee that can't be argued with, so a change to how the office decides quality (QA's prompt or model, a new gate, a review step) can be judged on bugs that actually got through, not on opinion. It is to [QA's catch rate](qa-catch.md) what real bugs are to planted ones.

`pnpm run bug-corpus` takes the fixes listed in `scripts/bug-corpus/fixes.txt`, and for each one that changed a test, runs those tests on two versions of the code, in throwaway worktrees of this repo:

1. **On the code just before the fix**, with the fix's versions of its tests written over. This is the buggy code.
2. **On the fix itself.**

Each side runs three times. A test that fails on the buggy code on an assertion and passes on the fix, on every run, is a **referee** for that bug, and a fix with at least one referee is a **case**. The cases, with their referee tests, how each failed and the lines the fix took out (where the bug was), are written to `scripts/bug-corpus/corpus.json`, with the other fixes and why each isn't a case. It's free (no model is called) and takes half an hour or so. `--only <sha>` checks one fix.

| | |
| --- | --- |
| `reproduces` | a case |
| `missing-code` | its tests only fail before the fix because what they call didn't exist yet (an import that isn't there): the fix moved the logic into a new function and tested that, so its test can't referee the old code |
| `passes-before` | its tests pass on the buggy code too: they don't see the bug (often a fix to a test, or a revert) |
| `fails-after` | its tests don't pass on the fix itself, in today's `node_modules` |
| `no-tests` | the fix changed no test vitest runs (most UI and drift fixes) |
| `unsteady` | a test referees the bug on some runs and not others: flaky, so not a referee |

The rules are in `server/agents/bugCorpus.ts`, tested next to it; git, the worktrees and vitest are in `scripts/bugCorpus.ts`. Every worktree shares this checkout's `node_modules`.

## The list

`fixes.txt` is the 90 real defect fixes on `main` from 2026-10-04 to 10-16, read by hand from all 504 commits (keyword searches find a third of them: this repo's commit subjects say what's now true, "X no longer Y", not "fix"). Each has a kind:

| kind | | fixes | cases |
| --- | --- | ---: | ---: |
| `ui` | layout and 3D | 24 | 2 |
| `lifecycle` | state that broke across a restart, shutdown, close or slice move | 15 | 10 |
| `external` | a wrong assumption about git, GitHub, the SDK or the shell | 12 | 7 |
| `race` | two things at once | 10 | 8 |
| `drift` | merges and duplication undoing each other | 9 | 1 |
| `flaky` | the fix was to a test | 8 | 2 |
| `boundary` | an edge-case input | 6 | 6 |
| `typehole` | a cast or a missing check let a wrong type through | 3 | 1 |
| `spec` | behaviour reversed | 3 | 2 |

39 cases in all. Add a fix to the list as one lands, and run the script again.

## What it's for, and what it can't tell

The corpus is the yardstick for the office's quality decisions: hand the buggy code (or the change that brought the bug in, below) to a reviewer or a gate, and the referee tests say, without anyone's judgement, whether what comes back still has the bug. Every case is a bug that already got past QA, so today's process catches none of them by construction. A change that catches more of them must also be run on clean changes, so that one that sends everything back doesn't win.

- It has almost nothing for UI and drift bugs, which mostly came without a test.
- A bug whose fix moved the logic into a new function (`missing-code`) is real but has no referee here.

## Which commit brought each bug in

Each case is then traced to the commit that brought its bug in, as the SZZ method does: the commits that last wrote the lines the fix took out (`git blame`, through moves and copies), most lines first. Each suspect is tried with the case's referee tests, on it and on the commit before it, and ruled out when they say the bug was already there before it (`older`) or wasn't there yet on it (`not-buggy`). The first suspect left is the case's `introducedBy`, with where the bug's lines were in it and what the tests said:

| | |
| --- | --- |
| `introduced` | the tests fail on it and pass before it: confirmed |
| `first-testable` | the tests fail on it and can't run before it |
| `untestable` | the tests can't run on it at all |

Of the 39 cases, 29 are traced (3 confirmed by their tests) and 10 have every suspect ruled out. Six of the 29 were brought in by an earlier fix. Confirming more is rarely possible: a test written with a fix leans on code from that day, so on older code it can't run at all, and a `git bisect` with it (tried, and dropped) only finds the first commit it can run on. Blame's suspects are the standard stand-in, with its known noise: a commit that moved or reformatted the lines can take the blame for them.

## Replaying QA

`pnpm run bug-replay` runs the QA officer's own review (its system prompt, prompt, report schema, model and Claude Code settings, as [QA's catch rate](qa-catch.md) does) on each commit a traced bug came from, as a pull request against the commit before it, in a throwaway clone of this repo, and scores each bug: **caught** when QA failed the change and its report points at the bug (one of its files by name in a failed check or the fix instructions, or a spot-check within 5 lines of one of its lines), **failed for something else**, or **missed**. Each of these commits got past QA once, so it says how many of them today's QA, or a change to it, would stop.

| | |
| --- | --- |
| `pnpm run bug-replay` | every commit a traced bug came from (24 for 26 bugs: the repo's first commit has nothing before it to review against), two reviews at a time |
| `pnpm run bug-replay --commits 3` | the first few |
| `pnpm run bug-replay --control` | as many controls: commits that landed a pull request changing the office's code, that no listed bug came from and no listed fix made, spread over the same stretch of history. QA failing one is most likely a false alarm |
| `pnpm run bug-replay --dry` | what it would review, without reviewing |

A review costs what one in the office does, about $0.60 and a few minutes: a full run with controls is 48 reviews, about $30 and a few hours. Runs are saved in `~/.focus/bug-replay/`. The rules are in `server/agents/bugReplay.ts`, the clones and sessions in `scripts/bugReplay.ts`, and QA's review session, shared with `qa-catch`, in `scripts/qaReview.ts`.

What it can't tell: pointing at the bug's file isn't proof QA understood the bug (the referee tests can't run on most of these commits, so only the report says what QA saw); a control can hold a bug nobody has found yet; and the replay has no browser, as with `qa-catch`.
