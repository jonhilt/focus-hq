// The video a goal is making, kept by its lead through the studio tool and shown in the studio holodeck
// (docs/studio.md): its premise, what the viewer should come away with, its beats, and the gaps in what we know that it
// needs filled. These are the pure decisions; `GoalTools.studio` calls them.

import type { Studio, StudioGap } from '../../shared/types';

/** How long each part may be, how many beats a video has room for, and how many gaps may be open at once (and are kept). */
export const STUDIO_LIMITS = { premise: 300, takeaway: 200, beats: 12, beatTitle: 60, point: 200, gap: 160, answer: 200, open: 8, kept: 30 } as const;

/** What the studio tool can send: each field replaces what was there, except gap and closeGap, which log and close one. */
export interface StudioInput {
  premise?: string;
  takeaway?: string;
  beats?: { title: string; point?: string }[];
  gap?: string;
  closeGap?: { id: string; as: 'answered' | 'dropped'; answer?: string };
}

const clean = (text: string) => text.replace(/\s+/g, ' ').trim();
const listed = (gaps: readonly StudioGap[]) => gaps.filter((g) => !g.closed).map((g) => `${g.id} (${g.text})`).join(', ') || 'none';

/** The studio after the lead's change, or why it was refused (then nothing changes). It starts with its premise. */
export function applyStudio(studio: Studio | undefined, input: StudioInput, now: number): Studio | { error: string } {
  const L = STUDIO_LIMITS;
  const premise = input.premise !== undefined ? clean(input.premise) : studio?.premise;
  if (!premise) return { error: 'Start with the premise: the video’s basic idea, in a sentence or two.' };
  if (premise.length > L.premise) return { error: `The premise is ${premise.length} characters (at most ${L.premise}).` };
  const takeaway = input.takeaway !== undefined ? clean(input.takeaway) : studio?.takeaway;
  if (takeaway && takeaway.length > L.takeaway) return { error: `The takeaway is ${takeaway.length} characters (at most ${L.takeaway}).` };
  const beats = input.beats?.map((b) => ({ title: clean(b.title), ...(b.point?.trim() && { point: clean(b.point) }) })) ?? studio?.beats ?? [];
  if (beats.length > L.beats) return { error: `There are ${beats.length} beats (at most ${L.beats}): merge some.` };
  if (beats.some((b) => !b.title)) return { error: 'Every beat needs a title.' };
  const long = beats.find((b) => b.title.length > L.beatTitle || (b.point?.length ?? 0) > L.point);
  if (long) return { error: `Beat “${long.title.slice(0, 30)}” is too long (titles at most ${L.beatTitle} characters, points ${L.point}).` };
  const gaps = applyGaps(studio?.gaps ?? [], input, now);
  if ('error' in gaps) return gaps;
  return { premise, ...(takeaway && { takeaway }), beats, gaps, at: now };
}

function applyGaps(gaps: StudioGap[], input: StudioInput, now: number): StudioGap[] | { error: string } {
  const L = STUDIO_LIMITS;
  let all = gaps;
  if (input.closeGap) {
    const { id, as } = input.closeGap;
    const found = all.find((g) => g.id === id.trim());
    if (!found) return { error: `There's no gap ${id}. Open gaps: ${listed(all)}.` };
    if (found.closed) return { error: `Gap ${found.id} was already ${found.closed.as}.` };
    const answer = clean(input.closeGap.answer ?? '');
    if (answer.length > L.answer) return { error: `The answer is ${answer.length} characters (at most ${L.answer}).` };
    all = all.map((g) => (g === found ? { ...g, closed: { as, ...(answer && { answer }), at: now } } : g));
  }
  const text = clean(input.gap ?? '');
  if (text) {
    if (text.length > L.gap) return { error: `The gap is ${text.length} characters (at most ${L.gap}).` };
    const open = all.filter((g) => !g.closed);
    const same = open.find((g) => g.text.toLowerCase() === text.toLowerCase());
    if (same) return { error: `That's already open as ${same.id}.` };
    if (open.length >= L.open) return { error: `There are ${open.length} open gaps already (at most ${L.open}): answer or drop one first with closeGap. Open gaps: ${listed(all)}.` };
    const id = `g${Math.max(0, ...all.map((g) => Number(g.id.slice(1)) || 0)) + 1}`;
    all = [...all, { id, text, at: now }];
  }
  for (let over = all.length - L.kept; over > 0; over--) {
    const oldest = all.find((g) => g.closed);
    if (!oldest) break;
    all = all.filter((g) => g !== oldest);
  }
  return all;
}

/** What the studio tool says back: where it's showing, and the gap it logged. */
export function studioReply(before: Studio | undefined, after: Studio): string {
  const logged = after.gaps.length && !before?.gaps.some((g) => g.id === after.gaps.at(-1)!.id) ? ` Logged gap ${after.gaps.at(-1)!.id}.` : '';
  return `The studio holodeck shows it.${logged} Open gaps: ${listed(after.gaps)}.`;
}
