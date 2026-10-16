# The bug corpus

A script of the office's own (it runs in the terminal, never in the office). It turns real bugs the office's agents shipped into a benchmark with a referee that can't be argued with, so a change to how the office decides quality (QA's prompt or model, a new gate, a review step) can be judged on bugs that actually got through, not on opinion. It is to [QA's catch rate](qa-catch.md) what real bugs are to planted ones.

`pnpm run bug-corpus` takes the fixes listed in `scripts/bug-corpus/fixes.txt`, and for each one that changed a test, runs those tests on two versions of the code, in throwaway worktrees of this repo:

1. **On the code just before the fix**, with the fix's versions of its tests written over. This is the buggy code.
2. **On the fix itself.**

Each side runs three times. A test that fails on the buggy code on an assertion and passes on the fix, on every run, is a **referee** for that bug, and a fix with at least one referee is a **case**. The cases, with their referee tests, how each failed and the lines the fix took out (where the bug was), are written to `scripts/bug-corpus/corpus.json`, with the other fixes and why each isn't a case. It's free (no model is called) and takes a quarter of an hour or so. `--only <sha>` checks one fix.

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

The corpus is the yardstick for the office's quality decisions: hand the buggy code (or the change that brought the bug in) to a reviewer or a gate, and the referee tests say, without anyone's judgement, whether what comes back still has the bug. Every case is a bug that already got past QA, so today's process catches none of them by construction. A change that catches more of them must also be run on clean changes, so that one that sends everything back doesn't win.

- It has almost nothing for UI and drift bugs, which mostly came without a test.
- A bug whose fix moved the logic into a new function (`missing-code`) is real but has no referee here.
- A case says the bug is in the code before the fix, not which commit brought it in.
