# Where goals' time goes

`pnpm run flow` measures how long goals take and where that time goes, so a change meant to make goals faster can be judged by numbers taken before and after it, not by feel. It reads every goal the [ledger](ledger.md) saw close, splits each one's time from opening to closing into states, and prints lead time, where the time went, the biggest wait, and the quality guards that must hold while lead time comes down. It reads and never writes, and takes a few seconds.

| | |
| --- | --- |
| `pnpm run flow` | every closed goal |
| `pnpm run flow --since 2026-10-10` | goals closed since a date (`--until` too), to compare before and after a change |
| `pnpm run flow --project proj_…` | one room's goals |
| `pnpm run flow --json` | the report as JSON, each goal's states included |

## Where it comes from

It reads the raw records, not the summaries: each goal's lead transcript (Claude Code's, found by the goal's `sessionId` under `~/.claude/projects/`), the ship tool's results in it (which say when each pull request was opened or updated), and the ledger's QA verdicts, merges and closes on those pull requests. The rules are pure, in `server/agents/flow.ts`, tested next to it; `scripts/flow.ts` only reads the files.

The lead is **at a turn** from the message that starts it (the captain's, the office's, QA's, or a background task's notification) to its last line before the next one, and **between turns** from there until that next message. Every moment from the goal opening to it closing lands in exactly one state, so they add up to its lead time:

- **working**: at a turn.
- **rework**: at a turn after QA failed one of the goal's pull requests, until the lead ships again.
- **background**: between turns, ended by a task notification: the lead waiting on its own subagents, workflows or background commands.
- **qa**: between turns, a pull request shipped and QA not back on its latest ship yet.
- **review**: between turns, QA passed every open pull request and they're waiting to merge, which is usually the captain.
- **captain**: between turns with nothing waiting on QA or a merge: waiting for the captain to reply, decide or close the goal.
- **queued**: the goal opened before its lead's first line.

## Reading it

- **Lead time p50 and p85.** The median goal, and the one 85% of goals beat. Watch p85: it's the long tail that makes goals feel slow.
- **Away.** An idle stretch of 4 hours or more is a night or a day away from the ship. Its time is still in its state, but the report also leaves it out (**while around**), along with the median goal's lead time without it, and the share of that time the lead was at work. A change to how the office works shows up in the active numbers. The raw ones mostly measure when someone is around.
- **Biggest wait while around.** The wait state (qa, review, captain, queued) with the most active time: the constraint to work on first. **review** is waiting on the captain too, by another route.
- **Each wait on the captain** of a minute or more, p50 and p85. Shorter ones are messages sent while the lead was still at work.
- **Waiting on the captain, by why**, from how the lead's turn before the wait ended: a slice had landed and the lead waited to hear what next (**next-slice**: the turn began with the office's `Slice … starts` message); it proposed closing the goal (**close**, the propose-close tool) or asked with pictures (**ask**, the ask tool); its last words asked leave to go on with what it proposed (**go-ahead**: "shall I…?", "want me to…?", "do you want…?") or asked something else (**question**); it reported and stopped (**report**); or QA had failed a pull request and it stopped (**qa-failed**). For each: the time while around, its share of the captain's, how many waits and the median one. The go-ahead and next-slice waits are the ones a lead could often have skipped by carrying on.
- **Quality guards**, over the goals' pull requests: merges without a current QA pass (QA's badge as it merged wasn't `passed`), QA passing first time, failed rounds, and conflicts an agent had to resolve. Lead time that comes down while these get worse hasn't really come down.
- **Slowest five**, with their active time and where most of it went.

## Live, on the goal board

Each open goal's flow is worked out as it goes, the same way, and carried on the goal (`LeadWork.flow`): as its lead's turns start and end, QA reports on its pull requests and its slices land, the office reads the lead's transcript and the ledger again (`refreshFlow` in `server/agents/manager/ledger.ts`), with the goal's closing time taken as now and a lead in the middle of a turn counted as at work. The goal board in its briefing room shows it along the bottom (`client/src/world/goalScreens.ts`, worded by `shared/flow.ts`):

- **What it's doing now, and for how long:** at work, reworking after QA, waiting on its own work, on QA, for your merge, or on you, with why when it's you ("asked leave to go on with what it proposed", "a slice landed: waiting to hear what next"…). The time counts up a minute at a time.
- **A bar of where its time has gone** while someone was around (idle stretches of 4 hours or more left out): green at work, red reworking, then the waits, you in orange; and the same in words underneath, `2.4 h so far · at work 52% · QA 14% · your merge 12% · you 22%`.

The demo's pretend leads keep a stand-in transcript of their turns (`DemoRunner.transcript`), so the board shows it in the demo too.

## What it can't see

- A goal whose lead's transcript is gone isn't counted: Claude Code deletes transcripts after 30 days unless told otherwise, and a cloud session's transcript isn't on this machine. The report lists the goals it left out.
- A verdict counts for a pull request's latest ship if it came after that ship. QA reviews commits, not ships, so this is close but not exact. A pull request merged on a stale pass shows its last stretch as **qa**.
- `pnpm run flow` counts only goals the ledger saw close; open goals' flow is on their goal boards.
- A cloud lead's transcript isn't on this machine, so its goal board shows no flow.
