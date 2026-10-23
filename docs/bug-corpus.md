# The bug corpus

A script of Focus's own (it runs in the terminal, never in Focus). It turns real bugs Focus's agents shipped into a benchmark with a referee that can't be argued with, so a change to how Focus decides quality (QA's prompt or model, a new gate, a review step) can be judged on bugs that actually got through, not on opinion. It is to [QA's catch rate](qa-catch.md) what real bugs are to planted ones.

`pnpm run bug-corpus` takes the fixes listed in `tools/bug-corpus/fixes.txt`, and for each one that changed a test, runs those tests on two versions of the code, in throwaway worktrees of this repo:

1. **On the code just before the fix**, with the fix's versions of its tests written over. This is the buggy code.
2. **On the fix itself.**

Each side runs three times. A test that fails on the buggy code on an assertion and passes on the fix, on every run, is a **referee** for that bug, and a fix with at least one referee is a **case**. The cases, with their referee tests, how each failed and the lines the fix took out (where the bug was), are written to `tools/bug-corpus/corpus.json`, with the other fixes and why each isn't a case. It's free (no model is called) and takes half an hour or so. `--only <sha>` checks one fix.

| | |
| --- | --- |
| `reproduces` | a case |
| `missing-code` | its tests only fail before the fix because what they call didn't exist yet (an import that isn't there): the fix moved the logic into a new function and tested that, so its test can't referee the old code |
| `passes-before` | its tests pass on the buggy code too: they don't see the bug (often a fix to a test, or a revert) |
| `fails-after` | its tests don't pass on the fix itself, in today's `node_modules` |
| `no-tests` | the fix changed no test vitest runs (most UI and drift fixes) |
| `unsteady` | a test referees the bug on some runs and not others: flaky, so not a referee |

The rules are in `server/agents/bugCorpus.ts`, tested next to it; git, the worktrees and vitest are in `tools/bugCorpus.ts`. Every worktree shares this checkout's `node_modules`.

## The list

`fixes.txt` is the 90 real defect fixes on `main` from 2026-10-04 to 10-16, read by hand from all 504 commits (keyword searches find a third of them: this repo's commit subjects say what's now true, "X no longer Y", not "fix"). Each has a kind (cases as of the run on 2026-10-16):

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

The corpus is the yardstick for Focus's quality decisions: hand the buggy code (or the change that brought the bug in, below) to a reviewer or a gate, and the referee tests say, without anyone's judgement, whether what comes back still has the bug. Every case is a bug that already got past QA, so today's process catches none of them by construction. A change that catches more of them must also be run on clean changes, so that one that sends everything back doesn't win.

- It has almost nothing for UI and drift bugs, which mostly came without a test.
- A bug whose fix moved the logic into a new function (`missing-code`) is real but has no referee here.

## Which commit brought each bug in

Each case is then traced to the commit that brought its bug in, as the SZZ method does: the commits that last wrote the lines the fix took out (`git blame`, through moves and copies), most lines first. Each suspect is tried with the case's referee tests, on it and on the commit before it, and ruled out when they say the bug was already there before it (`older`) or wasn't there yet on it (`not-buggy`). The first suspect left is the case's `introducedBy`, with where the bug's lines were in it and what the tests said:

| | |
| --- | --- |
| `introduced` | the tests fail on it and pass before it: confirmed |
| `first-testable` | the tests fail on it and can't run before it |
| `untestable` | the tests can't run on it at all |

As of that run, of the 39 cases, 29 are traced (3 confirmed by their tests) and 10 have every suspect ruled out. Six of the 29 were brought in by an earlier fix. Confirming more is rarely possible: a test written with a fix leans on code from that day, so on older code it can't run at all, and a `git bisect` with it (tried, and dropped) only finds the first commit it can run on. Blame's suspects are the standard stand-in, with its known noise: a commit that moved or reformatted the lines can take the blame for them.

## Replaying QA

`pnpm run bug-replay` runs the QA officer's own review (its system prompt, prompt, report schema, model and Claude Code settings, as [QA's catch rate](qa-catch.md) does) on each commit a traced bug came from, as a pull request against the commit before it, in a throwaway clone of this repo. Each of these commits got past QA once, so it says how many of them today's QA, or a change to it, would stop, and for the right reason. Each bug is scored:

- **caught**: the review stopped the change, and a **judge** (a different model from QA's, `claude-opus-5-5`, holding the fix's own diff as the answer key) says one of its findings is the very bug the fix fixed: the same wrong outcome from the same cause, not the same file or a vague worry. The judge was checked both ways before use, and each run keeps the whole report so its calls can be checked by hand.
- **stopped for another bug**: the review stopped the change for something else.
- **missed**: it let the change through.

Whether the report merely named the bug's file is kept beside it: in the first baseline, all three such "catches" were other bugs in the same files.

It replays Focus's QA as it is, which since the results below blocks a change only with proof ([QA → Proof](qa.md#proof)): `tools/qaReview.ts` checks the report's proofs in the clone the way Ops checks them in its checkout (`prove` in `server/agents/qaProof.ts`), so a review stops a change when its checked verdict is a fail, and a fail without a proof that held counts as passed. Runs are saved with the arm `proof`. The two arms below were the experiment it came from, run before that, and the replay no longer runs them:

- **`qa`**: QA as it was, stopping a change on its own say-so.
- **`hunt`**: that QA with the hunting guidance after its instructions (the corpus's kinds of bug, probed with tests that drive those paths rather than read for them) and every finding proved by a `*.proof.test.ts` the replay ran itself, stopping a change only when one failed on an assertion. Its guidance, made general for other repos and test runners, is now QA's (`hunting:` in `.focus/crew/qa.md`).

| | |
| --- | --- |
| `pnpm run bug-replay` | every commit a traced bug came from (except the repo's first, which has nothing before it to review against), a few reviews at a time |
| `pnpm run bug-replay --commits 3` | the first few |
| `pnpm run bug-replay --control` | as many controls: commits that landed a pull request changing Focus's code, that no listed bug came from and no listed fix made, spread over the same stretch of history. QA failing one is most likely a false alarm |
| `pnpm run bug-replay --dry` | what it would review, without reviewing |
| `pnpm run bug-replay --only <sha>` | one commit a bug came from |

A review costs what one in Focus does (as of 2026-10, about $0.60 and a few minutes): a full run with controls was about $30 and a few hours. Runs are saved in `~/.focus/bug-replay/`. The rules are in `server/agents/bugReplay.ts`, the clones and sessions in `tools/bugReplay.ts`, and QA's review session, shared with `qa-catch`, in `tools/qaReview.ts`.

The clones are old builds, whose instructions say to run Focus (`npm run demo`, `pnpm dev`) on the live Focus's port and data folder, 4477 and `~/.focus`. So each review's session runs with a free port and a data folder inside its clone (`PORT`, `FOCUS_DATA_DIR`, `reviewEnv` in `tools/replayRules.ts`), and when it ends, whatever is still running in the clone is stopped (`stopLeftovers`): a demo QA started in the background outlives the session otherwise. Both apply to `qa-catch` too.

### Results so far (2026-10-17, 26 bugs in 24 commits, 24 controls, before QA blocked only with proof)

| arm | caught (judge) | stopped for another bug | controls stopped | cost |
| --- | ---: | ---: | ---: | ---: |
| `qa` | 0 | 3 | 0 | $37 |
| `hunt` | 2 | 6 | 3 | $36 |

Every change the hunting review stopped came with a failing proof test. One of its three "stopped controls", 7ca08cb, was stopped for two asks at once losing their pages: the very bug fixed later in bd279e4, which tracing had put on another commit. So it caught three known bugs, not two, and the other controls it stopped were for proven bugs too (an inverted byte range answered with an empty 206, a terminal line drawn indented).

Review, even with proof, rarely catches the restart and race bugs. Checking them by running the code does: see [Focus's two rules for state](invariants.md), which catch 4 of 4 of these bugs put back into today's code.

What it can't tell: a control can hold a bug nobody has listed (as above), so "controls stopped" is an upper bound on false alarms, and each needs reading; tracing can blame the wrong commit; and the replay has no browser, as with `qa-catch`.
