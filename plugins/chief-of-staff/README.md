# The chief of staff (shadow mode)

A plugin (`FOCUS_PLUGINS=chief-of-staff`, [plugins](../../docs/plugins.md)), switched on per project too (the manager's **Projects** tab, under **Plugins**: **Chief of staff (shadow)**). As a goal's lead ends a turn, the chief of staff judges where that turn would go, and writes its verdict in the [ledger](../../docs/ledger.md#session-digests). It needs no other plugin.

## Shadow mode

It never acts. It sends nothing to the lead, puts nothing in front of the captain before they've answered, and changes nothing about how the turn goes on: the office carries on exactly as it would without it. Its verdicts are only kept, as `cos-verdict` lines in the ledger, so they can be checked against what the captain actually replied to the same turns (the `captain-replies` lines beside each lead's digest), before it's ever trusted to act.

## The four routes

1. **Carry on.** Nothing's being decided: progress within the slice under way, with the next step stated, or waiting on something that isn't the captain.
2. **A card** for the captain's queue, with the lead's recommendation as the default: a real decision of the captain's, explained well, with a pick. Starting a new slice, shipping one, or proposing the goal closes is a card.
3. **Interrupt the captain.** Facts only the captain has; options with no recommendation; production, permissions, money, licences, security or anything outward-facing not already approved; the lead contradicting the captain; the goal's direction in question.
4. **Back to the lead**: the lead can find out for itself, its message needs restating with options and a pick, it's stuck on something it can unblock, or a standing order covers how to work.

## How it judges a turn

- **Which turns:** a goal lead's turn as it ends (the `turn` hook's `end`), in a project it's switched on for. Nobody else's. It's judged in the background: the turn doesn't wait, and a judgement that fails is logged and dropped.
- **What it reads:** the end of what the lead said since the last message to it (anyone's: the captain's or the office's), its last 2,000 characters, cut as the `captain-replies` lines cut it (`turnTail` in `turn.ts`), with the goal's title. A turn the lead said nothing in isn't judged, nor is one your plan's usage limit stopped (its last line is Claude Code's "You've hit your … limit"): the office carries those on itself. A turn is named by its transcript's last line (`turnUuid`), and judged once however often it ends.
- **Who judges:** Claude Haiku (`haiku`, Claude Code's alias for the latest), in a read-only session the office lends it (`host.readOnlySession`) with no tools, a system prompt of its own (`judge.ts`, version `v6`: v5's routes, as backtested against the captain's past replies, asked to speak in full, natural sentences) and a structured answer: `{ route, why, message }`, where `message` is always the words it would send: to the lead on routes 1 and 4, to the captain on 2 and 3. About a tenth of a cent a turn. The demo's judge is scripted: a turn ending in a question is a card, anything else carries on.
- **What it writes:** a `cos-verdict` line: the session, the lead and goal, `turnUuid`, the route, why, the message it would send, the model Claude Code reported, the prompt's version and what it cost. The ledger's review shows it under Sessions, as `CoS: interrupt — why` with its message quoted in full beneath (“To the captain: …”), and so does the captain's log.

## The captain's standing orders

The judge's prompt has the captain's standing orders in it: what they've wanted in turns like this before, learned from their past replies, and what's always theirs to decide. They're the captain's own preferences, so they're never in the repo: the plugin reads them from `standing-orders.txt` in its own folder (`~/.focus/plugins/chief-of-staff/`, or under `FOCUS_DATA_DIR`), afresh for every turn, so editing the file takes effect at once. Without the file, the prompt says there are none yet and the judge goes by the four routes' rules alone.

## Once you've answered

When you answer a lead in [Comms](../../docs/comms.md) (approve or decline a tool, pick an option, reply, close the goal), the chief of staff's verdict on that turn comes up as a toast, in its own words as it wrote them: `Chief of staff: Filing an issue for a bug you caught is your own step, not the captain's call`. Only after you've decided, never before, so the ledger's comparison of its verdicts with your replies stays honest. The plugin keeps each lead's latest verdict in its state (in memory only, `ChiefState`), with when the turn ended, and says it only if it's on the turn you answered: a tool you approve mid-turn, or a turn judged before the last, says nothing. A verdict still being judged as you answer is said when it comes in.

## Without it

No verdicts are written. The ledger keeps the ones already in it, and its review still shows them.

## Where it lives

- `server.ts`: the plugin: the judge (Haiku, or scripted in the demo) and the `turn` hook.
- `chief.ts`: `ChiefOfStaff`: which turns are judged, reading the transcript through `host.transcript`, and writing the verdict with `host.record`.
- `turn.ts`: pure: what the lead said this turn (`turnTail`), and whether your plan's limit stopped it (`atUsageLimit`).
- `judge.ts`: pure: the prompt and its version, the standing orders' file, the schema, and the check on the verdict (`parseVerdict`).
- `claudeJudge.ts`, `demoJudge.ts`: the live judge (a read-only Claude Code session on Haiku) and the demo's scripted one.
- `shared.ts`: what the browser's told: each lead's latest verdict, and whether it's on the turn the captain answered (`onTurn`).
- `client.ts`: its switch in a project's settings, and the toast once you've answered a turn.
