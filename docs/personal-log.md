# The personal log

The captain's own log: thoughts you jot down to come back to, like an idea for a video, a feature, or something to check. The [captain's log](captains-log.md) is what happened aboard. The personal log is what's on your mind.

## Jotting a thought down

Press <kbd>I</kbd> anywhere aboard. The ready room's console opens on **Personal log**, with the cursor in its box. Type or press **Mic** to dictate ([voice input](voice-input.md)). <kbd>Enter</kbd> logs it, and <kbd>Shift</kbd>+<kbd>Enter</kbd> starts a new line. The box stays open for the next thought. Entries don't belong to a project.

## What's in it

The console's **Personal log** section (its count is what's on your mind) lists:

- **On your mind**: what's open, newest first. **Done** or **Drop** it, or put it aside till **Tomorrow** or **Next week** (9am, local time).
- **Put aside**: back with the rest once its time passes, or straight away with **Back now**.
- **Done and dropped**: the last 20. **Reopen** one to bring it back.

## Where it's kept

`personal-log.jsonl` in the data folder ([Data and backups](data.md)): a journal of what you did with each entry. Every change is a line, written and flushed to disk before the office answers, and never rewritten. The demo keeps it in memory.

## The API

- `GET /api/personal-log`: every entry, oldest first.
- `POST /api/personal-log {text}`: jots one down.
- `POST /api/personal-log/:id {kind}`: `done`, `dropped`, `reopened`, `snoozed` (with `until`, ms since the epoch), or `edited` (with `text`).

Browsers hear each change as a `personal-log` event with the whole log.

## Where it lives

- `shared/personalLog.ts`: the facts, what they add up to (`evolvePersonalLog`) and the console's view of them (`personalLogView`), pure.
- `server/store.ts` (`personalLog`, `personalEntries`) keeps the journal. `server/office.ts` (`notePersonal`, `markPersonal`) records and broadcasts. `server/routes.ts` serves it.
- `client/src/ui/personalLogTab.ts`: the console's section.
