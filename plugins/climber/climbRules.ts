import type { Agent, AgentStatus, Project } from '../../plugin-api/server';
import type { ShortlistEntry } from './climb';
import type { Climb } from './shared';

// The climber's decisions (README.md): what to do about the climb now, where the climbs are, and how a climb's
// shortlist ranks its gaps. Pure, so it's tested (climbRules.test.ts).

const FINISHED: AgentStatus[] = ['done', 'error', 'stopped'];

const SIZE_ORDER = { S: 0, M: 1, L: 2 } as const;

/** A gap's score: harm counts double, then distance; size only breaks a tie (smaller first). */
export const gapScore = (e: Pick<ShortlistEntry, 'harm' | 'distance'>) => 2 * e.harm + e.distance;

/** A shortlist best first, by the brief's rule: score, then the smaller change. */
export function ranked<T extends ShortlistEntry>(entries: T[]): T[] {
  return [...entries].sort((a, b) => gapScore(b) - gapScore(a) || SIZE_ORDER[a.size] - SIZE_ORDER[b.size]);
}

/**
 * What to do about the climb now: start one (climbing is on and none is open), wait for the one under way (its
 * climber is working, or its pull request is open), or stop climbing because the last one ended without a pull
 * request. `climber` is the climbing engineer while they're aboard: a new climb also waits while they're still
 * busy with the last (a pull request closed while they were fixing QA's findings), since every climb is theirs.
 */
export type ClimbStep = { kind: 'start' } | { kind: 'wait' } | { kind: 'stop'; why: string; outcome: 'nothing' | 'failed' } | { kind: 'idle' };

export function climbStep(climb: Climb, climber: Pick<Agent, 'status' | 'pr' | 'error' | 'activity'> | undefined): ClimbStep {
  if (climb.pr) return { kind: 'wait' };
  if (climb.agentId) {
    if (!climber) return { kind: 'stop', why: 'The climber went home before opening a pull request', outcome: 'failed' };
    if (!FINISHED.includes(climber.status)) return { kind: 'wait' };
    if (climber.pr) return { kind: 'wait' };
    if (climber.status === 'done') return { kind: 'stop', why: `The last climb found nothing to change: ${climber.activity}`, outcome: 'nothing' };
    return { kind: 'stop', why: `The last climb ${climber.status === 'stopped' ? 'was stopped' : 'failed'}${climber.error ? `: ${climber.error}` : ''}`, outcome: 'failed' };
  }
  if (!climb.keepClimbing) return { kind: 'idle' };
  return climber && !FINISHED.includes(climber.status) ? { kind: 'wait' } : { kind: 'start' };
}

/**
 * Where the climbs are: the project with Focus's own repo (`ownRepo`, from its checkout's remote). The demo ship
 * has no repo of its own, so it climbs its first project's first repo.
 */
export function climbHome(projects: Pick<Project, 'id' | 'repos'>[], ownRepo: string | undefined, demo: boolean): { projectId: string; repo: string } | undefined {
  const own = ownRepo && projects.find((p) => p.repos.includes(ownRepo));
  if (own && ownRepo) return { projectId: own.id, repo: ownRepo };
  const first = demo ? projects.find((p) => p.repos.length) : undefined;
  return first && { projectId: first.id, repo: first.repos[0] };
}
