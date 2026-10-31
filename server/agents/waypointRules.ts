// A goal's open waypoints, as the lead names them: which pull requests make each one, the waypoint it's stacked on, and
// what lands when one of its pull requests merges or closes. The engine sets no order and no cap; it records what the
// lead says and lands each waypoint whole. Pure: goalPrs.ts runs them and keeps what they give back.

import type { LeadPr, LeadWork, PreviewRef } from '../../shared/types';
import { withWaypoint } from './waypoints';

type Work = Pick<LeadWork, 'slice' | 'prs' | 'landed' | 'waypoints'>;

/** The waypoint a pull request of the goal's is part of: the one the lead named for it, else the one under way. */
export const waypointOf = (pr: Pick<LeadPr, 'slice'>, work: Pick<LeadWork, 'slice'>): number => pr.slice ?? work.slice;

/**
 * The waypoint one of the goal's pull requests is part of, open or landed: news of one (a QA verdict, say) that comes
 * after its waypoint landed still goes on that waypoint. The one under way for a pull request the goal doesn't hold.
 */
export function waypointFor(work: Pick<LeadWork, 'slice' | 'prs' | 'landed'>, repo: string, number: number): number {
  const pr = [...work.prs, ...(work.landed ?? [])].find((p) => p.repo === repo && p.number === number);
  return pr ? waypointOf(pr, work) : work.slice;
}

/** The waypoints still open: the one under way, and every one with a pull request that hasn't landed, lowest first. */
export function openWaypoints(work: Pick<LeadWork, 'slice' | 'prs'>): number[] {
  return [...new Set([work.slice, ...work.prs.map((p) => waypointOf(p, work))])].sort((a, b) => a - b);
}

/** What the lead names with mcp__office__waypoint: these pull requests make `waypoint` (a new one when it's left out), stacked `on` an earlier one. */
export interface WaypointInput {
  prs: { repo: string; number: number }[];
  waypoint?: number;
  on?: number;
}

export type Named = { kind: 'named'; work: Pick<LeadWork, 'slice' | 'prs' | 'waypoints'>; waypoint: number; said: string } | { kind: 'refused'; why: string };

const where = (p: { repo: string; number: number }) => `${p.repo}#${p.number}`;

/**
 * The goal's work once the lead names a waypoint, or why not. Left out, `waypoint` is the one under way while it holds no
 * other pull request (its first), else a new one after it, which becomes the one under way. `on` is the open waypoint
 * below it, when it builds on one; left out, it sits on the base branch. A waypoint is never left with no pull requests
 * (or only merged or closed ones, which never land) by moving them out of it, except the one under way, which fills as the lead ships.
 */
export function named(work: Work, input: WaypointInput, now: number): Named {
  if (!input.prs.length) return { kind: 'refused', why: 'Name at least one pull request' };
  const held = input.prs.map((p) => work.prs.find((x) => x.repo === p.repo && x.number === p.number && !x.outcome));
  const missing = input.prs.filter((_, i) => !held[i]);
  if (missing.length) return { kind: 'refused', why: `${missing.map(where).join(', ')} ${missing.length > 1 ? "aren't" : "isn't"} one of this goal's open pull requests: Ops follows one you opened within a minute of it opening` };
  const moving = new Set(held);
  const open = openWaypoints(work);
  const othersUnderWay = work.prs.some((p) => !moving.has(p) && waypointOf(p, work) === work.slice);
  const waypoint = input.waypoint ?? (othersUnderWay ? work.slice + 1 : work.slice);
  if (input.waypoint !== undefined && !open.includes(input.waypoint)) {
    return { kind: 'refused', why: `Waypoint ${input.waypoint} isn't open: the open ones are ${open.join(', ')}. Leave waypoint out to start a new one.` };
  }
  if (input.on !== undefined && (input.on >= waypoint || !open.includes(input.on))) {
    return { kind: 'refused', why: `Waypoint ${waypoint} can only be on an open waypoint below it${open.some((n) => n < waypoint) ? `: ${open.filter((n) => n < waypoint).join(', ')}` : ', and there are none'}` };
  }
  const emptied = open.filter((n) => n !== waypoint && n !== work.slice && !work.prs.some((p) => waypointOf(p, work) === n && !p.outcome && !moving.has(p)));
  if (emptied.length) return { kind: 'refused', why: `That would leave waypoint ${emptied.join(', ')} with no open pull request, so it could never land: name its others too, or leave them where they are` };
  // the others keep the waypoint they're in, which stops being the one under way when a new one starts
  const prs = work.prs.map((p) => ({ ...p, slice: moving.has(p) ? waypoint : waypointOf(p, work) }));
  const slice = Math.max(work.slice, waypoint);
  const waypoints = withWaypoint({ slice, waypoints: work.waypoints }, now, (w) => {
    const next = { ...w, ...(input.on !== undefined && { on: input.on }) };
    if (input.on === undefined) delete next.on;
    return next;
  }, waypoint);
  return { kind: 'named', work: { slice, prs, waypoints }, waypoint, said: `Waypoint ${waypoint}${input.on !== undefined ? `, on waypoint ${input.on}` : ', on the base branch'}: ${input.prs.map(where).join(', ')}.` };
}

export type Landing =
  | { kind: 'open'; work: Pick<LeadWork, 'prs'> }
  | { kind: 'landed'; work: Pick<LeadWork, 'slice' | 'prs' | 'landed' | 'waypoints'>; waypoint: number; prs: LeadPr[] };

/**
 * The goal's work once one of its pull requests merges or closes. When that was the last of its waypoint's to, the
 * waypoint lands whole: its pull requests go to the landed ones and it's marked landed, while the others stay open. When
 * the one that landed is the one under way, the next one starts.
 */
export function landing(work: Work, repo: string, number: number, merged: boolean, now: number): Landing {
  const pr = work.prs.find((p) => p.repo === repo && p.number === number);
  const prs = work.prs.map((p) => (p === pr ? { ...p, outcome: merged ? ('merged' as const) : ('closed' as const) } : p));
  if (!pr) return { kind: 'open', work: { prs } };
  const waypoint = waypointOf(pr, work);
  const its = prs.filter((p) => waypointOf(p, work) === waypoint);
  if (!its.every((p) => p.outcome)) return { kind: 'open', work: { prs } };
  const done = its.map((p) => ({ ...p, slice: waypoint }));
  const marked = withWaypoint(work, now, (w) => ({ ...w, landedAt: w.landedAt ?? now }), waypoint);
  const slice = waypoint === work.slice ? work.slice + 1 : work.slice;
  return {
    kind: 'landed',
    waypoint,
    prs: done,
    work: {
      slice,
      prs: prs.filter((p) => waypointOf(p, work) !== waypoint),
      landed: [...(work.landed ?? []), ...done],
      waypoints: slice === work.slice ? marked : withWaypoint({ slice, waypoints: marked }, now, (w) => w),
    },
  };
}

/**
 * A closed goal's pull requests split for reopening it: the ones of waypoints still open (the one it was on, and any with
 * a pull request that hadn't merged or closed) and the ones of waypoints that had landed.
 */
export function splitLanded(prs: LeadPr[], slice: number): { open: LeadPr[]; landed: LeadPr[] } {
  const stillOpen = new Set([slice, ...prs.filter((p) => !p.outcome).map((p) => p.slice ?? slice)]);
  return { open: prs.filter((p) => stillOpen.has(p.slice ?? slice)), landed: prs.filter((p) => !stillOpen.has(p.slice ?? slice)) };
}

/**
 * Where each of the goal's repos is checked out for a holodeck at waypoint `n`: at the pull request of the highest
 * waypoint at or below `n` that touches the repo, pinned to the commit it last shipped; at the base branch when that
 * one has merged (the base has it), or when no waypoint up to `n` touches the repo. A pull request closed unmerged
 * changes nothing.
 */
export function waypointSet(work: Pick<LeadWork, 'slice' | 'prs' | 'landed' | 'repos'>, n: number): Record<string, PreviewRef> {
  const all = [...work.prs, ...(work.landed ?? [])].filter((p) => p.outcome !== 'closed' && waypointOf(p, work) <= n);
  return Object.fromEntries(work.repos.map((r) => {
    const top = all.filter((p) => p.repo === r.repo).sort((a, b) => waypointOf(b, work) - waypointOf(a, work) || b.number - a.number)[0];
    const ref: PreviewRef = !top || top.outcome === 'merged' ? { branch: r.baseBranch } : { pr: top.number, ...(top.sha && { sha: top.sha }) };
    return [r.repo, ref];
  }));
}
