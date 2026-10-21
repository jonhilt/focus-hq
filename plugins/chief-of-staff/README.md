# The chief of staff

A plugin (`FOCUS_PLUGINS=chief-of-staff`, [plugins](../../docs/plugins.md)), switched on per project too (the manager's **Projects** tab, under **Plugins**: **Chief of staff**). As a goal's lead ends a turn, the chief of staff judges where that turn goes, writes its verdict in the [ledger](../../docs/ledger.md#session-digests), and hands it to the captain's inbox, which files the turn by it. It needs no other plugin.

## What it does with a turn

It sends nothing itself unless the captain lets it, project by project. What it decides is where a lead's ended turn waits for them:

- **While it reads the turn** (up to a minute: `JUDGING_MS`, shared/tricorder.ts) the turn is held back: off the badge, no toast, a line in Comms saying how many it's reading. A turn it hasn't judged by then needs the captain as if it weren't there, so a judge that's slow, failing or switched off never hides one.
- **A card or an interrupt** (routes 2 and 3) needs the captain: it's on the badge, headed by its one line on what's being decided, with its reason and its words to the captain on the turn. As it's judged, a toast says so: an interrupt as an error, so it sounds like one.
- **Carry on, or back to the lead** (routes 1 and 4) are **Ready to send**: off the badge and quiet, with its words for the lead. The captain sends them with one press (the lead hears them `[Chief of Staff]`), or replies in their own words instead. In a project set to **Auto-send ready words** (the manager's **Projects** tab) they go by themselves two minutes after the verdict (`AUTO_SEND_MS`), counted down in Comms, unless the captain holds them; recorded `via: "chief-of-staff"`.
- **Its read of a turn ends as the lead's next turn starts.** A verdict that comes after that, or one on an earlier turn, is dropped (it's still in the ledger), and a turn the office stopped as it went down isn't read: it carries on after the restart.

Only a lead's ended turn is the chief of staff's: a raised hand, a question, an error, a goal ready to close and QA's calls go to the captain whatever it thinks. Every verdict is still kept as a `cos-verdict` line, to check against what the captain did (`captain-replies`, `captain-decision`).

## The four routes

1. **Carry on.** Nothing's being decided: progress within the slice under way, with the next step stated, or waiting on something that isn't the captain.
2. **A card** for the captain's queue, with the lead's recommendation as the default: a real decision of the captain's, explained well, with a pick. Starting a new slice, shipping one, or proposing the goal closes is a card.
3. **Interrupt the captain.** Facts only the captain has; options with no recommendation; production, permissions, money, licences, security or anything outward-facing not already approved; the lead contradicting the captain; the goal's direction in question.
4. **Back to the lead**: the lead can find out for itself, its message needs restating with options and a pick, it's stuck on something it can unblock, or a standing order covers how to work.

## How it judges a turn

- **Which turns:** a goal lead's turn as it ends, in a project it's switched on for. It's judged in the background: the turn doesn't wait, and a judgement that fails is logged and dropped. A turn the lead said nothing in isn't judged, nor is one your plan's usage limit stopped: the office carries those on itself. A turn is judged once however often it ends.
- **Who judges:** Claude Haiku, in a read-only session with no tools and a structured answer: the route, a one-line headline for the inbox (`ask`: what's being decided, or in brief what it would tell the lead), why, and the words it would send (to the lead on routes 1 and 4, to the captain on 2 and 3). Spending money is always an interrupt. The demo's judge is scripted.
- **What it writes:** a `cos-verdict` line in the ledger, with the prompt's version and what it cost.

## The captain's standing orders

The judge's prompt has the captain's standing orders in it: what they've wanted in turns like this before, learned from their past replies, and what's always theirs to decide. They're the captain's own preferences, so they're never in the repo: the plugin reads them from `standing-orders.txt` in its own folder (`~/.focus/plugins/chief-of-staff/`, or under `FOCUS_DATA_DIR`), afresh for every turn, so editing the file takes effect at once. Without the file, the judge goes by the four routes' rules alone.
