# The office's two rules for state

Most of the lifecycle and race bugs that got past review here broke one of two rules: about 13 of the [bug corpus](bug-corpus.md)'s 18, going by what their own tests check. Neither rule is about how code reads, and review rarely catches them: in the [replay](bug-corpus.md#replaying-qa), QA caught none of these kinds of bug, and the hunting review none of the restart ones. They're about what happens when the code runs through a restart, or two things at once:

- **A restart is atomic.** Stop the office in the middle of anything (or between things) and start it again on what it kept: it settles to what it would have been had that action never started, or had it finished. Never a half-done third thing, like a diagram left "being drawn again" or a hold the shutdown let go.
- **At once is one after the other.** Two actions at once end as one then the other would have, in either order. An action that refused (threw) counts as never taken; one that said it was done must have taken effect. Never both taking effect where the second would refuse (an issue filed for a draft rejected at the same moment), and never one undoing the other's result (a forgotten diagram coming back).

`checkRestart` and `checkAtOnce` (`server/agents/invariants.ts`, lent to plugins' tests by `plugin-api/testing.ts`) check them by running a part, not by reading it. A part describes itself as a `Subject`, and nothing in it says what to expect:

| | |
| --- | --- |
| `start(later)` | a fresh one, handing its own async work (a model answering, GitHub, a write) to `later` |
| `actions()` | what it can be asked to do, or what can happen to it, now: each a name and a `run` |
| `durable()` | what of it must survive, as plain data, compared by value |
| `settle()` | until nothing it started is still going |
| `restart(later)` | the office going down and starting again on what it kept |
| `close()` | puts it away once checked, so runs don't hear each other |

fast-check picks a few actions to reach a state, then the action under test, and its scheduler picks when each piece of deferred work finishes, so a restart can fall before an action starts, after it starts, or between any two of its steps, and two actions can interleave any way. The reference states (never started, finished, one then the other) come from running the same actions one at a time on a fresh part. A failure says what it did, what it settled to and what it should have been, and prints fast-check's seed and path; `path` in the options replays that one run alone. Runs are seeded from `FOCUS_TEST_SEED`, as every test is.

## Where it's held so far

| part | test | rules |
| --- | --- | --- |
| a goal's lead (held for the plan's limit, its run) | `server/agents/managerInvariants.test.ts` | restart |
| the cartography plugin's kept diagrams | `plugins/cartography/invariants.test.ts` | both |
| the retro plugin's chief engineer's decisions | `plugins/retro/invariants.test.ts` | both |

`server/agents/invariants.test.ts` holds the harness itself to them, on a toy with each kind of flaw planted on purpose.

## Does it catch real bugs?

Six of the corpus's lifecycle and race bugs still reverse cleanly onto today's code. Each was put back by reversing its fix, and its own test fails again. The parts above were described before any bug was put back, and they pass on today's code. With the bug back:

| bug | kind | caught by | what the check said |
| --- | --- | --- | --- |
| 185513c | lifecycle | restart | the lead isn't held for the plan's limit after a restart, and is idle |
| 0f97b94 | lifecycle | restart | a diagram left "being drawn again" after a restart mid-redraw |
| e8d930f | race | at once | "forget" during a redraw undone: the diagram comes back |
| 740f2d8 | race | at once | accepting and rejecting a draft at once files an issue for a rejected draft |
| eab2be2 | race | (no part described) | |
| f8cae72 | lifecycle | (neither rule: QA re-testing at the base's merge is a behaviour, not a state) | |

So 4 of the 4 bugs in parts it describes, each with the same outcome as the original bug, though not always the same path (740f2d8 was fixed for two accepts at once, and the check found it through an accept and a reject). Of the four, the replay had the commit behind 185513c to review, and QA missed it both as it is and when hunting with proof.

## What it can't tell

- Only parts somebody describes are checked, and only as far as `durable()` says what must survive: a field left out is a field it can't see go wrong.
- A part whose async work doesn't go through `later` can't be interleaved inside that work, only between actions.
- Like any test, it says the rules hold for the sequences it tried (25 by default), not for all of them.
