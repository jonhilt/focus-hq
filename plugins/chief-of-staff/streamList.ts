import type { InboxItem } from './inbox';
import type { ThreadEntry } from './thread';

// The stream's decisions (stream.ts, README.md#a-thread-per-goal): how the goals on the left are listed and what each
// row says, where "new since you last looked" falls in a thread, how each entry reads and how quiet lines bundle. Pure, so it's tested (streamList.test.ts).

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

/** What a goal's lead is doing, in plain words. */
export function doing(status: string): string {
  const words: Record<string, string> = { done: 'between turns', working: 'working', testing: 'testing', waiting: 'waiting on a permission', pushing: 'pushing', 'setting-up': 'setting up', queued: 'about to start', error: 'stopped on an error', stopped: 'stopped' };
  return words[status] ?? status;
}

/** How an entry reads in the thread: the captain's and the lead's words as messages, the rest as quiet lines, some with more folded under them. */
export type EntryView =
  | { as: 'you'; text: string; via?: string }
  | { as: 'lead'; text: string }
  | { as: 'line'; tone: 'quiet' | 'merged' | 'cos' | 'sent-back' | 'flagged'; text: string; more?: string };

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
    case 'merged':
      return { as: 'line', tone: 'merged', text: `Merged ${e.repo}#${e.number}` };
    case 'cos': {
      const { tone, says } = ROUTE_LINE[e.route];
      return { as: 'line', tone, text: `${says}: ${e.why}`, ...(e.message && { more: e.message }) };
    }
  }
}

/** The goals on the left, every shown project's in one list: those that need the captain first, then each project's others under its name. */
export function goalSections<G extends { id: string; projectId: string }>(
  goals: readonly G[],
  projects: readonly { id: string; name: string }[],
  needs: (id: string) => boolean,
): { key: string; name: string; goals: G[] }[] {
  const needing = goals.filter((g) => needs(g.id));
  const rest = projects.map((p) => ({ key: p.id, name: p.name, goals: goals.filter((g) => g.projectId === p.id && !needs(g.id)) }));
  return [...(needing.length ? [{ key: 'needs', name: 'Needs you', goals: needing }] : []), ...rest.filter((s) => s.goals.length)];
}

/** How long ago, in a few characters: `now`, `12m`, `3h`, `2d`. */
export function age(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  if (m < 60 * 24) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
}

const WORKING = new Set(['working', 'testing', 'pushing', 'setting-up']);

/**
 * A goal's compact row: its dot (what needs the captain, what's new since they looked, a lead at work or stopped on an
 * error, else quiet) and, at its right, how many things wait on them there or how long since anything came in.
 */
export function goalRow(flagged: number, latest: number | undefined, seenAt: number | undefined, status: string, now: number): { dot: 'needs' | 'new' | 'working' | 'error' | 'quiet'; right: string } {
  const right = flagged ? `${flagged} for you` : latest !== undefined ? age(now - latest) : '';
  if (flagged) return { dot: 'needs', right };
  if (latest !== undefined && seenAt !== undefined && latest > seenAt) return { dot: 'new', right };
  if (status === 'error') return { dot: 'error', right };
  return { dot: WORKING.has(status) ? 'working' : 'quiet', right };
}

/** A thread's rows with the quiet lines between messages bundled: two or more in a row become one, said in brief (`bundleSays`). */
export type BundledRow = { entry: ThreadEntry } | { newSince: true } | { bundle: ThreadEntry[] };

export function bundleRows(rows: readonly ({ entry: ThreadEntry } | { newSince: true })[]): BundledRow[] {
  const out: BundledRow[] = [];
  let run: ThreadEntry[] = [];
  const flush = () => {
    if (run.length > 1) out.push({ bundle: run });
    else out.push(...run.map((entry) => ({ entry })));
    run = [];
  };
  for (const r of rows) {
    if ('entry' in r && entryView(r.entry).as === 'line') run.push(r.entry);
    else {
      flush();
      out.push(r);
    }
  }
  flush();
  return out;
}

/** What a bundle of quiet lines amounts to, in brief: what merged, what QA passed, what went back or was flagged. */
export function bundleSays(entries: readonly ThreadEntry[]): string[] {
  const says: string[] = [];
  const merged = entries.flatMap((e) => (e.kind === 'merged' ? [`#${e.number}`] : []));
  if (merged.length) says.push(`merged ${merged.join(', ')}`);
  const passed = entries.filter((e) => e.kind === 'ops' && /^QA/.test(e.from) && /\bpassed\b/.test(e.text)).length;
  if (passed) says.push(passed > 1 ? `QA passed ${passed}` : 'QA passed');
  const back = entries.filter((e) => e.kind === 'cos' && e.route === 4).length;
  if (back) says.push(back > 1 ? `sent back ${back}×` : 'sent back once');
  if (entries.some((e) => e.kind === 'cos' && e.route === 3)) says.push('flagged to you');
  return says;
}

/** A goal's pull requests, for its header: how many merged of those not closed. */
export function prCount(prs: readonly { outcome?: 'merged' | 'closed' }[]): { merged: number; prs: number } {
  const live = prs.filter((p) => p.outcome !== 'closed');
  return { merged: live.filter((p) => p.outcome === 'merged').length, prs: live.length };
}
