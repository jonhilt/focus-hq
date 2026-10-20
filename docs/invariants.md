# The office's two rules for state

Most of the lifecycle and race bugs that got past review here broke one of two rules: about 13 of the [bug corpus](bug-corpus.md)'s 18, going by what their own tests check. Neither rule is about how code reads, and review rarely catches them: in the [replay](bug-corpus.md#replaying-qa), QA caught none of these kinds of bug, and the hunting review none of the restart ones. They're about what happens when the code runs through a restart, or two things at once:

- **A restart is atomic.** Stop the office in the middle of anything (or between things) and start it again on what it kept: it settles to what it would have been had that action never started, or had it finished. Never a half-done third thing, like a diagram left "being drawn again" or a hold the shutdown let go.
- **At once is one after the other.** Two actions at once end as one then the other would have, in either order. An action that refused (threw) counts as never taken; one that said it was done must have taken effect. Never both taking effect where the second would refuse (an issue filed for a draft rejected at the same moment), and never one undoing the other's result (a forgotten diagram coming back).

`checkRestart` and `checkAtOnce` (`server/agents/invariants.ts`, lent to plugins' tests by `plugin-api/testing.ts`) check them by running a part, not by reading it, and nothing in a part's description says what to expect: the reference states come from running the same actions one at a time on a fresh part. After a restart they take a few more actions and check again, because a half-done state the next action happens to clear is still half-done, and a restart that loses work (a queued review never started again) can look the same until something should have followed on.

A failure prints fast-check's seed and path; `path` in the options replays that one run alone, and runs are seeded from `FOCUS_TEST_SEED`, as every test is. The interleavings that break a part are rare draws, so the default runs can miss one: `FOCUS_INVARIANT_RUNS=20 pnpm test invariants` multiplies every check's runs for a longer soak.

What a part hands to `later` is what it asks of the world outside: a model's answer, a comment on GitHub, a push. When the office goes down with one under way, it either lands out there or is lost on the way, and either way the office never hears back. The landed one is the case a restart most often gets wrong, and the harness tries both. Hand every slow outside step to `later`, including ones the demo makes slow on purpose: left as real timers, the part looks settled before it's done.

**Describe a part so it can fail.** A description that never reaches the part's interesting states passes both rules and proves nothing. QA reviews' first description did exactly that: it never got a review past the queue, because its `settle` gave up before QA's seat started. Give each description a plain test that it reaches them (as `reviewInvariants.test.ts` does), and before trusting a pass, break the part on purpose and see the check fail.

## Describing a part

A part that keeps something across a restart (a journal, a file it saves, the store) or waits on the world outside (Claude Code, git, GitHub, a model) is described in a test file of its own, `<part>Invariants.test.ts`, with four things. `server/agents/goalInvariants.test.ts` has all four.

1. **The two rules.** A `Subject` and both checks, or a line saying why one doesn't apply (a part that keeps nothing across a restart, like a Claude Code session, has only the check for two at once). Hand every outside step to `later`.
2. **Its promises.** Each thing the part's page in `docs/` says it does ("closing a goal keeps what its lead showed and asked", "a session keeps listening while a command it left runs") is a plain test of that, run through the same description, saying what should happen. The rules can't see these: they compare a run with the same code taken one action at a time, so a part that's wrong every time is wrong in the reference too. Of the seven old bugs put back into the session and the goal's close, the rules caught 1 and the promises 5. Name the docs line each test holds. A promise the docs don't make yet is a gap in the docs: write it there first.
3. **A reach test**, that the description gets to the states that matter (as above), and **a break you've seen caught**: one for each rule, and one promise.
4. **Its stand-ins.** What the description stands in for the real thing (git, GitHub, Claude Code) assumes how the real thing behaves, and a check can see no further than that. A stand-in with a contract ([contracts](contracts.md)) passes it; one without says what it assumes under "What it can't tell" here. eab2be2 was missed because the session's stand-in for Claude Code always listed a running workflow, where the real one sometimes didn't.

**The rules' reach is a ratchet.** `pnpm run rules` runs the descriptions' checks alone with coverage (on seed 1, so two runs agree) and says how much of each file that keeps state they reach (it writes files, renames them into place, fsyncs, or writes a journal or the ledger: `keepsState` in `plugins/scorecard/scripts/rulesCoverage.ts`). `--ratchet` fails a file reached less than its baseline, `rules-baseline.json`, and a new file that keeps state with no description reaching it; `--raise` locks in a gain. Reaching a line isn't catching a bug in it, so a description still needs a break seen caught. At its start, 22 files kept state, and 9 of them were reached not at all or barely (under 10%): among them `manager/delivery.ts`, a developer's work going onto GitHub, which the office finishes after a restart (81% once described, below).

What each part caught and found goes in the sections below, with every live bug the checks find on main: check the docs for a trade-off made on purpose before calling one a bug.

## Where it's held so far

| part | test | rules |
| --- | --- | --- |
| a goal's lead (held for the plan's limit, its run, its inbox) | `server/agents/managerInvariants.test.ts` | restart |
| a goal lead's slices | `server/agents/sliceInvariants.test.ts` | both |
| the cartography plugin's kept diagrams | `plugins/cartography/invariants.test.ts` | both |
| the retro plugin's chief engineer's decisions | `plugins/retro/invariants.test.ts` | both |
| QA reviews | `server/agents/reviewInvariants.test.ts` | both |
| a Claude Code session (`ClaudeRunner`, on a stand-in held to the [Claude Code contract](contracts.md#claude-code-the-sdks-stream)) | `server/agents/claudeRunnerInvariants.test.ts` | at once |
| a goal's life to its close | `server/agents/goalInvariants.test.ts` | both |
| a developer's work going onto GitHub (`manager/delivery.ts`) | `server/agents/deliveryInvariants.test.ts` | both |
| the captain's replies to leads kept in the ledger (`manager/ledger.ts`) | `server/agents/repliesInvariants.test.ts` | both |
| the chief of staff's verdicts on leads' turns (each turn judged once however often it ends) | `plugins/chief-of-staff/invariants.test.ts` | both |

The session isn't held to the rule for a restart: it keeps nothing of its own across one. The office stops every session as it goes down, and what the lead was told is the lead's inbox, held in its own check.

`server/agents/invariants.test.ts` holds the harness itself to them, on two toys with each kind of flaw planted on purpose: a half-done mark left by a restart, two at once doing what one after the other would refuse, a queue a restart forgets, and a post sent again after it went up as the office went down.

## Does it catch real bugs?

Lifecycle and race bugs from the corpus were put back onto today's code (by reversing their fix, or by hand where the code had moved), into parts described before any bug was put back:

| bug | kind | caught by | what the check said |
| --- | --- | --- | --- |
| 185513c | lifecycle | restart | the lead isn't held for the plan's limit after a restart, and is idle |
| 0f97b94 | lifecycle | restart | a diagram left "being drawn again" after a restart mid-redraw |
| e8d930f | race | at once | "forget" during a redraw undone: the diagram comes back |
| 740f2d8 | race | at once | accepting and rejecting a draft at once files an issue for a rejected draft |
| eab2be2 | race | a promise and a reach test, once the stand-in could leave the workflow out | the session stopped listening a minute after a list without the workflow, with the workflow still running; the check for two at once missed it, as it's as wrong one at a time |
| f8cae72 | lifecycle | a promise (neither rule: a behaviour, not a state) | QA's review of the pull request had no commit to test |
| dde309b | race | neither rule; the session's reach tests | the session stops listening as its turn ends with a command and a workflow still running |
| 879f9ec | race | neither rule; the session's reach test | the session stops listening the moment its last background task ends |

So the rules caught the four in the parts described before the session, and none of the session's three: two are wrong one at a time too, and the third needed a Claude Code that behaves in a way the stand-in didn't, until it could. The goal's close told the same story: of four bugs put back by hand, the rules caught one (and only in the soak), the reach test three, as they were bugs of what a close does, wrong in the reference too. The delivery's: the rules caught d5e6b3d2 (a delivery journaled before asking them to commit), and the promises caught both it and f8cae72. Where the rules earned their keep was on main, below.

## Found on main

Live bugs the checks found on today's code, each now held in a plain test.

- **A message sent as the turn ends gets a turn the office has stopped listening to** (fixed; the session's check for two at once, `claudeRunnerInvariants.test.ts`): the turn's result says nothing's queued while the message is still on its way.
- **…and so did one on its way as a background command ends** (fixed): `heard` counted what Claude Code says whatever it has read (the background list, a task's start or end); now only an assistant message counts (`showsHeard`).
- **A verdict posted twice** (fixed; the review check, `reviewRecovery.test.ts`): a restart after GitHub took QA's comment, before the office recorded it, posted it again. If GitHub can't say whether it went up, the office posts: twice beats never.
- **A pull request that merges while the lead ships is put back as open** (fixed; the slices' check for two at once, `sliceRecovery.test.ts`): a ship worked from the pull requests as they were when it started.
- **A slice that landed mid-turn moves on a turn early after a restart.** By design rather than a bug (nothing is half-done or lost), but not what the rule for a restart allows, so the slices' restart check leaves out merging a slice's last pull request while the lead's turn is under way.
- **A goal closed while its lead was shipping lost the ship's pull requests** (fixed; the goal's check for two at once, `manager.test.ts`): a close now refuses while the slice is shipping.
- **A question asked as its goal closed deleted the filed question's pages** (fixed; `manager.test.ts`).
- **A restart part way through a close left the goal open with its work committed as a WIP snapshot** (fixed; the goal's restart check, in a soak, `manager.test.ts`): the lead then shipped the snapshot.
- **A restart as a developer's turn ended left their work off GitHub** (fixed; the delivery's restart check, `runJournal.test.ts`, `deliveryInvariants.test.ts`).
- **A message sent while a developer's work went up was never heard when the delivery failed** (fixed; a delivery promise).
- **A follow-up that came as the work went up wasn't asked to commit what it left** (fixed; a delivery promise).
- **A developer asked to commit, whose turn a restart cut off, was asked again** (fixed; the delivery's restart check). A second restart inside that same picked-up turn would still ask again.

## What it can't tell

- Only parts somebody describes are checked, and only as far as `durable()` says what must survive: a field left out is a field it can't see go wrong.
- A part whose async work doesn't go through `later` can't be interleaved inside that work, only between actions.
- It compares a run with the same code taken one action at a time, so a behaviour that's wrong every time (a close that throws work away) is wrong in the reference too: only a plain test of what should happen, like a description's reach test, sees it.
- The two actions under a check for two at once start together: a race where one starts only once the other is part way through (a ship once a close is into its snapshots) is out of its reach.
- Like any test, it says the rules hold for the sequences it tried, not for all of them.
- The delivery's stand-ins (`deliveryInvariants.test.ts`) assume, beyond the contracts: a checkout whose HEAD is its count of commits, moved by nothing but the developer (the workspace contract holds the real git to that, not this stand-in); that git's push and `gh` report a 5xx in words `serverStatus` reads ("returned error: 502", "HTTP 502"), which the demo GitHub never does (simplified in the GitHub contract); that a push onto a merged pull request's branch lands (GitHub may have deleted the branch: 5e27b8e is the workspace contract's); that the office hears of a merge or a close once it's landed (the board's refresh, not described); that Claude Code takes a message sent into a turn that has just ended (`FakeClaude` always does; the session's own check holds `Listening` to that); and that GitHub's head is never read (it lags a push, 57f3d0e: QA's commit comes from the checkout).
- The session's stand-in for Claude Code (`claudeStandIn.ts`) keeps the [Claude Code contract](contracts.md#claude-code-the-sdks-stream), and assumes beyond it: that a list can leave out a workflow that still runs (eab2be2's report: neither the recorded streams nor Claude Code's own code show it, so it's played as an action, not a fact); that a turn's result counts what waits for the next turn (never above 0 in the recordings; the transcripts can't say); that a background task can end with no turn after it (the grace's case: never recorded); that only commands and workflows run in the background, and end `completed` or `stopped` (no subagents, monitors, `failed` or `killed`, no `task_updated`, and a task's own tool call and result aren't played); and that nothing else comes down the stream (no rate limits, retries or compaction). What the runner reads from a message's words (a commit, a probe's output) isn't in the contract at all. Cloud agents (pushed from the cloud, the nudge to push), QA's fixers (a fix that fixed nothing) and conflict resolvers' deliveries aren't described.

A third rule, for the bugs that came from wrong assumptions about git, GitHub and the SDK rather than from state: [the fakes the tests rely on must behave like the real thing](contracts.md).
