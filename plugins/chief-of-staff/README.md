# The chief of staff

A plugin (`FOCUS_PLUGINS=chief-of-staff`, [plugins](../../docs/plugins.md)), switched on per project too (the manager's **Projects** tab, under **Plugins**: **Chief of staff**). It keeps the captain's inbox: what waits on them across the shown projects (Comms, with its badge on the HUD and its strips on the phone, and a bot on the [inbox API](../../docs/ledger.md#the-captains-inbox-api)), and what they decided, each answer a `captain-decision` line, whether it came from Comms, an agent's panel or the bot. As a goal's lead ends a turn, it judges where that turn goes, writes its verdict in the [ledger](../../docs/ledger.md#session-digests), and marks the turn with it (`lead.marks`), so the inbox files the turn by it. It needs no other plugin.

## What it does with a turn

It sends nothing itself unless the captain lets it, project by project (but for the news it [wakes a lead for](#the-leads-news-it-wakes-them-for)). What it decides is where a lead's ended turn waits for them:

- **While it reads the turn** (up to a minute: `JUDGING_MS`, `shared.ts`) the turn is held back: off the badge, no toast, a line in Comms saying how many it's reading. A turn it hasn't judged by then needs the captain as if it weren't there, so a judge that's slow, failing or switched off never hides one.
- **A card or an interrupt** (routes 2 and 3) needs the captain: it's on the badge, headed by its one line on what's being decided, with its reason and its words to the captain on the turn. As it's judged, a toast says so: an interrupt as an error, so it sounds like one.
- **Carry on, or back to the lead** (routes 1 and 4) are **Ready to send**: off the badge and quiet, with its words for the lead. The captain sends them with one press (the lead hears them `[Chief of Staff]`), or replies in their own words instead. In a project set to **Auto-send ready words** (the manager's **Projects** tab, beside its switch once it's on there; a project set so before the setting was the chief of staff's keeps it) they go by themselves two minutes after the verdict (`AUTO_SEND_MS`), counted down in Comms, unless the captain holds them; recorded `via: "chief-of-staff"`.
- **Suggested replies, and Got it.** On any route it suggests up to three replies to what the lead actually asked or offered ("Keep it open", "Close it"), a button each on the turn's card in Comms: pressed, its words go to the lead as the captain's own reply would. **Got it** on every lead's turn (O in Comms, and on the phone's Ready to send) acknowledges it: read, off the queue until the lead's next turn, nothing sent, and its words no longer counting down. Ops' news after it (a slice landing, QA's verdict) carries the lead on, since the captain is owed nothing. It's recorded as the captain's decision (`Acknowledged`), and the goal's move stays theirs, but quietly: the lamps don't call them for it.
- **Merging from the card.** A lead's turn, or their goal ready to close, lists their pull requests still open, each with QA's word on it and the board's merge button (M presses the first), and a pull request QA needs the captain on has it too: the captain lands what they've just read without going to the board. Above them is the slice's [system recap](../../docs/goals.md#the-system-recap), what to review them by, whatever the lead or QA said since it went up. Unlike the board's, it asks first only when there's a reason to (QA hasn't passed its head, or a merge check refused it): a press is already the captain deciding, and Ops' [merge check](../../docs/merging.md) still runs before anything merges.
- **Its read of a turn ends as the lead's next turn starts.** A verdict that comes after that, or one on an earlier turn, is dropped (it's still in the ledger), and a turn Ops stopped as it went down isn't read: it carries on after the restart.

Over a goal's pod, the team screen shows it holding the goal's move while it reads the turn, and while its words count down to sending themselves (`move.ts`); a card, an interrupt, words held (or that didn't go once their time came) or a read that took too long it hands to the captain, ahead of QA testing what the lead shipped, since only it knows they're waiting on the captain.

Only a lead's ended turn is the chief of staff's: a raised hand, a question, an error, a goal ready to close and QA's calls go to the captain whatever it thinks. Every verdict is still kept as a `cos-verdict` line, to check against what the captain did (`captain-replies`, `captain-decision`).

## Raising a ship's lane

A goal's lead ships each slice in a [lane](../../docs/merging.md#lanes-how-a-goals-leads-slice-merges): Ship merges by itself once QA passes it, Show merges and tells the captain, Ask waits for them. The lead picks it, so a lead that misjudges what the captain would want to see would merge it unseen; the chief of staff is the second pair of eyes, and it may raise the lane, never lower it (`laneJudge.ts`, `laneJudge.test.ts` and `chief.test.ts`):

- **It reads each ship once,** as the project's board refreshes after it: the goal, the pull requests' title and description, the lead's pick and the slice's recap, by the lane rules and the captain's standing orders, with Haiku as for a turn. Its answer is a `cos-lane` ledger line, kept or raised, with why and its prompt's version, to check against what the captain did with it.
- **Nothing in Ship or Show merges by itself before it has read it** at the commit it's at (`mergeHeld`): a new ship is read again. Ask is as high as it goes, so it isn't read.
- **One it couldn't read goes in Ask,** since a ship it hasn't read is the captain's, and the `cos-lane` line says why (`failed`).
- **A raise is Ops'**, through `host.goals.raiseLane`: each pull request in a lower lane goes up, with a `lane-raised` line and a comment on it saying why.

## Landed in Show

A slice the lead (or the chief of staff) put in Show merges by itself once QA passes it, like Ship, and then the captain hears of it: a card of its own in Comms, under the queue in **Landed in Show**, off the badge, since nothing waits on them (`landed.ts`, `landedCard.ts`; `landed.test.ts`, `captainsInbox.test.ts`, `comms.test.ts`). The captain asked for a card a slice, not a daily digest, so each is heard of as it lands.

- **It's the ledger's:** a `merged` line Ops made (`by: office`) in Show, with its lead, that no `captain-decision` answers yet, so the inbox keeps nothing and a restart loses nothing. A week on, it's let go.
- **Its card** says where it landed, who, when, and why the chief of staff let it go in Show, with a link to the pull request, whose description opens with its [recap](../../docs/goals.md#the-system-recap).
- **Got it** (O): heard, off Comms, nothing sent. **Redirect** sends the lead the captain's words about it, as the captain's message. **Revert** asks first, then has the lead revert it as their next slice, shipped in Ask, the captain's words as why. Nothing reverts by itself: Focus has no revert of its own, and the lead knows the work.
- Each is a `captain-decision` (item kind `landed`). Redirect and Revert need the goal still open; a closed goal's is refused, and the card stays for the captain to follow up on GitHub.

## The lead's news it wakes them for

Only the captain starts a goal lead's next turn in the core: Ops' and QA's news for the lead is a note, heard with the next message they get ([goals](../../docs/goals.md)). Where the chief of staff is on, it wakes the lead for the news that needs no captain, as whoever the note is from, and the note goes ahead of its words (`wake.ts`):

- **QA fails their pull request**, in a project that sends fails back (**Send failed PRs back**): back to the lead to fix it and ship again, or tell the captain why not, twice at most (`LEAD_FIX_ROUNDS`). Past that it's the captain's, and Ops' toast says the lead waits on them. A fail on a commit they've shipped past isn't sent back, and isn't the captain's either: QA is reviewing their latest already, so there's no toast.
- **Their slice lands**: they carry on with what's next, unless it's the captain's call (waiting for a go-ahead after each slice was the biggest wait on the captain: [where goals' time goes](../flow/README.md)). In the middle of a turn, they carry on where they are, since their commits come along.

It never wakes a lead the captain owes an answer: a turn it judged a card or an interrupt, one it never judged, a question, a goal ready to close, an error, read or not; nor one the captain stopped. A turn it would carry on or send back wakes them, read or not, and so does one the captain acknowledged (Got it: they're owed nothing). Waking them would start their next turn and take what waited on the captain from their inbox unanswered, so the note waits for the captain's next message instead. News for a turn it's still reading waits for its verdict: it wakes the lead then if the turn is one it would carry on or send back.

## The four routes

1. **Carry on.** Nothing's being decided: progress within the slice under way, with the next step stated, or waiting on something that isn't the captain.
2. **A card** for the captain's queue, with the lead's recommendation as the default: a real decision of the captain's, explained well, with a pick. Starting a new slice, shipping one, or proposing the goal closes is a card.
3. **Interrupt the captain.** Facts only the captain has; options with no recommendation; production, permissions, money, licences, security or anything outward-facing not already approved; the lead contradicting the captain; the goal's direction in question.
4. **Back to the lead**: the lead can find out for itself, its message needs restating with options and a pick, it's stuck on something it can unblock, or a standing order covers how to work.

## How it judges a turn

- **Which turns:** a goal lead's turn as it ends, in a project it's switched on for. It's judged in the background: the turn doesn't wait, and a judgement that fails is logged and dropped. A turn the lead said nothing in isn't judged, nor is one your plan's usage limit stopped: Ops carries those on itself. A turn is judged once however often it ends.
- **Who judges:** Claude Haiku, in a read-only session with no tools and a structured answer: the route, a one-line headline for the inbox (`ask`: what's being decided, or in brief what it would tell the lead), why, and the words it would send (to the lead on routes 1 and 4, to the captain on 2 and 3). Spending money is always an interrupt. The demo's judge is scripted.
- **What it writes:** a `cos-verdict` line in the ledger, with the prompt's version and what it cost.

## The captain's standing orders

The judge's prompt has the captain's standing orders in it: what they've wanted in turns like this before, learned from their past replies, and what's always theirs to decide. They're the captain's own preferences, so they're never in the repo: the plugin reads them from `standing-orders.txt` in its own folder (`~/.focus/plugins/chief-of-staff/`, or under `FOCUS_DATA_DIR`), afresh for every turn, so editing the file takes effect at once. Without the file, the judge goes by the four routes' rules alone.

## Without it

Switched off, Focus has no inbox: no Comms, no C key, nothing in the bridge's captain's chair, L off a holodeck opens the first project's goals, and nothing sends itself. The core's own plain word on what waits on the captain takes the place of its badge, its toasts and its Needs you on the phone: a count on the HUD, a toast as an agent comes to need them, and Needs you at the top of the phone, every hail as it is, with nothing held back for a verdict. The captain answers a raised hand, a question or a lead's ended turn from the agent's own panel, as before.

## Backtesting Jev

Offline, and nothing live uses it: is TypeSafe's Jev, a "System One" model that answers bounded questions with a probability per option in a fraction of a second and for a fraction of a cent, as good as Haiku at choosing the route? `pnpm run jev-backtest` asks it about every held-out turn of the backtest (`~/.focus/chief-of-staff/backtest/test.json`) and the captain's blind sample, one request a turn: the route as a choice of the four, and yes or no on spending money, on its being always the captain's, and on its starting a new slice, with the standing orders folded into the criteria they bear on (`jevRoute.ts`). It keeps Jev's raw answers, so `pnpm run jev-sweep` can route them at every interrupt bar for free and score each beside Haiku's and Sonnet's runs, writing one bar's routes for `backtest/score.py` ([scripts](../../docs/scripts.md)). It's pinned to a model (`JEV_BACKTEST_MODEL`) because `jev-latest` lags the newest, and needs `TYPESAFE_API_KEY`; `--dry-run` shows what it would send and roughly what it would cost.

**The labels' three buckets are the routes' four.** The captain labelled turns by what they did with them: bucket 1 they needed nothing, 2 they took the lead's default, 3 they brought something the lead couldn't have had. So bucket 1 is carry on or back to the lead (routes 1 and 4), 2 a card, 3 an interrupt (`LABEL_ROUTES`). `score.py` counts route 4 on a bucket-1 turn as wrong; it did so for Haiku too, so its numbers still compare, and the sweep's `agree` counts it right.

**What the first run argued for, and what it ruled out.** Jev routes, at the bar in `PROPOSED_POLICY`, and never carries a turn on silently: its carry-on was mostly turns the captain had something to add to, so it goes back to the lead, in the captain's log. Haiku would only write the words. Falling back to Haiku when Jev's confidence is low was tried on the same answers and dropped: it only pulled the scores back to Haiku's, since Jev's low-confidence turns weren't where its mistakes were. The bar was picked on the turns it was scored on, so the live judge doesn't go by any of this until it's held up on fresh ones.

## Card replay

`pnpm run card-replay` (`scripts/cardReplay.ts`, its rules in `cardReplay.ts`) replays Focus's history to see how every card the captain was owed ended: the captain answered, its words went, or something else woke the lead first and wiped it ([scripts](../../docs/scripts.md)). It knows its words and the decision that sent them by this plugin's own `SENDER` and `SENT_WORDS`, so they can't drift apart.
