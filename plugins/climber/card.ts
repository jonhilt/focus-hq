import type { Climb } from './shared';

const OUTCOME: Record<NonNullable<Climb['last']>['outcome'], string> = {
  merged: 'merged',
  closed: 'closed unmerged',
  nothing: 'found nothing to change',
  failed: 'failed',
};

/** What the climber's card on the engineering panel says (client.ts). */
export interface ClimbCard {
  keepClimbing: boolean;
  stoppedWhy: string | null;
  /** The climb's pull request, once it's opened. */
  pr: { number: number; url: string } | null;
  /** The climber at work, while they're aboard; or the pull request left waiting on the captain. */
  now: { kind: 'climbing'; id: string; name: string; activity: string } | { kind: 'waiting'; line: string } | null;
  /** How the last climb ended. */
  last: string | null;
  /** What climbing does, while nothing's under way. */
  intro: string | null;
}

type Climber = { id: string; name: string; activity: string; pr?: { number: number; url: string } };

/** The climber's card, from the plugin's state, Ops' agents (the climber is one while they're aboard) and how long ago a time was. */
export function climbCard(climb: Climb | undefined, agent: (id: string) => Climber | undefined, engineer: string, ago: (at: number) => string): ClimbCard {
  const climber = climb?.agentId ? agent(climb.agentId) : undefined;
  const pr = climb?.pr ?? climber?.pr ?? null;
  const last = climb?.last;
  return {
    keepClimbing: !!climb?.keepClimbing,
    stoppedWhy: climb?.stoppedWhy ?? null,
    pr,
    now: climber
      ? { kind: 'climbing', id: climber.id, name: climber.name, activity: climber.activity }
      : pr ? { kind: 'waiting', line: 'The climb’s pull request waits for you to merge or close it' } : null,
    last: last ? `Last climb${last.pr ? ` (PR #${last.pr})` : ''} ${OUTCOME[last.outcome]} ${ago(last.at)} · ${climb.cycles} so far` : null,
    intro: climber || pr
      ? null
      : `With Keep climbing on, ${engineer} takes the scorecard’s worst gap in Focus’s own repo, fixes it and opens one pull request with its numbers before and after. It never merges by itself: once you merge or close it, the next climb starts, in a fresh session.`,
  };
}
