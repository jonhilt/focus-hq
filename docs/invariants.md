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
| a goal's lead (held for the plan's limit, its run, its inbox: messages into a turn, notes waiting for it to end, none lost) | `server/agents/managerInvariants.test.ts` | restart |
| a goal lead's slices (shipped, landed, moved on to fresh code, the lead told it landed) | `server/agents/sliceInvariants.test.ts` | both |
| the cartography plugin's kept diagrams | `plugins/cartography/invariants.test.ts` | both |
| the retro plugin's chief engineer's decisions | `plugins/retro/invariants.test.ts` | both |
| QA reviews (asked for, failed, passed, posted on the pull request) | `server/agents/reviewInvariants.test.ts` | both |
| a Claude Code session (`ClaudeRunner`, on a stand-in for Claude Code at the SDK's `query`: listening on past its turn while a command or workflow it left runs, what they report taken in a turn that can still ask the office, done once nothing's left) | `server/agents/claudeRunnerInvariants.test.ts` | at once |
| a goal's life to its close (what its lead showed and asked, the captain's answers on screen and in chat, its pull requests, work left uncommitted, closed and reopened) | `server/agents/goalInvariants.test.ts` | both |

The session isn't held to the rule for a restart: it keeps nothing of its own across one. The office stops every session as it goes down, Claude Code's process goes and what it left running in the background with it (a probe that never reported is marked as lost contact), and what the lead was told is the lead's inbox, held in its own check above. Its description asks Claude Code everything down the pipe (reading a message, counting its context, stopping a command), and compares whether the office is listening only between turns, for the race found on main below.

`server/agents/invariants.test.ts` holds the harness itself to them, on two toys with each kind of flaw planted on purpose: a half-done mark left by a restart, two at once doing what one after the other would refuse, a queue a restart forgets (seen only in what should have followed), and a post sent again after it went up as the office went down.

## Does it catch real bugs?

Six of the corpus's lifecycle and race bugs still reverse cleanly onto today's code. Each was put back by reversing its fix, and its own test fails again; two more, in the session, were ported by hand. The parts above were described before any bug was put back, and they pass on today's code. With the bug back:

| bug | kind | caught by | what the check said |
| --- | --- | --- | --- |
| 185513c | lifecycle | restart | the lead isn't held for the plan's limit after a restart, and is idle |
| 0f97b94 | lifecycle | restart | a diagram left "being drawn again" after a restart mid-redraw |
| e8d930f | race | at once | "forget" during a redraw undone: the diagram comes back |
| 740f2d8 | race | at once | accepting and rejecting a draft at once files an issue for a rejected draft |
| eab2be2 | race | missed | nothing: the description's Claude Code always lists a running workflow among its background tasks, and the bug needs a list that leaves it out |
| f8cae72 | lifecycle | (neither rule: QA re-testing at the base's merge is a behaviour, not a state) | |
| dde309b | race | neither rule; the session's reach tests | the session stops listening as its turn ends with a command and a workflow still running |
| 879f9ec | race | neither rule; the session's reach test | the session stops listening the moment its last background task ends, not waiting for a turn to take it (in the stand-in, Claude Code's turn for a report starts before the office reads the task ended, so the cancelled tool itself doesn't show) |

The session was described before any of its three bugs was put back. eab2be2 reverses cleanly (back to Claude Code's list alone, leaving out the workflows the office saw start); the other two came before `Listening` and were ported by hand: dde309b closes the input as a turn ends whatever runs in the background, 879f9ec closes it as the last background task ends. None was caught by the rule, in 40 runs or in 800 (`FOCUS_INVARIANT_RUNS=20`): taken one at a time they go just as wrong, and a rule that compares two at once with one after the other can't see a wrong that's the same either way. The description's plain reach tests caught dde309b and 879f9ec, as they would any deterministic break; eab2be2 is beyond the stand-in. What the rule did catch in this part is a race of its own on main (below).

So the rules caught 4 of the 4 bugs in the parts described before the session, and none of the session's three: two of those are wrong one at a time too (their plain reach tests catch them), and the third needs a Claude Code that behaves in a way the stand-in doesn't. The four were each caught with the same outcome as the original bug, though not always the same path (740f2d8 was fixed for two accepts at once, and the check found it through an accept and a reject). Of the four, the replay had the commit behind 185513c to review, and QA missed it both as it is and when hunting with proof.

### A goal's life to its close

The goal's description was written from `docs/goals.md` (closing keeps what the lead showed and asked, every slice's pull requests, and uncommitted work as a WIP snapshot) before any of these four fixes was looked at. Its `durable()` is where the goal is (at its station, in the room's log, in the ledger's archive), its artifacts and questions with how each was answered, its pull requests and GitHub's, the pages of what it has that the office lost, and the lead's work and where it's kept (uncommitted, or committed on a branch). Its reach test takes a goal through a show, a question answered in chat, another picked, a ship, work left uncommitted, a close and a reopen. Deliberate breaks it caught: a restart's close never finished (restart), a question asked as the goal closes deleting the filed question's pages (at once), a close while the lead ships (at once). Each bug was put back by hand, as the code has moved since:

| bug | what it was | the two rules | the reach test | what it said |
| --- | --- | --- | --- | --- |
| 720822e | a closed goal dropped what its lead showed and asked, pages and all | missed | caught | the closed goal had no artifacts or questions |
| 1785db5 | closing threw uncommitted work away (no WIP snapshot); a ship could start mid-close | caught, restart, only in the soak (`FOCUS_INVARIANT_RUNS=20`) | caught | a restart during the close left the work uncommitted in a checkout a finished close would have removed; the ship guard alone: missed, soak too |
| 5d74f45 | a goal's pages deleted once it dropped off the end of the room's log | missed | missed | the description has one goal, which never drops off a 30-goal log |
| 6fdfdef | a chat reply didn't settle the open question; a pick wrote back the goal as it was before the message | missed | caught | the question stayed open after the captain answered in chat |

So 1 of 4 by the rules, and that one only in the long soak, by a side effect (the close not atomic) rather than the loss itself; the reach test caught 3. These were mostly bugs of what a close does, not of a restart or two things at once: the rules compare a run with the same code taken one action at a time, so a behaviour that's wrong every time (work thrown away, pages dropped) is wrong in the reference too, and only a plain test of what should happen sees it. The ship guard of 1785db5 is a race the harness can't start: it starts both actions together, and a ship that starts only once a close is part way through its snapshots needs one action to begin after another's first deferred step. Where the rules did earn their keep here was on main, below.

## Found on main

**A message sent as the turn ends gets a turn the office has stopped listening to** (not fixed). The session's check for two at once found it (a message and the turn ending at once), and `claudeRunnerInvariants.test.ts` holds it in a plain test, `it.fails` until it's fixed. When the captain's message goes into the session just as Claude Code ends its turn, the turn's result says nothing's queued (the message is still on its way), so the office closes the session's input; Claude Code takes the message in a turn of its own anyway. The message isn't lost, but nobody's listening to that turn: a message sent during it waits for the next turn, **Stop** on a probe can't reach it, and anything it leaves running in the background reports to a turn whose tools Claude Code cancels ("The user doesn't want to take this action right now"), the very thing `Listening` is there to prevent. The window is short (between Claude Code ending its turn and the office reading the result, which includes asking Claude Code how full its context is).

**A verdict posted twice** (fixed). `docs/qa.md` already said this could happen, as the price of never losing a verdict; the check made it a failing test, and the fix keeps both. If the office went down just after GitHub took QA's comment and before it recorded that it did, the restart posted the same verdict on the pull request again: the review journal said "reported, posting", and the office had no way to read a pull request's comments back. The review check found it, and `reviewRecovery.test.ts` held it in a plain test. Now each verdict's comment ends with a hidden mark of its own (`verdictMark`: that one verdict's, not the pull request's, as a re-review posts another verdict on the same one), and a restart looks for it among the pull request's comments (`GitHub.pullRequestComments`) before posting again. If GitHub can't say, it posts: twice beats never.

**A pull request that merges while the lead ships is put back as open** (fixed). A ship worked from the slice's pull requests as they were when it started, so one the captain merged while the ship was pushing was "updated" after it merged: the ship's `pr` fact put it back in the slice journal with no outcome, and what was pushed onto its merged branch never reached review. The slices' check for two at once found it (a ship and a merge at once); `sliceRecovery.test.ts` held it in a plain test. Now the ship looks at the lead's pull requests again once each push is done (`afterPush` in `lead.ts`): one that merged or closed meanwhile records no `pr` fact, so it stays landed, and the commits pushed onto it count as unshipped (its shipped commit is still the one before), carried onto a fresh branch at the next ship or onto the next slice, as any unshipped commits are. A ship that ends with every pull request landed lands the slice in the journal too. Both checks now run with merges during a ship: the focused one, from a shipped slice with only ships and merges on offer, and the fuller check for two at once.

**A slice that landed mid-turn moves on a turn early after a restart.** The office moves a landed slice's repos to fresh code at the start of the lead's next turn, and a restart starts one (the resumed turn), so after a restart the slice has moved where, without one, it would still be waiting. Nothing is half-done and nothing is lost (commits are carried over), so it's by design rather than a bug, but it's not what the rule for a restart allows: the slices' restart check leaves out merging a slice's last pull request while the lead's turn is under way.

**A goal closed while its lead was shipping lost the ship's pull requests** (fixed). The goal's check for two things at once (a ship and a close at once) found it: the close filed the goal with the pull requests it had then, and the ship went on to open its pull requests on GitHub for a goal that had gone, so the closed goal (and a reopened one) never knew of them. Now a close refuses while the slice journal says the slice is shipping, and one that starts during a close is refused, as before (`closingGoals`). `manager.test.ts` holds it in a plain test.

**A question asked as its goal closed deleted the filed question's pages** (fixed). Asking replaces an open question, deleting its option pages, once the pictures are taken. When the goal closed meanwhile, the check for that (`agent.lead` still set on the dismissed agent) never fired: the open question went into the room's log and its pages were deleted after. Show had the same gap for an artifact's picture. Both now look for the lead in the office (`store.agents`), and `manager.test.ts` holds the question in a plain test.

**A restart part way through a close left the goal open with its work committed as a WIP snapshot** (fixed). Found by the goal's restart check in a soak: the snapshot is in, the goal isn't filed, and after the restart the lead picks the goal up and ships the WIP snapshot, which `closingGoals` was there to prevent (and which a restart forgets). Now the close is marked on the lead before any snapshot (`closeStarted`), and a restart finishes it (`Leads.recoverCloses`) before the lead's run would pick back up; one that fails then leaves the goal open and the lead's run recovers. `manager.test.ts` holds it in a plain test.

## What it can't tell

- Only parts somebody describes are checked, and only as far as `durable()` says what must survive: a field left out is a field it can't see go wrong.
- A part whose async work doesn't go through `later` can't be interleaved inside that work, only between actions.
- It compares a run with the same code taken one action at a time, so a behaviour that's wrong every time (a close that throws work away) is wrong in the reference too: only a plain test of what should happen, like a description's reach test, sees it.
- The two actions under a check for two at once start together: a race where one starts only once the other is part way through (a ship once a close is into its snapshots) is out of its reach.
- Like any test, it says the rules hold for the sequences it tried (25 by default), not for all of them.

A third rule, for the bugs that came from wrong assumptions about git, GitHub and the SDK rather than from state: [the fakes the tests rely on must behave like the real thing](contracts.md).
