import { isOneOf, isRecord } from '../../plugin-api/shared';
import { CREW, crewVersion } from './crew';
import { asksOf, CHECKS, type CosRoute, MAX_ASKS, MAX_REPLIES, MAX_REPLY_LABEL, ROUTES, type Verdict } from './shared';

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
    maxAsks: String(MAX_ASKS),
    maxReplies: String(MAX_REPLIES),
    maxReplyLabel: String(MAX_REPLY_LABEL),
    pinned: !!pinned,
    route: pinned ? String(pinned) : '',
    routeName: pinned ? CREW.text('judge', `route.${pinned}`, {}) : '',
  });
}

/**
 * What the judge reads: the goal, or what the turn is read against (`contextText`: what's agreed, the project's compass,
 * the captain's own words) when it has it, and the end of what the lead said this turn.
 */
export const judgePrompt = (goal: string | undefined, tail: string, context?: string): string =>
  `${context || `Goal: ${goal || '(untitled)'}`}\n\nThe end of what the lead said:\n<<<\n${tail}\n>>>`;

/** The verdict's shape; with `pinned`, the one route it may give. */
export const verdictSchema = (pinned?: CosRoute) => ({
  type: 'object',
  properties: {
    route: { type: 'integer', enum: pinned ? [pinned] : [...ROUTES] },
    check: { type: 'string', enum: [...CHECKS] },
    asks: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_ASKS,
      items: {
        type: 'object',
        properties: {
          ask: { type: 'string' },
          replies: {
            type: 'array',
            maxItems: MAX_REPLIES,
            items: { type: 'object', properties: { label: { type: 'string' }, text: { type: 'string' } }, required: ['label', 'text'], additionalProperties: false },
          },
          move: {
            type: 'object',
            properties: { what: { type: 'string' }, to: { type: 'string' }, brief: { type: 'string' }, pick: { type: 'string', enum: ['move', 'keep'] } },
            required: ['what', 'to', 'brief', 'pick'],
            additionalProperties: false,
          },
        },
        required: ['ask', 'replies'],
        additionalProperties: false,
      },
    },
    why: { type: 'string' },
    says: { type: 'string' },
    message: { type: 'string' },
  },
  required: ['route', 'check', 'asks', 'why', 'says', 'message'],
  additionalProperties: false,
});

export const VERDICT_SCHEMA = verdictSchema();

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * The judge's answer, if it's one: a route of the four, the check that decided it (left out if it gave none), a reason, its asks (each a headline
 * and the replies to it, `asksOf`; an answer from before there were several, with one `ask` and its `replies`, is a list of one), its reading for
 * the user (left out if it gave none), and the words it would send (empty if it gave none). With no ask, its reason stands in for one. A
 * turn with nothing for the user to decide (routes 1 and 4) keeps its first ask alone, and any that would move work (`movesOpen` makes those the user's).
 */
export function parseVerdict(structured: unknown): Verdict | undefined {
  if (!isRecord(structured) || !isOneOf(ROUTES, structured.route)) return undefined;
  const why = text(structured.why);
  if (!why) return undefined;
  const asks = asksOf(structured);
  const says = text(structured.says);
  const forLead = structured.route === 1 || structured.route === 4;
  return {
    route: structured.route,
    ...(isOneOf(CHECKS, structured.check) && { check: structured.check }),
    // a move is kept on any route, for `movesOpen` to put to the user (handoverRules.ts)
    asks: asks.length ? (forLead ? asks.filter((a, i) => i === 0 || a.move) : asks) : [{ ask: why }],
    why,
    ...(says && { says }),
    message: text(structured.message),
  };
}
