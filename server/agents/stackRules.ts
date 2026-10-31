// Stacked waypoints: the branch a waypoint's pull request in one repo is cut from, and what holds it back from landing
// before the waypoint it's on. Pure: the merge gate and goalPrs.ts ask them.

import type { LeadPr, LeadWork } from '../../shared/types';
import { openWaypoints, waypointOf } from './waypointRules';

type Work = Pick<LeadWork, 'slice' | 'prs' | 'waypoints' | 'repos'>;

/** The open waypoints `waypoint` is stacked on, nearest first: its `on`, that one's `on`, and so on while they're open. */
export function stackBelow(work: Pick<LeadWork, 'slice' | 'prs' | 'waypoints'>, waypoint: number): number[] {
  const open = new Set(openWaypoints(work));
  const below: number[] = [];
  for (let on = work.waypoints?.find((w) => w.slice === waypoint)?.on; on !== undefined && open.has(on) && !below.includes(on); on = work.waypoints?.find((w) => w.slice === on)?.on) {
    below.push(on);
  }
  return below;
}

/**
 * The branch `waypoint`'s pull request in `repo` is cut from, and based on: the branch of the nearest waypoint below it
 * in its stack with an open pull request in that repo, else the repo's base branch.
 */
export function stackBase(work: Work, repo: string, waypoint: number): string {
  for (const n of stackBelow(work, waypoint)) {
    const under = work.prs.find((p) => p.repo === repo && !p.outcome && waypointOf(p, work) === n && p.branch);
    if (under?.branch) return under.branch;
  }
  return work.repos.find((r) => r.repo === repo)?.baseBranch ?? 'main';
}

/** Why the merge gate holds one of the goal's pull requests, if it does: a waypoint lands only after the ones it's stacked on. */
export function landingHold(work: Pick<LeadWork, 'slice' | 'prs' | 'waypoints'>, pr: Pick<LeadPr, 'repo' | 'number'>): string | undefined {
  const held = work.prs.find((p) => p.repo === pr.repo && p.number === pr.number);
  if (!held) return undefined;
  const below = stackBelow(work, waypointOf(held, work));
  return below.length ? `it waits on waypoint ${below[0]}, which its waypoint is stacked on, to land first` : undefined;
}

/**
 * What the lead hears of a stacked waypoint's bases as they name it: the branch each of its pull requests is to be cut
 * from and based on (`gh pr edit --base`), where that isn't the repo's base branch. Nothing for one on the base branch.
 */
export function basesSaid(work: Work, waypoint: number): string {
  const bases = work.prs.filter((p) => !p.outcome && waypointOf(p, work) === waypoint).flatMap((p) => {
    const base = stackBase(work, p.repo, waypoint);
    return base === work.repos.find((r) => r.repo === p.repo)?.baseBranch ? [] : [`${p.repo}#${p.number} on \`${base}\``];
  });
  return bases.length ? ` Base ${bases.length > 1 ? 'them' : 'it'} on the waypoint below's branch: ${bases.join(', ')}.` : '';
}
