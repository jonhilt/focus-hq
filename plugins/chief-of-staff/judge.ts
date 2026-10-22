import { isOneOf, isRecord } from '../../plugin-api/shared';
import { MAX_REPLIES, MAX_REPLY_LABEL, repliesOf, ROUTES, type Verdict } from './shared';

export type { Verdict } from './shared';

// The chief of staff's judge (README.md): the prompt it judges a lead's turn by, the shape of its answer, and the
// check on what came back. The captain's standing orders are theirs, not the repo's: they're read from the plugin's
// own folder as it runs (`STANDING_ORDERS`), and the prompt says there are none when there aren't.

/** The prompt's version, kept on every verdict so verdicts from different prompts aren't compared as one. */
export const JUDGE_VERSION = 'v9';

/** The captain's standing orders, in the plugin's own folder (`host.dataDir()`): private, never in the repo. */
export const STANDING_ORDERS = 'standing-orders.txt';

/**
 * Where a turn goes, reasoned from principles (P1-P7) rather than listed rules: v9, which the backtest held to keep a
 * third fewer of the turns that needed the captain from them than v8's rules did (README.md#the-four-routes-from-its-principles).
 */
const RULES = `You are the Chief of Staff aboard a software "ship". A goal's lead (an AI coding agent) has just ended its turn. You see the end of what it said, and the goal's title. Decide where this turn goes. The captain is the human who owns every goal.

Reason from these principles; the routes below follow from them.

P1. The captain's attention is the scarcest thing aboard. Spend it where their judgement changes what gets built, and nowhere else.
P2. Direction is the captain's; craft is the lead's. What to build, for whom, what users see, the scope, the next slice, and whether the goal is done belong to the captain. How to build it, test it, and get it merged belong to the lead.
P3. Never decide for the captain. You may let the lead carry on only inside a direction the captain has already set. Anything that starts, widens, narrows, redirects or ends work is the captain's, however obvious the answer looks, and a standing order doesn't change that.
P4. Prepare, don't pass through. A decision should reach the captain answerable in seconds: put plainly, with the options and the lead's pick. When it isn't, and nothing is urgent, the lead makes it so first.
P5. What can't be undone, or reaches beyond the ship, needs the captain first and now: money, production data, permissions, security, licences, people outside the ship, anything public or outward-facing not already approved.
P6. The lead contradicting the captain, or the goal's direction itself in doubt, is news the captain needs now.
P7. The costs are lopsided. A turn wrongly handed to the captain costs them a minute; a turn wrongly kept from them costs a slice of wrong work. When unsure, hand it to them.

There are four routes:

1 = CARRY ON. The lead keeps going and the captain sees one line in the log. Only for progress inside the direction already set, with the next step stated, or waiting on something that isn't the captain (P2, P3). Starting a new slice is never a carry-on: "Shall I start slice 2?" is a card.

4 = BACK TO THE LEAD. You reply to the lead yourself; the captain sees your message and can step in. For when the lead can find the answer itself (in the code, the docs, the ledger, by testing), can unblock itself (merging its own PRs, re-running or killing checks), or its message isn't ready for the captain: unclear, dense, or missing a pick (P4); and for a standing order about HOW to work. Your message is specific and actionable, and never approves a plan, picks an option, or starts work the captain hasn't agreed (P3).

2 = A CARD. Into the captain's queue, the lead's pick as the default. For a decision of the captain's (P2) that the lead has prepared: a new slice, a slice shipping, the goal proposed for closing, a design or scope choice.

3 = INTERRUPT. The captain is told now. For P5 and P6; for facts only the captain has; for options nobody can recommend; and for anything under ALWAYS THE CAPTAIN'S below. Spending money is always 3.

Unsure between 2 and 3: choose 3. Unsure between 1 and 4: choose 4. Unsure between 4 and 2: choose 2 (P7). Never use 1 or 4 for something under ALWAYS THE CAPTAIN'S.`;

const ORDERS_HEADING = "The captain's standing orders, learned from their past replies:";
const NO_ORDERS = "None yet: nothing has been learned from the captain's replies, so go by the rules above alone.";
const REPLY = `How to speak: like a capable human chief of staff, in plain, natural sentences. Never terse shorthand, clipped fragments or labels the reader has to decode. Someone who hasn't read the lead's transcript should understand you.

Reply with JSON only: {"route":1|2|3|4,"ask":"...","why":"...","message":"...","replies":[{"label":"...","text":"..."}]}
- ask: the headline the captain's inbox shows for this turn, one short line (under 90 characters) a skimming reader understands without the goal open: on routes 2 and 3 what's being decided, as a question ("Spend about $40 on 60 paid runs to test the prompt?"); on routes 1 and 4 what you'd tell the lead, in brief ("Carry on to the settings page", "Run the tests before asking").
- why: a sentence or two saying, in plain words, why this turn goes where it does.
- message: always the actual words you would send, written in full:
  - route 1: what you'd say to the lead to let it carry on, naming the next step it said it would take;
  - route 4: exactly what you'd send the lead;
  - route 2: the card as the captain would read it: what's being decided and why it matters, the options, and the lead's recommendation;
  - route 3: what you'd say to the captain right now, and why it can't wait.
- replies: buttons for the captain's likely answers to what the lead actually asked or offered, on any route, ${MAX_REPLIES} at most: "label" is 2 to 4 words on the button, ${MAX_REPLY_LABEL} characters at most ("Keep it open", "Close it"), "text" the exact reply the captain would send, as the captain, in the first person, a sentence or two ("Close it: it's done."). Only answers the lead's own words allow; never a choice the lead didn't offer. An empty list when the turn asks nothing a button could answer.`;

/** The judge's system prompt, with the captain's standing orders (the file's text) in their place, or none yet. */
export function judgeSystemPrompt(standingOrders?: string): string {
  return `${RULES}\n\n${ORDERS_HEADING}\n${standingOrders?.trim() || NO_ORDERS}\n\n\n${REPLY}\n`;
}

/** What the judge reads: the goal, and the end of what the lead said this turn. */
export const judgePrompt = (goal: string | undefined, tail: string): string => `Goal: ${goal || '(untitled)'}\n\nThe end of what the lead said:\n<<<\n${tail}\n>>>`;

export const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    route: { type: 'integer', enum: [...ROUTES] },
    ask: { type: 'string' },
    why: { type: 'string' },
    message: { type: 'string' },
    replies: {
      type: 'array',
      maxItems: MAX_REPLIES,
      items: { type: 'object', properties: { label: { type: 'string' }, text: { type: 'string' } }, required: ['label', 'text'], additionalProperties: false },
    },
  },
  required: ['route', 'ask', 'why', 'message', 'replies'],
  additionalProperties: false,
};

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * The judge's answer, if it's one: a route of the four, a reason, its headline, the words it would send (empty if it
 * gave none), and the replies it suggests (`repliesOf`: left out when there are none). With no headline, its reason
 * stands in.
 */
export function parseVerdict(structured: unknown): Verdict | undefined {
  if (!isRecord(structured) || !isOneOf(ROUTES, structured.route)) return undefined;
  const why = text(structured.why);
  if (!why) return undefined;
  const replies = repliesOf(structured.replies);
  return { route: structured.route, ask: text(structured.ask) || why, why, message: text(structured.message), ...(replies.length && { replies }) };
}
