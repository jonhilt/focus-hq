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

- **Which turns:** a goal lead's turn as it ends, in a project it's switched on for. It's judged in the background: the turn doesn't wait, and a judgement that fails is logged and dropped. A turn the lead said nothing in isn't judged, nor is one your plan's usage limit stopped: the office carries those on itself. A turn is judged once however often it ends.
- **Who judges:** Claude Haiku, in a read-only session with no tools and a structured answer: the route, why, and the words it would send (to the lead on routes 1 and 4, to the captain on 2 and 3). The demo's judge is scripted.
- **What it writes:** a `cos-verdict` line in the ledger, with the prompt's version and what it cost.

## The captain's standing orders

The judge's prompt has the captain's standing orders in it: what they've wanted in turns like this before, learned from their past replies, and what's always theirs to decide. They're the captain's own preferences, so they're never in the repo: the plugin reads them from `standing-orders.txt` in its own folder (`~/.focus/plugins/chief-of-staff/`, or under `FOCUS_DATA_DIR`), afresh for every turn, so editing the file takes effect at once. Without the file, the judge goes by the four routes' rules alone.

## Once you've answered

When you answer a lead, the chief of staff's verdict on that turn comes up as a toast. Only after you've decided, never before, so the ledger's comparison of its verdicts with your replies stays honest. It's said only if it's on the turn you answered.
