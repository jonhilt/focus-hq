# Scheduler

A goal's lead asks to be woken later or regularly (`schedule`, `schedules`, `unschedule`), and each time a schedule falls due the lead hears from the Scheduler what it asked to do. Switched on per project.

## Why it's built this way

A lead had only Claude Code's own session scheduler, which lives and dies with the session, ran a 09:07 check at 12:01, 12:03 and 12:05, and can't tell anyone it missed. Off-the-shelf schedulers that keep schedules through a restart and catch up what was missed need Postgres (Graphile Worker, pg-boss), Redis (BullMQ, which doesn't catch up) or a server of their own (Temporal); the SQLite ones were too young, or kept their cron in memory, and launchd or a systemd timer can only start a program, not reach a lead. None watches for a lead not answering. So the calendar is [croner](https://github.com/hexagon/croner) (cron patterns, time zones, the clocks changing), and the rest is ours: a small book of schedules and the slots each has claimed, in the plugin's own folder.

croner's timers look at the wall clock at least every 30 seconds, so a Mac waking from sleep runs what fell due within half a minute; a tick every minute sits under them.

## Promises

Each is a test in `invariants.test.ts`, `scheduler.test.ts` or `rules.test.ts`.

- **A schedule holds through Focus restarting, and each slot wakes the lead once.** A slot is claimed in the book, written whole and flushed to disk, before the lead hears of it, so a restart, even straight after a run, never runs it again. (state.json waits a moment before it saves and isn't flushed, so a slot claimed there could run twice: the book is a file of its own.)
- **What fell due while Focus was down: the latest slot runs once, marked late, and those before it are missed.** As Focus starts again (and as a machine wakes), only the latest slot that fell due runs, saying how late it is and which slots it missed; the missed ones never run. The captain is toasted for each late, missed or held run.
- **Times are the lead's local times.** A pattern is read in the time zone the lead names (this machine's by default), so 09:07 stays 09:07 across the clocks changing.
- **A run held on the API key is said to be.** The lead's message goes as the Scheduler's, which Focus holds rather than refuses when picking their conversation up would cost; the run is marked held and the captain told.
- **A schedule goes with its goal.** One whose lead is gone, or whose project the plugin's switched off for, is dropped at its next slot, and one with no slots left is dropped once its last has run.
- **No more often than every 5 minutes, and no more than 10 a lead**: each run is a turn of the lead's.

## What it can't tell

A slot runs only while Focus is up: nothing restarts Focus after a crash, so a schedule waits for Focus to start again. Whether the lead answers a run isn't watched yet.
