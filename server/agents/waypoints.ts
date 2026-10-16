// A goal's slices as waypoints on its chart: what each set out to do, what it taught us, and when. The office keeps
// them as the lead ships, notes and lands each slice; these are the pure decisions, and the manager's parts call them.

import type { ChecksState, ClaudeTask, Evidence, GoalNote, LeadWork, Probe, QaReport, SpotCheck, Waypoint } from '../../shared/types';
import type { NoteInput } from './lead';

/** How much a waypoint keeps: they all travel with the goal on every update, so each stays a few lines long. */
export const WAYPOINT_LIMITS = { summary: 280, learned: 3, kept: 40, probes: 6, probeSummary: 200, tasks: 20, task: 120 } as const;

type Course = Pick<LeadWork, 'slice' | 'waypoints'>;

/** The goal's waypoints with this slice's (or `slice`'s) changed by `change`, adding it (starting now) when it isn't there yet. */
export function withWaypoint(work: Course, now: number, change: (w: Waypoint) => Waypoint, slice = work.slice): Waypoint[] {
  const all = work.waypoints ?? [];
  const here = all.find((w) => w.slice === slice);
  const next = change(here ?? { slice, startedAt: now });
  return (here ? all.map((w) => (w === here ? next : w)) : [...all, next]).slice(-WAYPOINT_LIMITS.kept);
}

/** The first paragraph of a pull request's description, as plain text, cut at a word to fit. */
export function opening(markdown: string, max: number = WAYPOINT_LIMITS.summary): string {
  const plain = (block: string) =>
    block
      .replace(/^\s*#+\s.*$/gm, '')
      .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, '')
      .replace(/[*_`>]/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  const text = markdown.split(/\n\s*\n/).map(plain).find(Boolean) ?? '';
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const word = cut.lastIndexOf(' ');
  return `${(word > max / 2 ? cut.slice(0, word) : cut).replace(/[\s,;:.]+$/, '')}…`;
}

/**
 * The waypoints once the slice ships: what it set out to do is the title and opening it first shipped with, as its pull
 * requests keep them (shipping again, to fix what QA found, say, updates their code but not what they say).
 */
export function shippedWaypoint(work: Course, input: { title: string; summary: string }, now: number): Waypoint[] {
  const title = input.title.replace(/\s+/g, ' ').trim();
  const summary = opening(input.summary);
  return withWaypoint(work, now, (w) => ({ ...w, ...(!w.title && title && { title }), ...(!w.summary && summary && { summary }) }));
}

/**
 * The slice a note is about: this one once it's shipped, but until then the last one that did, since the lead says what a
 * slice taught them (and turns the goal's course because of it) after it lands, by when the next one has begun.
 */
export function notedSlice(work: Course): number {
  const all = work.waypoints ?? [];
  if (all.find((w) => w.slice === work.slice)?.title) return work.slice;
  return all.filter((w) => w.slice < work.slice && w.title).at(-1)?.slice ?? work.slice;
}

/**
 * The waypoints once the lead updates the note: a lesson they add goes on the slice it's about, and so does what done
 * looked like before they changed it (the first time; changing it back is no correction at all).
 */
export function notedWaypoint(work: Course & Pick<LeadWork, 'note'>, input: NoteInput, after: GoalNote, now: number): Waypoint[] | undefined {
  const line = input.learned?.replace(/\s+/g, ' ').trim();
  const before = work.note?.done ?? '';
  if (!line && (!before || after.done === before)) return work.waypoints;
  return withWaypoint(work, now, (w) => {
    const next: Waypoint = { ...w, ...(line && { learned: [...(w.learned ?? []), line].slice(-WAYPOINT_LIMITS.learned) }) };
    const from = w.turnedFrom ?? before;
    if (from && after.done !== from) next.turnedFrom = from;
    else delete next.turnedFrom;
    return next;
  }, notedSlice(work));
}

/** The waypoints as the slice's last pull request lands. */
export const landedWaypoint = (work: Course, now: number): Waypoint[] => withWaypoint(work, now, (w) => ({ ...w, landedAt: w.landedAt ?? now }));

/** The waypoints as the next slice starts on fresh code: the last one has landed, and the next starts now. */
export function nextWaypoints(work: Course, now: number): Waypoint[] {
  return withWaypoint({ slice: work.slice + 1, waypoints: landedWaypoint(work, now) }, now, (w) => w);
}

/** A QA verdict on one of the slice's pull requests, and how CI stood on it then. */
export interface Verdict {
  repo: string;
  pr: number;
  report: QaReport;
  failedRounds: number;
  ci?: ChecksState;
  /** The screenshots QA took this round, already copied to the goal's own files. */
  evidence?: Evidence[];
}

const sameSpot = (a: SpotCheck, b: Omit<SpotCheck, 'checked'>) => a.repo === b.repo && a.pr === b.pr && a.file === b.file && a.line === b.line;

/**
 * The waypoints once QA gives its verdict on one of the slice's pull requests: its shield is that verdict (replacing the
 * last round's), and its spot-checks are this round's picks, keeping the tick on any the captain has already looked at.
 */
export function shieldedWaypoint(work: Course, v: Verdict, now: number): Waypoint[] {
  const checks = { pass: 0, fail: 0, skip: 0 };
  for (const c of v.report.checks) checks[c.result]++;
  const failing = v.report.checks.filter((c) => c.result === 'fail').map((c) => c.name).filter(Boolean);
  const shield = { repo: v.repo, pr: v.pr, verdict: v.report.verdict, checks, ...(failing.length && { failing }), failedRounds: v.failedRounds, ...(v.ci && { ci: v.ci }), at: now };
  return withWaypoint(work, now, (w) => {
    const picks = (v.report.spotChecks ?? []).map((c) => ({ ...c, repo: v.repo, pr: v.pr }));
    const kept = (w.spotChecks ?? []).filter((c) => c.repo !== v.repo || c.pr !== v.pr);
    const spotChecks = [...kept, ...picks.map((c) => {
      const checked = w.spotChecks?.find((old) => sameSpot(old, c))?.checked;
      return checked ? { ...c, checked } : c;
    })];
    const evidence = [...(w.evidence ?? []).filter((e) => e.repo !== v.repo || e.pr !== v.pr), ...(v.evidence ?? [])];
    return {
      ...w,
      shields: [...(w.shields ?? []).filter((x) => x.repo !== v.repo || x.pr !== v.pr), shield],
      ...(spotChecks.length && { spotChecks }),
      ...(evidence.length && { evidence }),
    };
  });
}

/** The waypoints once the captain ticks off (or un-ticks) the `index`th spot-check of `slice`'s, or why not. */
export function tickedSpotCheck(work: Pick<LeadWork, 'waypoints'>, slice: number, index: number, checked: boolean, now: number): Waypoint[] | { error: string } {
  const waypoints = work.waypoints ?? [];
  const w = waypoints.find((x) => x.slice === slice);
  const spotChecks = w?.spotChecks ?? [];
  const spot = spotChecks[index];
  if (!w || !spot) return { error: `There's no spot-check ${index + 1} on waypoint ${slice}` };
  const next = { ...spot, ...(checked && { checked: spot.checked ?? now }) };
  if (!checked) delete next.checked;
  return waypoints.map((x) => (x === w ? { ...w, spotChecks: spotChecks.map((c, i) => (i === index ? next : c)) } : x));
}

/** How many of each pull request's screenshots a waypoint keeps as evidence: QA's last few. */
export const EVIDENCE_PER_PR = 4;

/** What a screenshot is called among the goal's own files: the repo, pull request and its place, keeping QA's image type. */
export const evidenceFile = (repo: string, pr: number, index: number, shot: string): string =>
  `shot-${repo.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${pr}-${index + 1}.${/\.(png|svg)$/.exec(shot)?.[1] ?? 'jpg'}`;

/**
 * The waypoints once the lead sends a helper out, or runs a script from its scratch dir: a probe from the slice under way
 * (the same one twice is one probe).
 */
export function launchedProbe(work: Course, helper: { id: string; description: string; type?: string }, now: number): Waypoint[] {
  if (work.waypoints?.some((w) => w.probes?.some((p) => p.id === helper.id))) return work.waypoints ?? [];
  const probe: Probe = { id: helper.id, description: helper.description.replace(/\s+/g, ' ').trim() || 'Exploring', ...(helper.type && { type: helper.type }), launchedAt: now };
  // scripts come thick and fast: they keep the latest few of their own, so they never crowd out the helpers
  const script = (p: Probe) => p.type === 'script';
  return withWaypoint(work, now, (w) => {
    const all = [...(w.probes ?? []), probe];
    const kept = new Set([...all.filter(script).slice(-WAYPOINT_LIMITS.probes), ...all.filter((p) => !script(p)).slice(-WAYPOINT_LIMITS.probes)]);
    return { ...w, probes: all.filter((p) => kept.has(p)) };
  });
}

/** The waypoints once a helper reports back: its probe, wherever it was launched, ends with how it went and what it said. */
export function endedProbe(work: Course, helper: { id: string; ok: boolean; summary?: string }, now: number): Waypoint[] | undefined {
  const at = work.waypoints?.find((w) => w.probes?.some((p) => p.id === helper.id && !p.endedAt));
  if (!at) return undefined;
  const summary = helper.summary && opening(helper.summary, WAYPOINT_LIMITS.probeSummary);
  return withWaypoint(work, now, (w) => ({
    ...w,
    probes: (w.probes ?? []).map((p) => (p.id === helper.id ? { ...p, endedAt: now, ok: helper.ok, ...(summary && { summary }) } : p)),
  }), at.slice);
}

/** The waypoints once the lead commits during the slice under way: one more commit, with what it said. */
export function committedWaypoint(work: Course, message: string | undefined, now: number): Waypoint[] {
  const said = message?.split('\n')[0].trim();
  return withWaypoint(work, now, (w) => ({ ...w, commits: (w.commits ?? 0) + 1, ...(said && { lastCommit: opening(said, WAYPOINT_LIMITS.probeSummary) }) }));
}

/**
 * The waypoints once the lead's task list changes from `before` to `after`: the slice under way keeps each task the lead
 * added or moved on during it, as it now stands, and drops one it deleted. A task carried over from an earlier slice and
 * left alone isn't this slice's work; the waypoints are the same when nothing it keeps changed. A task kept from an
 * earlier list (a session before this one, which numbers its tasks from 1 again) is never this list's, even when its id
 * comes round again: it makes way under an id of its own.
 */
export function taskedWaypoint(work: Course, before: ClaudeTask[], after: ClaudeTask[], now: number): Waypoint[] | undefined {
  const was = new Map(before.map((t) => [t.id, t]));
  const ids = new Set(after.map((t) => t.id));
  const touched = after.filter((t) => was.get(t.id)?.subject !== t.subject || was.get(t.id)?.status !== t.status);
  const kept = work.waypoints?.find((w) => w.slice === work.slice)?.tasks ?? [];
  const gone = kept.filter((t) => was.has(t.id) && !ids.has(t.id));
  if (!touched.length && !gone.length) return work.waypoints;
  const keep = (t: ClaudeTask): ClaudeTask => ({ id: t.id, subject: opening(t.subject, WAYPOINT_LIMITS.task), status: t.status });
  const taken = new Set([...kept, ...after].map((t) => t.id));
  const aside = (id: string) => {
    let free = `${id}'`;
    while (taken.has(free)) free += "'";
    taken.add(free);
    return free;
  };
  const stays = kept.filter((t) => !gone.includes(t)).map((t) => {
    const moved = touched.find((n) => n.id === t.id);
    if (!moved) return t;
    return was.has(t.id) ? keep(moved) : { ...t, id: aside(t.id) };
  });
  const tasks = [...stays, ...touched.filter((t) => !stays.some((k) => k.id === t.id)).map(keep)].slice(-WAYPOINT_LIMITS.tasks);
  return withWaypoint(work, now, (w) => ({ ...w, tasks }));
}
