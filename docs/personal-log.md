# The personal log

The captain's own log: thoughts you jot down to come back to, like an idea for a video, a feature, or something to check. The [captain's log](../plugins/captains-log/README.md) (a plugin) is what happened aboard. The personal log is what's on your mind.

## Jotting a thought down

Press <kbd>I</kbd> anywhere aboard. The ready room's console opens on **Personal log**, with the cursor in its box. Type or press **Mic** to dictate ([voice input](voice-input.md)). <kbd>Enter</kbd> logs it, and <kbd>Shift</kbd>+<kbd>Enter</kbd> starts a new line. The box stays open for the next thought. Entries don't belong to a project.

## From off the ship

With the office on your tailnet ([Tricorder](tricorder.md): `tailscale serve --bg 4477`), anything else on it, such as a chat bot, can jot a thought down for you:

```sh
curl -X POST https://<mac>.<tailnet>.ts.net/api/personal-log \
  -H 'Content-Type: application/json' \
  -d '{"text": "Video idea: briefings as the fix for walls of AI text", "from": "remote"}'
```

It answers with the entry (`{ id, text, from, at, status }`), or a 400 with `{ error }` for empty text or text over 2000 characters. `from: "remote"` marks it *from off the ship* on the console. Like the rest of the API, it has no login: the tailnet is the only lock.

## Through Number One

With the [`number-one`](../plugins/number-one/README.md) plugin on, ask Number One to remember, note or log something and they jot it down for you, marked *via* them on the console. Each message they hear comes with what's open in the log, so they can bring an idea back up when it bears on what you're talking about. A plugin reads and writes the log through `host.personalLog` ([plugins](plugins.md)).

## What's in it

The console's **Personal log** section (its count is what's on your mind) lists:

- **On your mind**: what's open, newest first. **Done** or **Drop** it, or put it aside till **Tomorrow** or **Next week** (9am, local time).
- **Put aside**: back with the rest once its time passes, or straight away with **Back now**.
- **Done and dropped**: the last 20. **Reopen** one to bring it back.

## Where it's kept

`personal-log.jsonl` in the data folder ([Data and backups](data.md)): a journal of what you did with each entry. Every change is a line, written and flushed to disk before the office answers, and never rewritten. The demo keeps it in memory.

## The API

- `GET /api/personal-log`: every entry, oldest first.
- `POST /api/personal-log {text, from?}`: jots one down (`from: 'remote'` shows it as jotted down off the ship).
- `POST /api/personal-log/:id {kind}`: `done`, `dropped`, `reopened`, `snoozed` (with `until`, ms since the epoch), or `edited` (with `text`).

Browsers hear each change as a `personal-log` event with the whole log.

## Where it lives

- `shared/personalLog.ts`: the facts, the mark a request asks for (`personalMark`, and where it was jotted down, `logFrom`), what they add up to (`evolvePersonalLog`) and the console's view of them (`personalLogView`), pure.
- `server/store.ts` (`personalLog`, `personalEntries`) keeps the journal. `server/office.ts` (`notePersonal`, `markPersonal`) records and broadcasts. `server/routes.ts` serves it.
- `client/src/ui/personalLogTab.ts`: the console's section.
