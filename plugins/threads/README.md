# Threads

A project's loose threads, kept past the goal that noticed them. A goal's lead logs a contact for something that needs real attention (a risk, a question, something off the course) and closes it when it's pursued or dropped. A goal often closes with some still open, and until now nothing read them again: they stayed on a closed goal's chart. This plugin lists every contact a project's leads left open, its closed goals' and its goals under way's, in a **Threads** view in the project's goals panel, after Closed, and keeps where the captain decides each of a closed goal's ends.

`FOCUS_PLUGINS=threads`, then switched on per project in its settings.

## Where it lives

- `shared.ts`: the register, in pure functions (`closedThreads`, `afterLine`, `register`), and what deciding a thread writes, or why it's refused (`decision`).
- `server.ts`: reads the ledger as Focus starts, and each goal closing and each decision as they're written, into state it sends the browser; writes the captain's decisions (`POST /decide`).
- `client.ts`: the goals panel's view (`goalsView`).

## Why it's built this way

- **Read from the ledger, nothing saved of its own.** The ledger keeps every goal whole as it closed (`goal-closed`), contacts and all, and is never rewritten, so the register is the ledger read again: it fills itself with every thread left open since contacts began, and a restart can't lose one. `state.json`'s room log keeps only the latest goals, so it isn't read for this.
- **A goal's last close counts.** A goal reopened and closed again is listed as it closed the last time; one reopened and under way is listed from its lead, as its contacts stand now (`shared.test.ts`).
- **Contacts only, for now.** Contacts are what a lead flagged as needing attention. A goal's ideas for next are the slices it would have done next, and many mean nothing once it's closed, so they're left out until there's a way to sort through them in bulk.
- **Every decision is a line in the ledger** (`thread-decided`), so the register stays the ledger read in order, and a restart keeps every decision (`invariants.test.ts`). A closed goal's thread ends as next (with who takes it on: you, if no one's named), parked (until when), dropped (why) or resolved (by what), and Undo takes a decision back. The note is the reason a later look needs: parked and dropped say nothing without one, so they're refused without it. Pressing the same decision again is refused, so the same decision twice writes one line.
- **A goal under way keeps its threads.** Its contacts are its lead's to pursue or drop, so the register shows them with a way to the lead, and refuses a decision on one. A goal reopened and closed again keeps what was decided of the threads it left open again.
- **The captain decides; nothing else does.** Nothing in the plugin decides a thread by itself, so a thread is only ever dropped by the captain's own press. Spinning a thread off as a goal of its own comes next.
