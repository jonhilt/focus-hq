import type { Agent, Lane, LedgerEvent, SliceRecap } from '../../plugin-api/shared';
import { higherLane, isOneOf, isRecord, LANE_SAID, LANES, laneName } from '../../plugin-api/shared';

// The chief of staff's read of a goal's lead's ship (README.md#raising-a-ships-lane): the lead picked the lane its
// pull requests merge in once QA passes them, and it may raise that lane, never lower it, from the slice's recap.
// Which ships it has still to read, what it reads, and the check on its answer. Pure, so it's tested (laneJudge.test.ts).

/** The prompt's version, kept on every `cos-lane` line so reads from different prompts aren't compared as one. */
export const LANE_JUDGE_VERSION = 'lane-v1';

const RULES = `You are the Chief of Staff aboard a software "ship". A goal's lead (an AI coding agent) has just shipped a slice of work as pull requests, and picked the lane they merge in once QA passes them:
- SHIP: merges by itself; the captain never looks at it.
- SHOW: merges by itself, and the captain is told it landed.
- ASK: waits for the captain to look at it and merge it.
The captain is the human who owns every goal. The lanes exist to save the captain's checking time, so a slice the captain wouldn't want to see first should not wait on them. But one they would must never merge unseen.

You may raise the lane (SHIP to SHOW or ASK, SHOW to ASK), never lower it. Read the slice's recap: the primitives (the system's building blocks) it touches, each composed (used as it is), extended (its behaviour or contract changed) or added; the invariants it could break; and what it does, in order.

Raise to ASK when the slice:
- changes what the captain sees or does in a way they haven't plainly asked for (a new screen, a changed flow, new words on a card);
- touches money, permissions, secrets, security, production data, or anything outward-facing (what's sent to other people or services);
- changes what agents may do by themselves (merging, sending, spending, deleting, starting work);
- deletes, migrates or rewrites stored data, or changes a format other things read;
- or its recap doesn't add up: the summary claims more than the primitives show, an invariant looks at risk, or it's too thin to judge.
Raise to SHOW when it's safe to merge but the captain would want to know it landed: a visible change they asked for, or a fix to something they reported.
Otherwise keep the lead's pick. Unsure whether to raise: raise.`;

const ORDERS_HEADING = "The captain's standing orders, learned from their past replies:";
const NO_ORDERS = "None yet: go by the rules above alone.";
const REPLY = `Reply with JSON only: {"lane":"ship"|"show"|"ask","why":"..."}
- lane: the lane you'd have it in: the lead's pick to keep it, or a higher one to raise it.
- why: a sentence or two, in plain words the captain understands without the goal open, saying why it goes in that lane. When you raise it, say what the captain would want to see.`;

/** The lane judge's system prompt, with the captain's standing orders in their place, or none yet. */
export function laneSystemPrompt(standingOrders?: string): string {
  return `${RULES}\n\n${ORDERS_HEADING}\n${standingOrders?.trim() || NO_ORDERS}\n\n${REPLY}\n`;
}

/** What it reads of a ship: the goal, the pull requests' title and description, and the slice's recap with the lead's pick. */
export function lanePrompt(ship: { goal: string; title?: string; summary?: string; recap: SliceRecap; lane: Lane }): string {
  const { recap } = ship;
  const lines = [
    `Goal: ${ship.goal || '(untitled)'}`,
    `Shipped as: ${ship.title ?? '(untitled)'}`,
    `The lead's pick: ${laneName(ship.lane)} (it ${LANE_SAID[ship.lane]})`,
    '',
    'What the lead said it does:',
    '<<<',
    ship.summary?.trim() || '(nothing)',
    '>>>',
    '',
    'Primitives touched:',
    ...recap.primitives.map((p) => `- ${p.id} (${p.group}), ${p.impact}: ${p.change}`),
  ];
  if (recap.invariants?.length) lines.push('', 'Invariants it could break:', ...recap.invariants.map((i) => `- ${i}`));
  if (recap.flow?.length) lines.push('', 'What happens, in order:', ...recap.flow.map((s) => `- ${s.from} → ${s.to}: ${s.label}`));
  return lines.join('\n');
}

export const LANE_SCHEMA = {
  type: 'object',
  properties: {
    lane: { type: 'string', enum: [...LANES] },
    why: { type: 'string' },
  },
  required: ['lane', 'why'],
  additionalProperties: false,
};

/** Its answer, if it's one: the lane it would have the ship in, never below the lead's pick (it only ever raises), and why. */
export function parseLane(structured: unknown, pick: Lane): { lane: Lane; why: string } | undefined {
  if (!isRecord(structured) || !isOneOf(LANES, structured.lane)) return undefined;
  const why = typeof structured.why === 'string' ? structured.why.trim() : '';
  if (!why) return undefined;
  return { lane: higherLane(pick, structured.lane), why };
}

type ShipPr = { repo: string; number: number; sha?: string; lane?: Lane; outcome?: unknown };

/** A pull request a lane read could still raise: open, in Ship or Show. Ask is as high as it goes. */
const raisable = (p: ShipPr): boolean => !p.outcome && (p.lane === 'ship' || p.lane === 'show');

/** Whether a `cos-lane` line read this pull request at the commit it's at now. */
const readAt = (ledger: readonly LedgerEvent[], p: ShipPr): boolean =>
  ledger.some((e) => e.kind === 'cos-lane' && e.prs.some((r) => r.repo === p.repo && r.pr === p.number && r.sha === p.sha));

/** A lead's ship it has still to read: their pull requests a read could raise, and none of the ledger's has read at its commit. */
export function unreadShip(lead: Pick<Agent, 'lead'>, ledger: readonly LedgerEvent[]): ShipPr[] {
  const prs = (lead.lead?.prs ?? []).filter(raisable);
  return prs.some((p) => !readAt(ledger, p)) ? prs : [];
}

/** Why Ops should hold a lead's pull request for now: one a read could raise, not yet read at its commit. */
export function heldForRead(pr: ShipPr | undefined, ledger: readonly LedgerEvent[]): string | undefined {
  return pr && raisable(pr) && !readAt(ledger, pr) ? 'the chief of staff hasn’t read its lane yet' : undefined;
}

/** The lead's pick for a ship: the lowest lane of its pull requests, since a raise only ever takes them higher. */
export function pickOf(prs: readonly ShipPr[]): Lane {
  return prs.reduce<Lane>((low, p) => (higherLane(low, p.lane ?? 'ask') === low ? p.lane ?? 'ask' : low), 'ask');
}
