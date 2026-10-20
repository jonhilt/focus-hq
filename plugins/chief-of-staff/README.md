# The chief of staff (shadow mode)

A plugin (`FOCUS_PLUGINS=chief-of-staff`, [plugins](../../docs/plugins.md)), switched on per project too (the manager's **Projects** tab, under **Plugins**: **Chief of staff (shadow)**). As a goal's lead ends a turn, the chief of staff judges where that turn would go, and writes its verdict in the [ledger](../../docs/ledger.md#session-digests). It needs no other plugin.

## Shadow mode

It never acts. It sends nothing to the lead, puts nothing in front of the captain, and changes nothing about how the turn goes on: the office carries on exactly as it would without it. Its verdicts are only kept, as `cos-verdict` lines in the ledger, so they can be checked against what the captain actually replied to the same turns (the `captain-replies` lines beside each lead's digest), before it's ever trusted to act.

## The four routes

1. **Carry on.** Nothing's being decided: progress within the slice under way, with the next step stated, or waiting on something that isn't the captain.
2. **A card** for the captain's queue, with the lead's recommendation as the default: a real decision of the captain's, explained well, with a pick. Starting a new slice, shipping one, or proposing the goal closes is a card.
3. **Interrupt the captain.** Facts only the captain has; options with no recommendation; production, permissions, money, licences, security or anything outward-facing not already approved; the lead contradicting the captain; the goal's direction in question.
4. **Back to the lead**, with the message it would send: the lead can find out for itself, its message needs restating with options and a pick, it's stuck on something it can unblock, or a standing order covers how to work.

## How it judges a turn

- **Which turns:** a goal lead's turn as it ends (the `turn` hook's `end`), in a project it's switched on for. Nobody else's. It's judged in the background: the turn doesn't wait, and a judgement that fails is logged and dropped.
- **What it reads:** the end of what the lead said since the last message to it (anyone's: the captain's or the office's), its last 2,000 characters, cut as the `captain-replies` lines cut it (`turnTail` in `turn.ts`), with the goal's title. A turn the lead said nothing in isn't judged, nor is one your plan's usage limit stopped (its last line is Claude Code's "You've hit your … limit"): the office carries those on itself. A turn is named by its transcript's last line (`turnUuid`), and judged once however often it ends.
- **Who judges:** Claude Haiku (`haiku`, Claude Code's alias for the latest), in a read-only session the office lends it (`host.readOnlySession`) with no tools, a system prompt of its own (`judge.ts`, version `v5`, as backtested against the captain's past replies) and a structured answer: `{ route, why, message }`. About a tenth of a cent a turn. The demo's judge is scripted: a turn ending in a question is a card, anything else carries on.
- **What it writes:** a `cos-verdict` line: the session, the lead and goal, `turnUuid`, the route, why, the message for route 4, the model Claude Code reported, the prompt's version and what it cost. The ledger's review shows it under Sessions, as `CoS: interrupt — why`.

## The captain's standing orders

The judge's prompt has the captain's standing orders in it: what they've wanted in turns like this before, learned from their past replies, and what's always theirs to decide. They're the captain's own preferences, so they're never in the repo: the plugin reads them from `standing-orders.txt` in its own folder (`~/.focus/plugins/chief-of-staff/`, or under `FOCUS_DATA_DIR`), afresh for every turn, so editing the file takes effect at once. Without the file, the prompt says there are none yet and the judge goes by the four routes' rules alone.

## Without it

No verdicts are written. The ledger keeps the ones already in it, and its review still shows them.

## Where it lives

- `server.ts`: the plugin: the judge (Haiku, or scripted in the demo) and the `turn` hook.
- `chief.ts`: `ChiefOfStaff`: which turns are judged, reading the transcript through `host.transcript`, and writing the verdict with `host.record`.
- `turn.ts`: pure: what the lead said this turn (`turnTail`), and whether your plan's limit stopped it (`atUsageLimit`).
- `judge.ts`: pure: the prompt and its version, the standing orders' file, the schema, and the check on the verdict (`parseVerdict`).
- `claudeJudge.ts`, `demoJudge.ts`: the live judge (a read-only Claude Code session on Haiku) and the demo's scripted one.
- `client.ts`: its switch in a project's settings.
