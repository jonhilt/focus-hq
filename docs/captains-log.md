# The captain's log

Press <kbd>J</kbd> anywhere aboard for the captain's log: what happened across the ship on one timeline, newest first, from every journal the office keeps and the ledger.

- **Where it comes from** (`captainsLog` in `server/agents/captainsLog.ts`, served at `GET /api/log?since=<ms>`):
  - each crew member's [run journal](agents.md#the-run-journal-where-a-run-was-and-picking-up-after-a-restart): a hand up and the captain's answer, a hold for your plan's limit and coming off it, a turn cut off when Focus stopped, a turn that failed or was stopped, a sign-in mismatch, a developer's pull request opened;
  - each pull request's [review journal](qa.md#the-review-journal-picking-a-review-up-after-a-restart): QA testing it (at which commit), starting again after a restart, ending without a verdict, a verdict it couldn't post;
  - each goal's [slice journal](goals.md#the-slice-journal-a-ship-or-a-move-that-focus-cut-off): the goal taken up, each slice shipped (with its title and pull requests) or a ship that failed, each move to fresh code;
  - [the ledger](ledger.md): QA's verdicts, merges and closes, conflicts, triage, goals closed, the retro and session digests.

  Most of a journal is the office's bookkeeping (a message queued, a turn asked for), so only what a captain coming back would want to hear makes a line. QA's verdicts come from the ledger, which has every one.
- **Who**: each line names the crew member it's about. One who's gone home is named from the ledger (their sessions' digests, their goal's record); a review's lines name the reviewer who sat down to it.
- **While you were away**: the top of the log counts what happened since you last opened it in this browser (slices shipped, merges, QA's passes and fails, holds, failures, hands up, and how many times Focus restarted, told by the turns and reviews it cut off: `awaySummary` in `shared/captainsLog.ts`), and who's waiting on you now (a hand up, or a problem). Lines since then are lit.
- **How far back**: since you last looked, the last day or the last week (at most a week: `logSince`). Only journals written to in the window are read (by their files' times).
- **Filters**: by where a line came from (slices, QA, crew, ledger), the room, the goal, or who.

It's read-only: anything to act on is in Comms (<kbd>C</kbd>) or at the station concerned.
