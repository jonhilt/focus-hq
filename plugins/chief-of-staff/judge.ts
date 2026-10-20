import { type CosRoute, isOneOf, isRecord } from '../../plugin-api/shared';

// The chief of staff's judge (README.md): the prompt it judges a lead's turn by, the shape of its answer, and the
// check on what came back. The captain's standing orders are theirs, not the repo's: they're read from the plugin's
// own folder as it runs (`STANDING_ORDERS`), and the prompt says there are none when there aren't.

/** The prompt's version, kept on every verdict so verdicts from different prompts aren't compared as one. */
export const JUDGE_VERSION = 'v5';

/** The captain's standing orders, in the plugin's own folder (`host.dataDir()`): private, never in the repo. */
export const STANDING_ORDERS = 'standing-orders.txt';

export const ROUTES: readonly CosRoute[] = [1, 2, 3, 4];

/** The rules of the four routes, as the backtest scored them. */
const RULES = `You are the Chief of Staff aboard a software "ship". A goal's lead (an AI coding agent) has just ended its turn. You see the end of what it said, and the goal's title. Decide where this turn goes. The captain is the human who owns every goal.

There are four routes:

1 = CARRY ON. The lead keeps going and the captain sees one line in the log. Use this only when nothing is being decided: progress within the slice already under way, with the next step stated; waiting on something that isn't the captain. Starting a NEW slice is never a carry-on: "Shall I start slice 2?" or "Shall I go ahead with the next slice?" is a card (2), because that is where the captain steers and widens scope. Standing orders never turn a card into a carry-on.

4 = BACK TO THE LEAD. You reply to the lead yourself, and the captain sees your message in the log and can step in. You PREPARE things for the captain; you never decide for them. Use this when:
- the lead needs information it can find itself (in the code, the docs, the ledger, by testing), or it asked the captain something it should check first;
- the lead's message is unclear, too dense or missing a recommendation: ask it to restate in plain words with options and its pick, or to put up a visual explainer, so that it reaches the captain ready to answer;
- the lead is stuck on something it can unblock itself (merging its own PRs, re-running checks, killing a stuck check);
- a standing order covers HOW to work (full paths, status updates, delegating, legibility checks), not WHAT to build.
Your message must never approve a plan, pick an option, or start work the captain hasn't agreed. A decision with a clear recommendation is a card (2), even if a standing order suggests the captain would agree.
Your message must be specific and actionable.

2 = A CARD. It goes into the captain's queue with the lead's recommendation as the default, and the captain answers when ready. Use this for a real decision of the captain's, explained well, with a clear recommendation: design, scope or next-slice choices that aren't covered by a standing order, and a slice shipping or the goal being proposed for closing.

3 = INTERRUPT. The captain is told now. Use this for facts only the captain has; options with no recommendation where you can't get one; production data, permissions, money, licences, security, or anything outward-facing that isn't already approved; the lead contradicting a decision of the captain's; the goal's direction itself being in question; and anything under ALWAYS THE CAPTAIN'S below.
Unsure between 2 and 3: choose 3. Unsure between 1 and 4: choose 4. Unsure between 4 and 2: choose 2. Never use 1 or 4 for something under ALWAYS THE CAPTAIN'S.`;

const ORDERS_HEADING = "The captain's standing orders, learned from their past replies:";
const NO_ORDERS = "None yet: nothing has been learned from the captain's replies, so go by the rules above alone.";
const REPLY = 'Reply with JSON only: {"route":1|2|3|4,"why":"<one short line>","message":"<for route 4 only: exactly what you send the lead; otherwise empty>"}';

/** The judge's system prompt, with the captain's standing orders (the file's text) in their place, or none yet. */
export function judgeSystemPrompt(standingOrders?: string): string {
  return `${RULES}\n\n${ORDERS_HEADING}\n${standingOrders?.trim() || NO_ORDERS}\n\n\n${REPLY}\n`;
}

/** What the judge reads: the goal, and the end of what the lead said this turn. */
export const judgePrompt = (goal: string | undefined, tail: string): string => `Goal: ${goal || '(untitled)'}\n\nThe end of what the lead said:\n<<<\n${tail}\n>>>`;

/** Where the judge would send the turn, why, and (route 4) what it would say to the lead. */
export interface Verdict {
  route: CosRoute;
  why: string;
  message: string;
}

export const VERDICT_SCHEMA = {
  type: 'object',
  properties: { route: { type: 'integer', enum: [...ROUTES] }, why: { type: 'string' }, message: { type: 'string' } },
  required: ['route', 'why', 'message'],
  additionalProperties: false,
};

/** The judge's answer, if it's one: a route of the four and a reason; a message is kept for route 4 alone. */
export function parseVerdict(structured: unknown): Verdict | undefined {
  if (!isRecord(structured) || !isOneOf(ROUTES, structured.route) || typeof structured.why !== 'string' || !structured.why.trim()) return undefined;
  const message = structured.route === 4 && typeof structured.message === 'string' ? structured.message.trim() : '';
  return { route: structured.route, why: structured.why.trim(), message };
}
