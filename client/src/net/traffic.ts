// The ship's recent traffic: the news the toasts brought, kept so one that came and went while the captain was looking
// elsewhere can still be found in Comms. Kept in this browser: it's a log to glance at, not something to act on.

/** Where a piece of news points, for its button: kept as data, since a toast's own action doesn't survive a reload. */
export type TrafficLink =
  /** The agent: teleport to their seat (`talk`: open their panel). */
  | { kind: 'agent'; id: string; talk?: boolean }
  | { kind: 'number-one' }
  /** The project's preview: its log. */
  | { kind: 'preview'; projectId: string }
  | { kind: 'url'; url: string; label: string };

export interface TrafficEntry {
  at: number;
  level: 'info' | 'success' | 'error';
  text: string;
  link?: TrafficLink;
}

/** How much traffic Comms keeps. */
export const KEEP = 30;

/** The log with `entry` on top, newest first, and only the last `keep` of it. */
export function logged(log: readonly TrafficEntry[], entry: TrafficEntry, keep = KEEP): TrafficEntry[] {
  return [entry, ...log].slice(0, keep);
}

const LEVELS = new Set(['info', 'success', 'error']);
const isEntry = (e: unknown): e is TrafficEntry => {
  if (typeof e !== 'object' || e === null) return false;
  const { at, level, text } = e as Record<string, unknown>;
  return typeof at === 'number' && typeof level === 'string' && LEVELS.has(level) && typeof text === 'string';
};

/** The log as this browser kept it, without anything it can't make sense of (an older or corrupted copy). */
export function decodeTraffic(raw: string | null): TrafficEntry[] {
  try {
    const kept: unknown = JSON.parse(raw ?? '[]');
    return Array.isArray(kept) ? kept.filter(isEntry).slice(0, KEEP) : [];
  } catch {
    return [];
  }
}

const STORE = 'focus.traffic';
let log: TrafficEntry[] | undefined;
const listeners = new Set<() => void>();

/** The recent traffic, newest first. */
export function traffic(): readonly TrafficEntry[] {
  return (log ??= decodeTraffic(localStorage.getItem(STORE)));
}

/** Keeps a piece of news in the log. */
export function record(entry: TrafficEntry): void {
  log = logged(traffic(), entry);
  try {
    localStorage.setItem(STORE, JSON.stringify(log));
  } catch {
    // private browsing: it holds until the page reloads
  }
  for (const fn of listeners) fn();
}

/** Calls `fn` whenever news comes in; returns the unsubscribe. */
export function onTraffic(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
