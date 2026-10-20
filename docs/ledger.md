# The ledger

`~/.focus/ledger.jsonl` is the ship's log of how work went, one JSON line per event, appended and never rewritten: QA verdicts, merges and closes (with QA's badge at that moment, so a merge without a QA pass shows), merge conflicts (with the files that conflicted, so the retro can see which keep colliding), merge checks, triage decisions, each goal as it closes, and a digest of each agent session as it ends. It outlives the reviews, agents and transcripts it's about: `state.json` drops a review when its PR merges and an agent when they go home, and Claude Code deletes transcripts after 30 days unless told otherwise.

## Reviewing it

Reviewing the ledger changes nothing: anything that gets decided is decided at the retro (with the `retro` plugin on). The office serves it at `GET /api/ledger?days=`.

## A proper log

- **Numbered lines.** Each line starts with the format's version (`"v":2`) and carries a sequence number (`seq`), one more than the line before.
- **One writer.** `LedgerLog` (`server/ledgerLog.ts`) appends each line and flushes it to disk (fsync) before the office carries on. A lock file beside it (`ledger.jsonl.lock`, holding the office's process id) keeps a second office on the same data folder from writing too: that one reads the ledger, keeps its own new lines in memory, and says so on the report card (as a note, not as damage). A lock left by an office that's gone is taken over.
- **Checked whole on load** (`checkLedger`):
  - a last line cut short (Focus stopped mid-write) is dropped and the file trimmed;
  - damage in the middle (a line that doesn't read, numbers missing, repeated or going back) is never skipped quietly: the office copies the file aside (`ledger.jsonl.damaged-<time>`, once: the same damage found on a later start points at the copy already made), says what's wrong at the top of the report card (**⚠ Ledger damaged**) and in its log, and carries on numbering from the highest line it read;
  - lines from the first format (before numbering) are numbered and the file rewritten once, the old one kept as `ledger.jsonl.v1-<time>`.

## Session digests

When an agent's session ends, the office digests what's new in its Claude Code transcript into a `session-digest` line (`server/agents/sessionDigest.ts`), from code alone: no model reads it as it ends. Its frictions are read later, at retro time (below), by the retro plugin.

- **What:** what the session did and what it wasted (failed calls, refused calls, failed calls run again unchanged: running the tests again after an edit isn't waste), the captain's messages and how many were nudges, and what it cost since its last digest.
- **The captain's replies to leads:** beside each lead's digest goes a `captain-replies` line: every message the captain sent the lead in that span, in full, each with the end of what the lead had said since the last message to it. It's the record a chief of staff learns from: which of a lead's turns needed no more than "carry on", which a pick, and which the captain's own judgement. Transcripts go after 30 days, so these outlive them. As the office starts, the leads' spans digested before replies were kept get theirs from the transcripts still on this machine (`backfillReplies`), marked `backfilled`; a span with none gets an empty line, so it isn't read again.
- **The chief of staff's verdicts:** with the [chief-of-staff plugin](../plugins/chief-of-staff/README.md) on for a project, each of its goal leads' turns gets a `cos-verdict` line as it ends: where the chief of staff would have sent it, why, and the words it would have sent. It's shadow mode: nothing acts on them, so they're there to check against the `captain-replies` that follow.
- **Never twice:** each digest covers the transcript from the line after the last digest of that session to its end, and is keyed by the session and that last line. Calling it again with nothing new does nothing. A cloud session's transcript isn't on this machine, so it isn't digested.
- **Frictions, read at retro time** (`plugins/retro/frictions.ts`, with the `retro` plugin on; without it, none are read): when the captain starts a retro, the chief engineer reads each span in the window no one has read yet, finds the moments where the office, its tools, the environment or the way of working got in the way, and gives each a kind from a fixed list and a short signature, reusing the signatures already in the ledger so the same trouble groups together. Every friction is quoted, and code drops any quote that isn't in that span's text word for word. What it found in each span (none included) goes in the ledger as a `session-frictions` line, so no span is read twice. It only finds and quotes: it doesn't judge the work, rank anything or give verdicts.
- **Why Opus, not Haiku per session:** digests were first read by Haiku as each session ended. A bake-off on 9 Oct over the same 76 sessions found both cost about the same per session (Haiku's calls carry Claude Code's overhead each time) and found about as many frictions, but Haiku gave the same trouble different words (86 signatures to Opus's 36: merge conflicts split three ways, so the groups a retro counts fell apart), and missed some Opus found. Digests Haiku read keep their frictions, and count like the rest.
- **Older sessions:** transcripts from before digests began can be digested from code alone, so it costs no Claude usage; each is dated when its session ended and marked `backfilled`.

## Did the retro's fixes work?

Each retro draft the captain accepts goes in the ledger with its frictions' signatures and the issue it was filed as. When a pull request merges, the office notes the issues it closed, so the report card can tell when a fix landed, and for each accepted fix (`fixEffects` in `shared/ledger.ts`) compares how often its frictions came up before the captain accepted it and since it landed. The fixes are read from the ledger, so the report card keeps counting them with the retro plugin off.
