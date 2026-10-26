import type { InboxItem } from './inbox';
import type { ThreadEntry } from './thread';

// The stream's decisions (stream.ts, README.md#a-thread-per-goal): what each goal's line on the left says, where "new
// since you last looked" falls in a thread, and how each entry reads. Pure, so it's tested (streamList.test.ts).

/** A goal's line on the left: what needs the captain there, what's new since they last looked, or neither. */
export interface GoalLine {
  tone: 'needs' | 'new' | 'quiet';
  text: string;
}

/**
 * What a goal's line says: the first thing that needs the captain there (and how many more), else how much is new
 * since they last looked at its thread (`seenAt`; never looked counts nothing new), else what its lead is doing.
 */
export function goalLine(flagged: readonly Pick<InboxItem, 'what'>[], latest: number | undefined, seenAt: number | undefined, status: string): GoalLine {
  if (flagged.length) return { tone: 'needs', text: `Needs you · ${flagged[0].what}${flagged.length > 1 ? ` (+${flagged.length - 1})` : ''}` };
  if (latest !== undefined && seenAt !== undefined && latest > seenAt) return { tone: 'new', text: 'New since you looked' };
  return { tone: 'quiet', text: status };
}

/**
 * Where "new since you last looked" goes in a thread: before the first entry after `seenAt` that isn't the captain's
 * own; -1 when nothing is new, or they've never looked (the whole thread is new, so a line would say nothing).
 */
export function newSince(entries: readonly ThreadEntry[], seenAt: number | undefined): number {
  if (seenAt === undefined) return -1;
  return entries.findIndex((e) => e.at > seenAt && e.kind !== 'you');
}

/** When the captain last looked at each goal's thread, from what this browser kept: only entries that are a time. */
export function seenOf(kept: unknown): Record<string, number> {
  if (typeof kept !== 'object' || kept === null || Array.isArray(kept)) return {};
  return Object.fromEntries(Object.entries(kept).filter((e): e is [string, number] => typeof e[1] === 'number' && Number.isFinite(e[1])));
}

/** When something last came into a thread from anyone but the captain: what a goal's line says is new by. */
export const latestNews = (entries: readonly ThreadEntry[]): number | undefined => entries.findLast((e) => e.kind !== 'you')?.at;

/** The goal the stream shows: the one picked while it's still under way, else the first that needs the captain, else the first. */
export function pickGoal(picked: string | null, leads: readonly { id: string }[], needs: (id: string) => boolean): string | null {
  if (picked && leads.some((l) => l.id === picked)) return picked;
  return leads.find((l) => needs(l.id))?.id ?? leads[0]?.id ?? null;
}

/** What a thread's drawing depends on: drawn again only when that changes, so it doesn't jump under the captain's eyes. */
export const threadKey = (leadId: string, status: string, entries: readonly Pick<ThreadEntry, 'at'>[]): string =>
  `${leadId}|${status}|${entries.length}|${entries.at(-1)?.at ?? ''}`;

/** A thread's rows in order: its entries, with the line saying what's new since the captain last looked where it falls (`newSince`). */
export function threadRows(entries: readonly ThreadEntry[], seenAt: number | undefined): ({ entry: ThreadEntry } | { newSince: true })[] {
  const split = newSince(entries, seenAt);
  return entries.flatMap((entry, i) => [...(i === split ? [{ newSince: true as const }] : []), { entry }]);
}

/**
 * What a goal's thread has at its foot: the first thing that needs the captain there which this browser has too (the
 * card Comms shows for it), or a box to talk to its lead; `key` says when it changes, so a reply being written isn't wiped.
 */
export function footOf(leadId: string, flagged: readonly Pick<InboxItem, 'id' | 'cos'>[], known: (id: string) => boolean): { card?: string; key: string } {
  const item = flagged.find((i) => known(i.id));
  return item ? { card: item.id, key: `${item.id}|${item.cos?.route ?? ''}` } : { key: `talk|${leadId}` };
}

/** The line under a thread's title: who leads it, what they're doing, and what done looks like when it's said. */
export const headLine = (lead: string, status: string, done?: string): string => `${lead} · ${doing(status)}${done ? ` · Done looks like: ${done}` : ''}`;

/** What a goal's lead is doing, in plain words. */
export function doing(status: string): string {
  const words: Record<string, string> = { done: 'between turns', working: 'working', testing: 'testing', waiting: 'waiting on a permission', pushing: 'pushing', 'setting-up': 'setting up', queued: 'about to start', error: 'stopped on an error', stopped: 'stopped' };
  return words[status] ?? status;
}

/** How an entry reads in the thread: the captain's and the lead's words as messages, the rest as quiet lines, some with more folded under them. */
export type EntryView =
  | { as: 'you'; text: string; via?: string }
  | { as: 'lead'; text: string }
  | { as: 'line'; tone: 'quiet' | 'decided' | 'merged' | 'cos' | 'sent-back' | 'flagged'; text: string; more?: string };

const ROUTE_LINE: Record<number, { tone: 'quiet' | 'cos' | 'sent-back' | 'flagged'; says: string }> = {
  1: { tone: 'quiet', says: 'The chief of staff would let it carry on' },
  2: { tone: 'cos', says: 'The chief of staff put this to you' },
  3: { tone: 'flagged', says: 'The chief of staff flagged this to you now' },
  4: { tone: 'sent-back', says: 'The chief of staff would send this back to the lead' },
};

export function entryView(e: ThreadEntry): EntryView {
  switch (e.kind) {
    case 'you':
      return { as: 'you', text: e.text, ...(e.via && { via: e.via }) };
    case 'lead':
      return { as: 'lead', text: e.text };
    case 'ops':
      return { as: 'line', tone: 'quiet', text: `${e.from}: ${e.text}` };
    case 'decided':
      return { as: 'line', tone: 'decided', text: `Decided: ${e.question} → ${e.chosen}` };
    case 'merged':
      return { as: 'line', tone: 'merged', text: `Merged ${e.repo}#${e.number}` };
    case 'cos': {
      const { tone, says } = ROUTE_LINE[e.route];
      return { as: 'line', tone, text: `${says}: ${e.why}`, ...(e.message && { more: e.message }) };
    }
  }
}
