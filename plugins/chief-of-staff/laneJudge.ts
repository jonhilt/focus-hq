import type { Agent, Lane, LedgerEvent, SliceRecap } from '../../plugin-api/shared';
import { higherLane, isOneOf, isRecord, LANE_SAID, LANES, laneName } from '../../plugin-api/shared';
import { CREW, crewVersion } from './crew';

// The chief of staff's read of a goal's lead's pull request (README.md#raising-a-pull-requests-lane): the lead picked the
// lane it merges in once QA passes it, and it may raise that lane, never lower it, from the recap the lead put on it.
// Which it has still to read, what it reads, and the check on its answer. Pure, so it's tested (laneJudge.test.ts).

/** The prompt's version, kept on every `cos-lane` line so reads from different prompts aren't compared as one. */
export const laneJudgeVersion = (): string => crewVersion('lane');

/** The lane judge's system prompt (crew/lane.md), with the captain's standing orders in their place, or none yet. */
export function laneSystemPrompt(standingOrders?: string): string {
  return CREW.prompt('lane', { orders: standingOrders?.trim() || CREW.text('lane', 'noOrders', {}) });
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

/** A goal's lead's pull request, as the lead's work has it. */
export type GoalPr = NonNullable<Agent['lead']>['prs'][number];

/** A pull request a lane read could still raise: open, in Ship or Show. Ask is as high as it goes. */
const raisable = (p: ShipPr): boolean => !p.outcome && (p.lane === 'ship' || p.lane === 'show');

type LaneRead = Extract<LedgerEvent, { kind: 'cos-lane' }>;

/** The latest `cos-lane` line that read this pull request at the commit it's at now, if one has. */
const readAt = (ledger: readonly LedgerEvent[], p: ShipPr): LaneRead | undefined =>
  ledger.findLast((e): e is LaneRead => e.kind === 'cos-lane' && e.prs.some((r) => r.repo === p.repo && r.pr === p.number && r.sha === p.sha));

/** Whether a read took this pull request higher than the lane it's in: the raise was lost (Focus went down before it was saved). */
const unapplied = (read: LaneRead, p: ShipPr): boolean => higherLane(p.lane ?? 'ask', read.to) !== (p.lane ?? 'ask');

/** The lead's pull requests it has still to read: each a read could raise (its recap picked Ship or Show), unread at its commit. */
export function unreadShip(lead: Pick<Agent, 'lead'>, ledger: readonly LedgerEvent[]): GoalPr[] {
  return (lead.lead?.prs ?? []).filter((p) => raisable(p) && !readAt(ledger, p));
}

/** The raises the ledger has that a lead's pull requests don't (lost to a restart), to take again, each on its own pull request. */
export function lostRaises(lead: Pick<Agent, 'lead'>, ledger: readonly LedgerEvent[]): { pr: GoalPr; lane: Lane; why: string }[] {
  return (lead.lead?.prs ?? []).filter(raisable).flatMap((pr) => {
    const read = readAt(ledger, pr);
    return read && unapplied(read, pr) ? [{ pr, lane: read.to, why: read.why }] : [];
  });
}

/** Why Ops should hold a lead's pull request for now: one a read could raise, not yet read at its commit, or raised by a read and not yet in its lane. */
export function heldForRead(pr: ShipPr | undefined, ledger: readonly LedgerEvent[]): string | undefined {
  if (!pr || !raisable(pr)) return undefined;
  const read = readAt(ledger, pr);
  if (!read) return 'the chief of staff hasn’t read its lane yet';
  return unapplied(read, pr) ? `the chief of staff raised it to ${laneName(read.to)}` : undefined;
}

