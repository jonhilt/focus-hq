import { isOneOf, isRecord } from '../../plugin-api/shared';
import { CREW, crewVersion } from './crew';
import { type CosRoute, MAX_REPLIES, MAX_REPLY_LABEL, repliesOf, ROUTES, type Verdict } from './shared';

export type { Verdict } from './shared';

// The chief of staff's judge (README.md): the prompt it judges a lead's turn by (crew/judge.md: principles P1-P7, which
// the backtest held to keep a third fewer of the turns that needed the captain from them than the listed rules before
// them did, README.md#the-four-routes-from-its-principles), the shape of its answer, and the check on what came back.
// The captain's standing orders are theirs, not the repo's: they're read from the plugin's own folder as it runs
// (`STANDING_ORDERS`), and the prompt says there are none when there aren't.

/** The prompt's version, kept on every verdict so verdicts from different prompts aren't compared as one. */
export const judgeVersion = (): string => crewVersion('judge');

/** The captain's standing orders, in the plugin's own folder (`host.dataDir()`): private, never in the repo. */
export const STANDING_ORDERS = 'standing-orders.txt';

/**
 * The judge's system prompt, with the captain's standing orders (the file's text) in their place, or none yet; with
 * `pinned`, the route is decided and it only writes the words.
 */
export function judgeSystemPrompt(standingOrders?: string, pinned?: CosRoute): string {
  return CREW.prompt('judge', {
    orders: standingOrders?.trim() || CREW.text('judge', 'noOrders', {}),
    maxReplies: String(MAX_REPLIES),
    maxReplyLabel: String(MAX_REPLY_LABEL),
    pinned: !!pinned,
    route: pinned ? String(pinned) : '',
    routeName: pinned ? CREW.text('judge', `route.${pinned}`, {}) : '',
  });
}

/** What the judge reads: the goal, and the end of what the lead said this turn. */
export const judgePrompt = (goal: string | undefined, tail: string): string => `Goal: ${goal || '(untitled)'}\n\nThe end of what the lead said:\n<<<\n${tail}\n>>>`;

/** The verdict's shape; with `pinned`, the one route it may give. */
export const verdictSchema = (pinned?: CosRoute) => ({
  type: 'object',
  properties: {
    route: { type: 'integer', enum: pinned ? [pinned] : [...ROUTES] },
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
});

export const VERDICT_SCHEMA = verdictSchema();

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
