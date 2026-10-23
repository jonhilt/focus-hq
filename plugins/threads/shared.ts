// What both halves of the threads plugin (README.md) share: a project's register of loose threads, the contacts its
// goals' leads logged and never pursued or dropped, which outlive the goal that noticed them.
import type { Agent, GoalRecord, LedgerEntry, LedgerEvent, ThreadDecidedAs } from '../../plugin-api/shared';

export const THREADS = 'threads';

/** How a thread ends: taken on (`note`: by whom), parked (until when), dropped (why) or resolved (by what). */
export const THREAD_ENDS = ['next', 'parked', 'dropped', 'resolved'] as const;
export type ThreadEnd = (typeof THREAD_ENDS)[number];

/** How long a decision's note may be, as a contact's text may. */
export const NOTE_LIMIT = 160;

/** The ends that say nothing without a note: parked until when, dropped why. */
const NEEDS_NOTE: Partial<Record<ThreadEnd, string>> = { parked: 'Say until when it’s parked', dropped: 'Say why it’s dropped' };

/** A contact a goal's lead logged and left open, as the project's register keeps it. */
export interface Thread {
  /** The goal that noticed it: its lead's id while it's under way, its id in the room's log once closed (the same one). */
  goal: string;
  goalTitle: string;
  leadName: string;
  /** The contact's id on that goal: c1, c2… */
  contact: string;
  text: string;
  /** When it was noticed, and in which slice. */
  at: number;
  slice: number;
  /** When its goal closed; missing while the goal's under way. */
  closedAt?: number;
  /** Where the captain decided it ends, and when; missing until they have (and while its goal's under way: it's its lead's). */
  decided?: { as: ThreadEnd; note?: string; at: number };
}

/** What the server sends the browser, kept in memory only: each project's threads left open on its closed goals, by project id. */
export interface ThreadsState {
  closed: Record<string, Thread[]>;
}

export const freshThreads = (): ThreadsState => ({ closed: {} });

/** The contacts a closed goal left open. */
export const leftOpen = (goal: GoalRecord): Thread[] =>
  (goal.contacts ?? []).filter((c) => !c.closed).map((c) => ({
    goal: goal.id, goalTitle: goal.title, leadName: goal.leadName, contact: c.id, text: c.text, at: c.at, slice: c.slice, closedAt: goal.closedAt,
  }));

/**
 * Each project's threads once `goal` has closed in project `projectId`: its last close replaces any before (a goal
 * reopened and closed again), keeping what was decided of the threads it left open again.
 */
export function withClosed(closed: ThreadsState['closed'], projectId: string, goal: GoalRecord): ThreadsState['closed'] {
  const before = closed[projectId] ?? [];
  const decided = new Map(before.flatMap((t) => (t.goal === goal.id && t.decided ? [[t.contact, t.decided] as const] : [])));
  const again = leftOpen(goal).map((t) => {
    const d = decided.get(t.contact);
    return d ? { ...t, decided: d } : t;
  });
  return { ...closed, [projectId]: [...before.filter((t) => t.goal !== goal.id), ...again] };
}

type ThreadDecided = Extract<LedgerEvent, { kind: 'thread-decided' }>;

/** Each project's threads once the captain's decided one: its end set, or (`open`) taken back. A thread no longer there is left alone. */
function withDecided(closed: ThreadsState['closed'], e: ThreadDecided): ThreadsState['closed'] {
  const threads = closed[e.projectId] ?? [];
  const same = (t: Thread) => t.goal === e.goalId && t.contact === e.contact;
  if (!threads.some(same)) return closed;
  const decide = ({ decided, ...t }: Thread): Thread => (e.as === 'open' ? t : { ...t, decided: { as: e.as, ...(e.note && { note: e.note }), at: e.at } });
  return { ...closed, [e.projectId]: threads.map((t) => (same(t) ? decide(t) : t)) };
}

/** Each project's threads after ledger line `e`: a goal closing, or the captain deciding a thread; any other line changes nothing. */
export function afterLine(closed: ThreadsState['closed'], e: LedgerEvent): ThreadsState['closed'] {
  if (e.kind === 'goal-closed') return withClosed(closed, e.projectId, e.goal);
  if (e.kind === 'thread-decided') return withDecided(closed, e);
  return closed;
}

/** Each project's threads left open on its closed goals, and what the captain decided of them, read from the ledger in order. */
export function closedThreads(events: readonly LedgerEvent[]): ThreadsState['closed'] {
  let closed: ThreadsState['closed'] = {};
  for (const e of events) closed = afterLine(closed, e);
  return closed;
}

const clean = (text: string) => text.replace(/\s+/g, ' ').trim();
const isAs = (as: unknown): as is ThreadDecidedAs => as === 'open' || THREAD_ENDS.some((end) => end === as);

/**
 * The ledger line the captain deciding where a thread ends writes, or why it's refused (then nothing is written):
 * `threads` are its project's closed goals' threads, and `underWay` the goals under way there, whose threads are
 * their leads'. The same decision again is refused, so a second press of the same button writes nothing.
 */
export function decision(threads: readonly Thread[] | undefined, underWay: ReadonlySet<string>, input: Record<string, unknown>): { entry: LedgerEntry } | { error: string } {
  const { goal, contact, as } = input;
  if (!isAs(as)) return { error: `A thread ends as ${THREAD_ENDS.join(', ')}, or goes back to be decided (open)` };
  const t = (threads ?? []).find((x) => x.goal === goal && x.contact === contact);
  if (!t) return { error: 'There’s no such thread left open on a closed goal' };
  if (underWay.has(t.goal)) return { error: `“${t.goalTitle}” is under way again: the thread is its lead’s until it closes` };
  const note = clean(typeof input.note === 'string' ? input.note : '');
  if (note.length > NOTE_LIMIT) return { error: `The note is ${note.length} characters (at most ${NOTE_LIMIT})` };
  if (as === 'open') {
    if (!t.decided) return { error: 'It isn’t decided yet' };
  } else {
    const needs = NEEDS_NOTE[as];
    if (needs && !note) return { error: needs };
    if (t.decided?.as === as && (t.decided.note ?? '') === note) return { error: `It’s already ${as === 'next' ? 'taken on' : as}` };
  }
  return { entry: { kind: 'thread-decided', goalId: t.goal, goal: t.goalTitle, contact: t.contact, text: t.text, as, ...(as !== 'open' && note && { note }) } };
}

/** A thread in a project's register: `live` while its goal's under way (its lead has it, and can be talked to). */
export type RegisterThread = Thread & { live?: true };

/** The open contacts of a goal under way. */
const stillOpen = (lead: Pick<Agent, 'id' | 'name' | 'lead'>): RegisterThread[] => {
  const work = lead.lead;
  if (!work) return [];
  return (work.contacts ?? []).filter((c) => !c.closed).map((c) => ({
    goal: lead.id, goalTitle: work.title, leadName: lead.name, contact: c.id, text: c.text, at: c.at, slice: c.slice, live: true,
  }));
};

/**
 * A project's register, oldest first: the threads its closed goals left open, but not a goal's reopened since (its
 * lead has them again, as they stand now), and the ones its goals under way have open.
 */
export function register(closed: readonly Thread[] | undefined, leads: readonly Pick<Agent, 'id' | 'name' | 'lead'>[]): RegisterThread[] {
  const underWay = new Set(leads.map((a) => a.id));
  return [...(closed ?? []).filter((t) => !underWay.has(t.goal)), ...leads.flatMap(stillOpen)].sort((a, b) => a.at - b.at);
}
