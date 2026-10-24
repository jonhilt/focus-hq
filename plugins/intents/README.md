# Intents

A project's compass: what its work is for. A goal says what done looks like for itself, but nothing said what a project's goals are all for, so a thread left over couldn't be judged ("does this still matter?") against anything, and the user was asked about every one. This plugin keeps, for each project, a line saying what it's for with the **guardrails** for how its work is done, and a few **intents**: lasting outcomes, not tasks ("Deliver value, reliably: each goal lands as a working capability…"). They're in an **Intents** view in the project's goals panel, and the threads plugin's Sort for me judges the project's threads against them.

`FOCUS_PLUGINS=intents`, then switched on per project in its settings.

## Where it lives

- `shared.ts`: a project's compass read from the ledger (`compassOf`, `compasses`), and the lines a change to it writes, or why it's refused (`changeLines`).
- `server.ts`: reads the ledger as Focus starts, and each intent line as it's written, into state it sends the browser; writes the user's changes (`POST /change`).
- `client.ts`: the goals panel's view (`goalsView`).

## Why it's built this way

- **The core's one intent format.** Each change is an `intent` ledger line (`shared/decisions.ts`, written through `intentEntry`), the same kind a goal's intent is, so whatever reads intents (Sort for me, a weekly card, a lead) reads one format. A project's line with no id is what it's for, its constraints the guardrails; each intent has an id of its own (from its first words), so one can be reworded or retired without the others, and a thread or goal can say which it serves. A project's compass is its lines as `projectIntents` reads them: the latest for each id, those retired left out.
- **Only the user agrees an intent.** Nothing is written until the user saves it, and each line says who agreed it and, when given, why it changed, so how a project's aims moved can be read from the ledger. A draft (the user's own, or one a lead brings) is pasted in as one intent a line, and it's the save that agrees it.
- **Read from the ledger, nothing saved of its own,** so a restart keeps every intent, as it was agreed (`invariants.test.ts`). A change is written whole: every line it writes, or none (each is checked before any is written), and the same change twice is refused, so it writes once.
- **A few, not a list.** A compass of more than eight intents points nowhere, so more are refused; a retired intent's last words stay in its line.
