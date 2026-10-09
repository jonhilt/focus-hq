// A goal's slices as waypoints on its chart: what each set out to do, what it taught us, and when. The office keeps
// them as the lead ships, notes and lands each slice; these are the pure decisions, and the manager's parts call them.

import type { GoalNote, LeadWork, Waypoint } from '../../shared/types';
import type { NoteInput } from './lead';

/** How much a waypoint keeps: they all travel with the goal on every update, so each stays a few lines long. */
export const WAYPOINT_LIMITS = { summary: 280, learned: 3, kept: 40 } as const;

type Course = Pick<LeadWork, 'slice' | 'waypoints'>;

/** The goal's waypoints with this slice's changed by `change`, adding it (starting now) when it isn't there yet. */
export function withWaypoint(work: Course, now: number, change: (w: Waypoint) => Waypoint): Waypoint[] {
  const all = work.waypoints ?? [];
  const here = all.find((w) => w.slice === work.slice);
  const next = change(here ?? { slice: work.slice, startedAt: now });
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

/** The waypoints once the slice ships: what it set out to do is the title and opening it last shipped with. */
export function shippedWaypoint(work: Course, input: { title: string; summary: string }, now: number): Waypoint[] {
  const title = input.title.replace(/\s+/g, ' ').trim();
  const summary = opening(input.summary);
  return withWaypoint(work, now, (w) => ({ ...w, ...(title && { title }), ...(summary && { summary }) }));
}

/**
 * The waypoints once the lead updates the note: a lesson they add goes on this slice's, and so does what done looked
 * like before they changed it (the first time this slice; changing it back is no correction at all).
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
  });
}

/** The waypoints as the slice's last pull request lands. */
export const landedWaypoint = (work: Course, now: number): Waypoint[] => withWaypoint(work, now, (w) => ({ ...w, landedAt: w.landedAt ?? now }));

/** The waypoints as the next slice starts on fresh code: the last one has landed, and the next starts now. */
export function nextWaypoints(work: Course, now: number): Waypoint[] {
  return withWaypoint({ slice: work.slice + 1, waypoints: landedWaypoint(work, now) }, now, (w) => w);
}
