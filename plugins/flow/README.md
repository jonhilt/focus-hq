# Where goals' time goes

A plugin (`FOCUS_PLUGINS=flow`, [plugins](../../docs/plugins.md)): each open goal's flow, live. Its scripts, `pnpm run flow` and [`pnpm run before-after`](#before-and-after), work in the terminal whether it's switched on or not.

`pnpm run flow` measures how long goals take and where that time goes, so a change meant to make goals faster can be judged by numbers taken before and after it, not by feel. It reads every goal the [ledger](../../docs/ledger.md) saw close, splits each one's time from opening to closing into states, and prints lead time, where the time went, the biggest wait, and the quality guards that must hold while lead time comes down. It reads and never writes, and takes a few seconds.

| | |
| --- | --- |
| `pnpm run flow` | every closed goal |
| `pnpm run flow --since 2026-10-10` | goals closed since a date (`--until` too), to compare before and after a change |
| `pnpm run flow --project proj_…` | one room's goals |
| `pnpm run flow --json` | the report as JSON, each goal's states and each pull request's rework included |
| `pnpm run flow --no-rework` | leaves out rework after merge, which asks GitHub about every merged pull request (about 30 s for 150) |

## Where it comes from

It reads the raw records, not the summaries: each goal's lead transcript (Claude Code's, found by the goal's `sessionId` under `~/.claude/projects/`), the ship tool's results in it (which say when each pull request was opened or updated), and the ledger's QA verdicts, merges and closes on those pull requests.

The lead is **at a turn** from the message that starts it (the captain's, Ops', QA's, or a background task's notification) to its last line before the next one, and **between turns** from there until that next message. Every moment from the goal opening to it closing lands in exactly one state, so they add up to its lead time:

- **working**: at a turn.
- **rework**: at a turn after QA failed one of the goal's pull requests, until the lead ships again.
- **background**: between turns, ended by a task notification: the lead waiting on its own subagents, workflows or background commands.
- **qa**: between turns, a pull request shipped and QA not back on its latest ship yet.
- **review**: between turns, QA passed every open pull request and they're waiting to merge, which is usually the captain.
- **captain**: between turns with nothing waiting on QA or a merge: waiting for the captain to reply, decide or close the goal.
- **queued**: the goal opened before its lead's first line.

## Reading it

- **Lead time p50 and p85.** The median goal, and the one 85% of goals beat. Watch p85: it's the long tail that makes goals feel slow.
- **To the last merge.** The same times, from opening to the goal's last pull request merging: when its outcome shipped, before the wait for someone to close the goal, which delays nothing. Only goals that merged something count, so its numbers are over fewer goals than lead time's. With time away left out too, up to the merge only.
- **Away.** An idle stretch of 4 hours or more is a night or a day away from the ship. Its time is still in its state, but the report also leaves it out (**while around**), along with the median goal's lead time without it, and the share of that time the lead was at work. A change to how Focus works shows up in the active numbers. The raw ones mostly measure when someone is around.
- **Biggest wait while around.** The wait state (qa, review, captain, queued) with the most active time: the constraint to work on first. **review** is waiting on the captain too, by another route.
- **Each wait on the captain** of a minute or more, p50 and p85. Shorter ones are messages sent while the lead was still at work.
- **Waiting on the captain, by why**, from how the lead's turn before the wait ended: a slice had landed and the lead waited to hear what next (**next-slice**: the turn began with Ops' `Slice … starts` message); it proposed closing the goal (**close**, the propose-close tool) or asked with pictures (**ask**, the ask tool); its last words asked leave to go on with what it proposed (**go-ahead**: "shall I…?", "want me to…?", "do you want…?") or asked something else (**question**); it reported and stopped (**report**); or QA had failed a pull request and it stopped (**qa-failed**). For each: the time while around, its share of the captain's, how many waits and the median one. The go-ahead and next-slice waits are the ones a lead could often have skipped by carrying on.
- **Quality guards**, over the goals' pull requests: merges without a current QA pass (QA's badge as it merged wasn't `passed`), QA passing first time, failed rounds, and conflicts an agent had to resolve. Lead time that comes down while these get worse hasn't really come down.
- **Rework after merge**: of the lines the goals' merged pull requests added, how many were changed or deleted on their base branch within 7 days, and the pull requests with the most. GitHub (`gh pr view`) says what each added, file by file, and which commits it was; `git blame` in the clone Ops keeps of its repo (`~/.focus/repos`), at the base branch as it stood 7 days after the merge, says how many of those lines still come from them. A pull request rebased or squashed onto its base counts the commits it landed as too (its merge commit, and those before it carrying its commits' messages). Lock files, pictures, models and builds don't count. One merged less than 7 days ago counts so far, and the line says how many are past 7 days.
- **QA catch rate**: the latest run of [`pnpm run qa-catch`](../../docs/qa-catch.md), Focus's own script (read through the plugin API's `latestQaCatch`), which plants a known bug in each of a few merged pull requests and runs QA's own review on it: how many QA caught, failed for something else, or missed.
- **Slowest five**, with their active time and where most of it went.

## Live, on the goal board

With the plugin switched on, each open goal's flow is worked out as it goes, the same way as `pnpm run flow`, with the goal's closing time taken as now and a lead in the middle of a turn counted as at work. It's worked out for every open goal again as Focus starts, so it isn't saved. Without the plugin, nothing works it out.

## Before and after

`pnpm run before-after` judges a change to how agents are steered (CLAUDE.md, a prompt) by what agents did either side of it: the ledger's 7 days before the moment against the 7 after (or up to now). By default the moment is the last commit to CLAUDE.md in this checkout; `--at <date>` picks another, `--days <n>` widens the window, `--project proj_…` keeps to one room (a repo's CLAUDE.md only steers its own room's sessions) and `--task lead` to one kind of session.

It prints, per session digest: turns, tool calls, wasted and refused calls, captain messages and nudges, compactions and cost; the share of sessions read for frictions that hit each kind (a guard block, a captain correction…); and QA's pass rate and how many pull requests merged first time. It warns while either side has fewer than 20 sessions. Nothing else is held still, so read it as evidence, not proof: the goals worked on differ from week to week.

## What it can't see

- A goal whose lead's transcript is gone isn't counted: Claude Code deletes transcripts after 30 days unless told otherwise, and a cloud session's transcript isn't on this machine. The report lists the goals it left out.
- A verdict counts for a pull request's latest ship if it came after that ship. QA reviews commits, not ships, so this is close but not exact. A pull request merged on a stale pass shows its last stretch as **qa**.
- Rework counts every change to a line within 7 days, a fix or a change of mind alike: the captain trying something and then going another way counts the same as a bug. Read the pull requests it names to tell which. A file renamed counts as its lines reworked.
- `pnpm run flow` counts only goals the ledger saw close; open goals' flow is on their goal boards, while the plugin's switched on.
- A cloud lead's transcript isn't on this machine, so its goal board shows no flow.
