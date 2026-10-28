import type { Check, Verdict } from './shared';

// The watch (README.md#the-watch): one goal at the conn, the rest underway on the rail, and what of theirs reaches the
// captain meanwhile: a hail, a count on its berth, or a report at the muster. Pure, so it's tested (watchRules.test.ts).

/**
 * How hard something waiting asks for the captain: a `hail` breaks a watch, a `decision` waits as a count on its
 * goal's berth (and in the muster), a `word` (words the chief of staff has ready for the lead) is a report.
 */
export type Grade = 'hail' | 'decision' | 'word';

/** The checks that make an interrupt a hail: P5, what can't be undone or reaches beyond the ship, and P6, the lead contradicting the captain. */
const BREAKS_WATCH: readonly Check[] = ['irreversible', 'contradiction'];

/**
 * A lead's turn's grade by its verdict: carry on or back to the lead is a word, an interrupt on P5 or P6 a hail, the
 * rest a decision. An interrupt from before verdicts named their check is a hail (P7: unsure, hand it to them). Anything
 * not judged (a raised hand, a question, a turn it hasn't read) is a decision: the captain picked P5 and P6 alone to
 * break a watch (28 October 2026).
 */
export function gradeOf(judged: Pick<Verdict, 'route' | 'check'> | undefined): Grade {
  if (!judged) return 'decision';
  if (judged.route === 1 || judged.route === 4) return 'word';
  if (judged.route === 3 && (judged.check === undefined || BREAKS_WATCH.includes(judged.check))) return 'hail';
  return 'decision';
}

/** The goal at the conn, if its lead is still aboard: a goal closed mid-watch leaves no watch. */
export const watchOf = (conn: string | undefined, aboard: (leadId: string) => boolean): string | undefined => (conn && aboard(conn) ? conn : undefined);

/**
 * Where something waiting reaches the captain: on the `sheet` of the goal at the conn, as a `hail` over it, in the
 * `muster` (a count on its berth while they're on watch), or folded into its `report`s. With no watch, everything but
 * words is the muster's.
 */
export type Reach = 'sheet' | 'hail' | 'muster' | 'report';

export function reachOf(item: { leadId?: string; grade: Grade; stoodBy: boolean }, conn: string | undefined): Reach {
  if (conn && item.leadId === conn) return 'sheet';
  if (item.grade === 'word') return 'report';
  return conn && item.grade === 'hail' && !item.stoodBy ? 'hail' : 'muster';
}

/** Whether a lead's turn coming to the captain may toast: with no watch, on the goal at the conn, or a hail. */
export const toasts = (conn: string | undefined, leadId: string, grade: Grade): boolean => !conn || leadId === conn || grade === 'hail';

/**
 * The muster's order, by what each unblocks: hails first, then what has someone idle until the captain answers, then
 * the rest, oldest first within each.
 */
export function musterOrder<T extends { grade: Grade; idle: boolean; since?: number }>(items: readonly T[]): T[] {
  const rank = (i: T) => (i.grade === 'hail' ? 0 : i.idle ? 1 : 2);
  return [...items].sort((a, b) => rank(a) - rank(b) || (a.since ?? 0) - (b.since ?? 0));
}

/** A slice's exhibit on the strip: the lead's id for it, its title, when it was last shown, and whether it has a picture. */
export interface StripExhibit {
  id: string;
  title: string;
  at: number;
  image?: boolean;
}

/** One slice as a section of the strip: its exhibits, and the record it keeps (what it shipped, decided and taught). */
export interface StripSlice {
  slice: number;
  name: string;
  /** The slice the goal is in: its exhibits lie out; the ones behind are a stack until fanned. */
  now: boolean;
  exhibits: StripExhibit[];
  shipped: string[];
  decided: { what: string; at: number }[];
  taught: string[];
}

/**
 * A goal's strip as its sheet shows it (exhibits-grammar.html, option D): the chart and the exhibits as one thing, a
 * section per slice in order, the one it's at last, then the first of the lead's next ones as an empty slot. An exhibit
 * goes in the slice it was last shown in; one shown before that was kept is the current slice's. Each section keeps
 * its slice's record: its pull requests that merged, the questions answered in it, and what it taught.
 */
export function stripOf(work: {
  waypoints: readonly { slice: number; title?: string; heading?: string; learned?: string[] }[];
  artifacts: readonly (StripExhibit & { slice?: number })[];
  prs: readonly { number: number; slice?: number; outcome?: 'merged' | 'closed'; recap?: { title: string } }[];
  questions: readonly { slice?: number; question: string; answer?: { at: number } }[];
}, next: readonly string[]): { slices: StripSlice[]; next?: string } {
  const at = work.waypoints.at(-1)?.slice;
  const slices = work.waypoints.map((w): StripSlice => ({
    slice: w.slice,
    name: w.title ?? w.heading ?? `Slice ${w.slice}`,
    now: w.slice === at,
    exhibits: work.artifacts.filter((a) => (a.slice ?? at) === w.slice)
      .map(({ id, title, at: shown, image }) => ({ id, title, at: shown, ...(image && { image }) })),
    shipped: work.prs.filter((p) => p.slice === w.slice && p.outcome === 'merged').map((p) => `#${p.number}${p.recap ? ` ${p.recap.title}` : ''}`),
    decided: work.questions.flatMap((q) => (q.slice === w.slice && q.answer ? [{ what: q.question, at: q.answer.at }] : [])),
    taught: w.learned ?? [],
  }));
  return { slices, ...(next[0] && { next: next[0] }) };
}

/** The hails stood by that still wait: one answered, or gone with its turn, is let go. */
export const stoodByKept = (stoodBy: readonly string[], waiting: ReadonlySet<string>): string[] => stoodBy.filter((k) => waiting.has(k));
