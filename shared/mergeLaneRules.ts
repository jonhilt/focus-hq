// How a lead's pull request merges once QA passes it (docs/merging.md#lanes-how-a-goals-leads-slice-merges): Ship
// merges by itself, Show merges and tells the captain, Ask waits for the captain. The lead picks the lane with each
// ship; the slice's recap sets the lowest it may be, and a lane is only ever raised (towards Ask), never lowered. Pure,
// so it's tested (mergeLaneRules.test.ts).

/** Lowest first: each lane asks more of the captain than the one before. */
export const LANES = ['ship', 'show', 'ask'] as const;
export type Lane = (typeof LANES)[number];

/** A slice's rollup (its riskiest primitive's impact), as the recap has it. */
type Rollup = 'composes' | 'extends' | 'adds';

const FLOOR: Record<Rollup, Lane> = { composes: 'ship', extends: 'show', adds: 'ask' };

/** The lowest lane a slice of this rollup may take: composing goes in Ship, extending Show, adding a primitive Ask. */
export function laneFloor(rollup: Rollup): Lane {
  return FLOOR[rollup];
}

/** The higher of two lanes. */
export function higherLane(a: Lane, b: Lane): Lane {
  return LANES.indexOf(a) >= LANES.indexOf(b) ? a : b;
}

/** Why the lead can't pick `lane` for a slice of this rollup, if they can't. */
export function laneProblem(lane: Lane, rollup: Rollup): string | undefined {
  const floor = laneFloor(rollup);
  if (higherLane(lane, floor) === lane) return undefined;
  return `A slice that ${rollup === 'adds' ? 'adds a primitive' : `${rollup} existing primitives`} goes in ${laneName(floor)} or higher, not ${laneName(lane)}: lanes are only ever raised`;
}

export function laneName(lane: Lane): string {
  return lane[0].toUpperCase() + lane.slice(1);
}

/** What the lane does once QA passes the PR, said in a few words. */
export const LANE_SAID: Record<Lane, string> = {
  ship: 'merges itself once QA passes it',
  show: 'merges itself once QA passes it, and tells the captain',
  ask: 'waits for the captain to merge it',
};

/** The same, said where anyone can read it (a pull request): in plain words, none of the ship’s (`wording.ts`). */
export const LANE_SAID_PUBLIC: Record<Lane, string> = {
  ship: 'merges itself once QA passes it',
  show: 'merges itself once QA passes it, and the maintainer is told',
  ask: 'waits for a maintainer to merge it',
};

/** What a raise does to a lead's pull requests (or just `only`): each still open in a lower lane goes up to `lane`, the rest as they were. */
export function raisedPrs<P extends { repo: string; number: number; lane?: Lane; outcome?: unknown }>(prs: readonly P[], lane: Lane, raised: { by: string; why: string }, only?: { repo: string; number: number }): { prs: P[]; from: Map<P, Lane> } {
  const from = new Map<P, Lane>();
  const next = prs.map((p) => {
    const was = p.lane ?? 'ask';
    if (p.outcome || higherLane(was, lane) === was || (only && !(p.repo === only.repo && p.number === only.number))) return p;
    const up = { ...p, lane, raised: { lane, ...raised } };
    from.set(up, was);
    return up;
  });
  return { prs: next, from };
}

/**
 * What Ops says on a pull request whose lane was raised. Not who raised it or why: the why is written for the captain,
 * in the ship's words, and stays in Focus (the ledger and the toast have it).
 */
export function raisedSaid(from: Lane, to: Lane): string {
  return `⬆ This pull request's merge lane was raised from ${laneName(from)} to ${laneName(to)}: it ${LANE_SAID_PUBLIC[to]}.`;
}
