import type { Lane, SliceRecap } from '../../plugin-api/shared';
import { higherLane, isOneOf, isRecord, LANE_SAID, LANES, laneName } from '../../plugin-api/shared';
import { CREW, crewVersion } from './crew';

// The chief of staff's read of a goal's lead's pull request (README.md#raising-a-pull-requests-lane): the lead picked the
// lane it merges in once QA passes it, and it may raise that lane, never lower it, from the recap the lead put on it.
// What it reads, and the check on its answer (laneJudge.test.ts); which it has still to read is laneRules.ts'.

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
