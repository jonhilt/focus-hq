// Stacked waypoints: the branch a waypoint's pull request in one repo is cut from, and what holds it back from landing
// before the waypoint it's on. Pure: the merge gate and goalPrs.ts ask them.

import type { LeadPr, LeadWork, PullRequest } from '../../shared/types';
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

/**
 * Why the merge gate holds one of the goal's pull requests, if it does: a waypoint lands only after the ones it's stacked
 * on, and only once Ops has moved it onto the branch it's to land on (`restackPlan`).
 */
export function landingHold(work: Work, pr: Pick<LeadPr, 'repo' | 'number'>): string | undefined {
  const held = work.prs.find((p) => p.repo === pr.repo && p.number === pr.number);
  if (!held) return undefined;
  const below = stackBelow(work, waypointOf(held, work));
  if (below.length) return `it waits on waypoint ${below[0]}, which its waypoint is stacked on, to land first`;
  const want = stackBase(work, held.repo, waypointOf(held, work));
  if (!held.stackedOn || held.stackedOn.branch === want) return undefined;
  return held.stackedOn.stuck ? `it needs moving onto \`${want}\` first, which its lead has been asked to do` : `Ops is moving it onto \`${want}\` first`;
}

type StackedOn = NonNullable<LeadPr['stackedOn']>;
type Where = Pick<LeadPr, 'repo' | 'number'>;

/** One step of moving a goal's stacked pull requests along (`restackPlan`). */
export type RestackStep =
  /** Where it sits now, kept without moving anything: what a later move replays its own commits from. */
  | (Where & { kind: 'record'; stackedOn: StackedOn })
  /** Move `branch` onto `onto`, replaying its commits since `upstream`; then it's `stackedOn`, and its pull request based on `retarget`. `head` is its head on the board. */
  | (Where & { kind: 'restack'; branch: string; onto: string; upstream: string; head: string; stackedOn: StackedOn; retarget?: string })
  /** It sits where it should, but its pull request is based on another branch. */
  | (Where & { kind: 'retarget'; base: string })
  /** It needs moving onto `onto`, but where its own commits start isn't known: the lead hears so, once while it's `stuck` there. */
  | (Where & { kind: 'no-upstream'; branch: string; onto: string; stuck: { lower: string; head: string } });

export type RestackPlan = { kind: 'none' } | { kind: 'steps'; steps: RestackStep[] };

/**
 * What moves a goal's stacked pull requests along when the branch below one gets a push or lands, from what Ops kept
 * (`stackedOn`) and the board as it is: level-triggered, so running it again after a restart, or after its steps were
 * taken, asks only for what's still to do. Lowest waypoints first.
 */
export function restackPlan(work: Work & Pick<LeadWork, 'landed'>, board: readonly PullRequest[]): RestackPlan {
  // one named on another waypoint, landed or not: one that landed before Ops saw where it sat still needs moving
  const stacked = (p: LeadPr) => work.waypoints?.find((w) => w.slice === waypointOf(p, work))?.on !== undefined;
  const open = work.prs.filter((p) => !p.outcome && p.branch && (p.stackedOn || stacked(p)));
  const steps = [...open].sort((a, b) => waypointOf(a, work) - waypointOf(b, work)).flatMap((p) => stepsFor(work, board, p));
  return steps.length ? { kind: 'steps', steps } : { kind: 'none' };
}

/** The steps for one of the goal's pull requests: nothing while it's off the board. */
function stepsFor(work: Work & Pick<LeadWork, 'landed'>, board: readonly PullRequest[], p: LeadPr): RestackStep[] {
  const on = board.find((b) => b.repo === p.repo && b.number === p.number);
  if (!on || !p.branch) return [];
  const base = work.repos.find((r) => r.repo === p.repo)?.baseBranch ?? 'main';
  // the head of the open pull request on `branch`, which another sits on: '' for the repo's base branch, or one gone (one
  // the goal knows has landed is gone, whatever a board read before it landed says)
  const gone = (b: PullRequest) => [...work.prs, ...(work.landed ?? [])].some((l) => l.repo === b.repo && l.number === b.number && l.outcome);
  const headOf = (branch: string) => (branch === base ? '' : board.find((b) => b.repo === p.repo && b.branch === branch && !gone(b))?.headSha ?? '');
  const want = stackBase(work, p.repo, waypointOf(p, work));
  const lower = headOf(want);
  const head = on.headSha ?? '';
  const retarget = on.baseBranch !== want ? want : undefined;
  const where = { repo: p.repo, number: p.number };
  // first seen: where it sits now, by its pull request's base
  const recorded: RestackStep[] = p.stackedOn ? [] : [{ kind: 'record', ...where, stackedOn: { branch: on.baseBranch, sha: headOf(on.baseBranch) } }];
  const s = p.stackedOn ?? { branch: on.baseBranch, sha: headOf(on.baseBranch) };
  const pointed: RestackStep[] = retarget ? [{ kind: 'retarget', ...where, base: retarget }] : [];
  if (s.branch === want && s.sha === lower) return [...recorded, ...pointed];
  // stuck where it is until the branch below or its own head moves
  if (s.stuck && s.stuck.lower === lower && s.stuck.head === head) return recorded;
  const stackedOn = { branch: want, sha: lower };
  if (s.sha) return [...recorded, { kind: 'restack', ...where, branch: p.branch, onto: want, upstream: s.sha, head, stackedOn, ...(retarget && { retarget }) }];
  // told to move it themselves, the lead pushed it: it's where they put it
  if (s.stuck && s.stuck.head !== head) return [...recorded, { kind: 'record', ...where, stackedOn }, ...pointed];
  return [...recorded, { kind: 'no-upstream', ...where, branch: p.branch, onto: want, stuck: { lower, head } }];
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
