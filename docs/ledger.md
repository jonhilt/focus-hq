# The ledger

`~/.focus/ledger.jsonl` is the ship's log of how work went, one JSON line per event, appended and never rewritten: each QA verdict (with its commit, round and checks), each PR merged or closed (by whom, and QA's badge on it at that moment, so a merge without a QA pass shows), merge conflicts (cleanly merged by the office, or an agent had to resolve them), checks sent back, triage decisions, each goal as it closes (uncapped, unlike the 30 goals `state.json` keeps), and a digest of each agent session as it ends (below). It outlives the reviews, agents and transcripts it's about: `state.json` drops a review when its PR merges and an agent when they go home, and Claude Code deletes transcripts after 30 days unless told otherwise. The engineering station's screen shows the last 30 days of it summed up (`reportCard` in `shared/ledger.ts`), and the [chief engineer's retro](retro.md) reads it too.

## A proper log

- **Numbered lines.** Each line starts with the format's version (`"v":2`) and carries a sequence number (`seq`), one more than the line before.
- **One writer.** `LedgerLog` (`server/ledgerLog.ts`) appends each line and flushes it to disk (fsync) before the office carries on. A lock file beside it (`ledger.jsonl.lock`, holding the office's process id) keeps a second office on the same data folder from writing too: that one reads the ledger, keeps its own new lines in memory, and says so on the report card (as a note, not as damage). A lock left by an office that's gone is taken over.
- **Checked whole on load** (`checkLedger`):
  - a last line cut short (Focus stopped mid-write) is dropped and the file trimmed;
  - damage in the middle (a line that doesn't read, numbers missing, repeated or going back) is never skipped quietly: the office copies the file aside (`ledger.jsonl.damaged-<time>`, once: the same damage found on a later start points at the copy already made), says what's wrong at the top of the report card (**⚠ Ledger damaged**) and in its log, and carries on numbering from the highest line it read;
  - lines from the first format (before numbering) are numbered and the file rewritten once, the old one kept as `ledger.jsonl.v1-<time>`.

## Session digests

When an agent's session ends, the office digests what's new in its Claude Code transcript into a `session-digest` line (`server/agents/sessionDigest.ts`), from code alone: no model reads it.

- **When:** a developer or conflicts agent as they go home; QA as each verdict is in (the room's QA officer is reused from review to review); a lead as each slice lands, and as the goal closes.
- **What:** how long it ran, its tool calls, the calls that failed and those a guard, hook or permission check refused, failed calls run again unchanged, the wasted calls (failed plus run again: running the tests again after an edit isn't waste), the captain's messages and how many were nudges ("continue", "go", "ship it"), the office's messages, compactions, what it cost (the session's running total, less what its last digest counted), and the QA fails and conflicts on its pull requests so far.
- **Never twice:** each digest covers the transcript from the line after the last digest of that session to its end, and is keyed by the session and that last line. Calling it again with nothing new does nothing. A cloud session's transcript isn't on this machine, so it isn't digested.

The report card shares the digests' cost and wasted calls out over the PRs merged in the window: **Per merge: $… · … wasted tool calls**.
