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

fast-check picks a few actions to reach a state, then the action under test, and its scheduler picks when each piece of deferred work finishes, so a restart can fall before an action starts, after it starts, or between any two of its steps, and two actions can interleave any way. It checks the state right after the restart, then takes a few more actions and checks again: a half-done state the next action happens to clear is still half-done, and a restart that loses work (a queued review never started again) can look the same until something should have followed on. Cuts favour where restarts break things (between actions, just after one starts, after its first deferred step). The reference states (never started, finished, one then the other, each followed by the same actions) come from running the same actions one at a time on a fresh part. A failure says what it did, what it settled to and what it should have been, and prints fast-check's seed and path; `path` in the options replays that one run alone. Runs are seeded from `FOCUS_TEST_SEED`, as every test is. The interleavings that break a part are rare draws, so 25 runs (the default) can miss one: `FOCUS_INVARIANT_RUNS=20 pnpm test invariants` multiplies every check's runs for a longer soak.

What a part hands to `later` is what it asks of the world outside: a model's answer, a comment on GitHub, a checkout, a push. When the office goes down with one of those under way, what becomes of it is settled as it goes down: it lands out there (the comment still goes up) or it's lost on the way, and either way the office never hears back. The landed one is the case a restart most often gets wrong, and the harness tries both. Hand every slow outside step to `later`, including ones the demo makes slow on purpose (the demo workspace sleeps to look real): left as real timers, the part looks settled before it's done.

**Describe a part so it can fail.** A description that never reaches the part's interesting states passes both rules and proves nothing. QA reviews' first description did exactly that: it never got a review past the queue, because its `settle` gave up before QA's seat started. Give each description a plain test that it reaches them (as `reviewInvariants.test.ts` does), and before trusting a pass, break the part on purpose and see the check fail.

## Where it's held so far

| part | test | rules |
| --- | --- | --- |
| a goal's lead (held for the plan's limit, its run) | `server/agents/managerInvariants.test.ts` | restart |
| the cartography plugin's kept diagrams | `plugins/cartography/invariants.test.ts` | both |
| the retro plugin's chief engineer's decisions | `plugins/retro/invariants.test.ts` | both |
| QA reviews (asked for, failed, passed, posted on the pull request) | `server/agents/reviewInvariants.test.ts` | both |

`server/agents/invariants.test.ts` holds the harness itself to them, on two toys with each kind of flaw planted on purpose: a half-done mark left by a restart, two at once doing what one after the other would refuse, a queue a restart forgets (seen only in what should have followed), and a post sent again after it went up as the office went down.

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

## Found on main

**A verdict posted twice** (fixed). `docs/qa.md` already said this could happen, as the price of never losing a verdict; the check made it a failing test, and the fix keeps both. If the office went down just after GitHub took QA's comment and before it recorded that it did, the restart posted the same verdict on the pull request again: the review journal said "reported, posting", and the office had no way to read a pull request's comments back. The review check found it, and `reviewRecovery.test.ts` held it in a plain test. Now each verdict's comment ends with a hidden mark of its own (`verdictMark`: that one verdict's, not the pull request's, as a re-review posts another verdict on the same one), and a restart looks for it among the pull request's comments (`GitHub.pullRequestComments`) before posting again. If GitHub can't say, it posts: twice beats never.

## What it can't tell

- Only parts somebody describes are checked, and only as far as `durable()` says what must survive: a field left out is a field it can't see go wrong.
- A part whose async work doesn't go through `later` can't be interleaved inside that work, only between actions.
- Like any test, it says the rules hold for the sequences it tried (25 by default), not for all of them.
