// What both halves of the threads plugin (README.md) share: a project's register of loose threads, the contacts its
// goals' leads logged and never pursued or dropped, and the ideas for next its goals closed with, which outlive the goal
// that noticed them.
import { type Agent, type GoalRecord, goalTitle, type LedgerEntry, type LedgerEvent, type QueuedGoal, type ThreadDecidedAs } from '../../plugin-api/shared';

export const THREADS = 'threads';

/** How a thread ends: taken on (`note`: by whom), parked (until when), dropped (why) or resolved (by what). */
export const THREAD_ENDS = ['next', 'parked', 'dropped', 'resolved'] as const;
export type ThreadEnd = (typeof THREAD_ENDS)[number];

/** How long a decision's note may be, as a contact's text may. */
export const NOTE_LIMIT = 160;

/** The ends that say nothing without a note: parked until when, dropped why. */
const NEEDS_NOTE: Partial<Record<ThreadEnd, string>> = { parked: 'Say until when it’s parked', dropped: 'Say why it’s dropped' };

/** A contact a goal's lead logged and left open, or an idea for next a goal closed with, as the project's register keeps it. */
export interface Thread {
  /** The goal that noticed it: its lead's id while it's under way, its id in the room's log once closed (the same one). */
  goal: string;
  goalTitle: string;
  leadName: string;
  /** The contact's id on that goal (c1, c2…), or an idea's key (`ideaKey`). */
  contact: string;
  text: string;
  /** When it was noticed, and in which slice: for an idea, as its goal closed. */
  at: number;
  slice: number;
  /** An idea for next the goal closed with, rather than a contact its lead logged. */
  idea?: true;
  /** When its goal closed; missing while the goal's under way. */
  closedAt?: number;
  /**
   * Where the captain decided it ends, and when; missing until they have (and while its goal's under way: it's its
   * lead's). `spunOff`: the goal of its own it was taken on as (next).
   */
  decided?: { as: ThreadEnd; note?: string; spunOff?: SpunOff; at: number };
  /** Where a model proposed it ends (Sort for me), and why, while it's still to decide. */
  proposed?: { as: ThreadEnd; note: string; at: number };
}

/** The goal a thread was spun off as: its lead's id, if it took a team station (not if it waits in line for one), and its title as it started. */
export interface SpunOff {
  goal?: string;
  title: string;
}

/** A project's last Sort for me: when, how many threads it asked about and got proposals for, on what and at what cost, or why it failed. */
export interface LastSort {
  at: number;
  asked: number;
  proposed: number;
  model: string;
  costUsd?: number;
  failed?: string;
}

/**
 * What the server sends the browser, kept in memory only, by project id: the threads left open on its closed goals,
 * its last Sort for me (both read from the ledger), and a sort under way (when it started, how many threads it asked about).
 */
export interface ThreadsState {
  closed: Record<string, Thread[]>;
  sorts: Record<string, LastSort>;
  sorting: Record<string, { at: number; asked: number }>;
}

export const freshThreads = (): ThreadsState => ({ closed: {}, sorts: {}, sorting: {} });

const clean = (text: string) => text.replace(/\s+/g, ' ').trim();

/** An idea for next's key on its goal, from its words (FNV-1a): the same idea keeps its key however its goal's list was ordered. */
export function ideaKey(text: string): string {
  let h = 0x811c9dc5;
  for (const ch of clean(text)) h = Math.imul(h ^ (ch.codePointAt(0) ?? 0), 0x01000193) >>> 0;
  return `next-${h.toString(36)}`;
}

/** The contacts a closed goal left open, and the ideas for next it closed with (each once). */
export function leftOpen(goal: GoalRecord): Thread[] {
  const from = { goal: goal.id, goalTitle: goal.title, leadName: goal.leadName, closedAt: goal.closedAt };
  const contacts = (goal.contacts ?? []).filter((c) => !c.closed).map((c): Thread => ({ ...from, contact: c.id, text: c.text, at: c.at, slice: c.slice }));
  const ideas = new Map((goal.note?.next ?? []).map(clean).filter(Boolean).map((text) => [ideaKey(text), text]));
  return [...contacts, ...[...ideas].map(([key, text]): Thread => ({ ...from, contact: key, text, at: goal.closedAt, slice: goal.slice ?? goal.slices, idea: true }))];
}

/**
 * Each project's threads once `goal` has closed in project `projectId`: its last close replaces any before (a goal
 * reopened and closed again), keeping what was decided of the threads it left open again.
 */
export function withClosed(closed: ThreadsState['closed'], projectId: string, goal: GoalRecord): ThreadsState['closed'] {
  const before = closed[projectId] ?? [];
  const kept = new Map(before.flatMap((t) => (t.goal === goal.id ? [[t.contact, t] as const] : [])));
  const again = leftOpen(goal).map((t): Thread => {
    const was = kept.get(t.contact);
    return { ...t, ...(was?.decided && { decided: was.decided }), ...(was?.proposed && { proposed: was.proposed }) };
  });
  return { ...closed, [projectId]: [...before.filter((t) => t.goal !== goal.id), ...again] };
}

type ThreadDecided = Extract<LedgerEvent, { kind: 'thread-decided' }>;

/**
 * Each project's threads once the captain's decided one: its end set, or (`open`) taken back. What was proposed of it
 * goes either way: it was decided since. A thread no longer there is left alone.
 */
function withDecided(closed: ThreadsState['closed'], e: ThreadDecided): ThreadsState['closed'] {
  const threads = closed[e.projectId] ?? [];
  const same = (t: Thread) => t.goal === e.goalId && t.contact === e.contact;
  if (!threads.some(same)) return closed;
  const decide = ({ decided, proposed, ...t }: Thread): Thread =>
    (e.as === 'open' ? t : { ...t, decided: { as: e.as, ...(e.note && { note: e.note }), ...(e.spunOff && { spunOff: e.spunOff }), at: e.at } });
  return { ...closed, [e.projectId]: threads.map((t) => (same(t) ? decide(t) : t)) };
}

type ThreadProposals = Extract<LedgerEvent, { kind: 'thread-proposals' }>;

/** Each project's threads once a model's proposed where some end: each still to decide takes its proposal, the latest winning. */
function withProposals(closed: ThreadsState['closed'], e: ThreadProposals): ThreadsState['closed'] {
  const threads = closed[e.projectId];
  if (!threads || !e.proposals.length) return closed;
  const proposals = new Map(e.proposals.map((p) => [`${p.goalId}:${p.contact}`, p]));
  return { ...closed, [e.projectId]: threads.map((t) => {
    const p = t.decided ? undefined : proposals.get(`${t.goal}:${t.contact}`);
    return p ? { ...t, proposed: { as: p.as, note: p.note, at: e.at } } : t;
  }) };
}

/** Each project's threads after ledger line `e`: a goal closing, the captain deciding a thread, or a model proposing; any other line changes nothing. */
export function afterLine(closed: ThreadsState['closed'], e: LedgerEvent): ThreadsState['closed'] {
  if (e.kind === 'goal-closed') return withClosed(closed, e.projectId, e.goal);
  if (e.kind === 'thread-decided') return withDecided(closed, e);
  if (e.kind === 'thread-proposals') return withProposals(closed, e);
  return closed;
}

/** Each project's threads left open on its closed goals, what was proposed and decided of them, read from the ledger in order. */
export function closedThreads(events: readonly LedgerEvent[]): ThreadsState['closed'] {
  let closed: ThreadsState['closed'] = {};
  for (const e of events) closed = afterLine(closed, e);
  return closed;
}

/** A project's last Sort for me, as its ledger line says it. */
export const lastSort = (e: ThreadProposals): LastSort =>
  ({ at: e.at, asked: e.asked, proposed: e.proposals.length, model: e.model, ...(e.costUsd !== undefined && { costUsd: e.costUsd }), ...(e.failed && { failed: e.failed }) });

/** Each project's last Sort for me, read from the ledger. */
export const lastSorts = (events: readonly LedgerEvent[]): ThreadsState['sorts'] =>
  Object.fromEntries(events.flatMap((e) => (e.kind === 'thread-proposals' ? [[e.projectId, lastSort(e)] as const] : [])));

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

/** What a thread spun off as a goal of its own starts the goal with, until the captain edits it: the thread, and where it came from. */
export const spinOffText = (t: Thread) =>
  `${t.text}\n\n(Spun off from “${t.goalTitle}”, a closed goal: ${t.idea ? 'one of the ideas for next it closed with' : `its contact ${t.contact}, noticed in slice ${t.slice}`}.)`;

const isEnd = (as: unknown): as is ThreadEnd => THREAD_ENDS.some((end) => end === as);

/** The ledger line accepting what was proposed of `t` writes: the decision as proposed, saying so. */
const accepted = (t: Thread): LedgerEntry[] =>
  t.proposed ? [{ kind: 'thread-decided', goalId: t.goal, goal: t.goalTitle, contact: t.contact, text: t.text, as: t.proposed.as, note: t.proposed.note, proposed: true }] : [];

/**
 * The ledger lines the captain accepting a model's proposals writes, or why it's refused (then nothing is written):
 * one thread's (`goal` and `contact`), or every one still to decide whose proposal ends it `as` (all the drops, say).
 * Only a closed goal's threads, as for any decision (`underWay` keeps its leads').
 */
export function acceptances(threads: readonly Thread[] | undefined, underWay: ReadonlySet<string>, input: Record<string, unknown>): { entries: LedgerEntry[] } | { error: string } {
  const open = (threads ?? []).filter((t) => t.proposed && !t.decided && !underWay.has(t.goal));
  if (input.contact !== undefined) {
    const t = open.find((x) => x.goal === input.goal && x.contact === input.contact);
    return t ? { entries: accepted(t) } : { error: 'There’s no proposal for that thread to accept' };
  }
  if (!isEnd(input.as)) return { error: `Say which proposals to accept: ${THREAD_ENDS.join(', ')}` };
  const entries = open.filter((t) => t.proposed?.as === input.as).flatMap(accepted);
  return entries.length ? { entries } : { error: `No thread to decide has ${input.as} proposed` };
}

/**
 * The thread the captain spins off as a goal of its own, starting it with `text`, or why it's refused (then no goal
 * starts): one left open on a closed goal of `threads` (not one under way, of `underWay`), and not spun off already.
 */
export function toSpinOff(threads: readonly Thread[] | undefined, underWay: ReadonlySet<string>, input: Record<string, unknown>): { thread: Thread; text: string } | { error: string } {
  const t = (threads ?? []).find((x) => x.goal === input.goal && x.contact === input.contact);
  if (!t) return { error: 'There’s no such thread left open on a closed goal' };
  if (underWay.has(t.goal)) return { error: `“${t.goalTitle}” is under way again: the thread is its lead’s until it closes` };
  if (t.decided?.spunOff) return { error: `It’s a goal of its own already: “${t.decided.spunOff.title}”` };
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (!text) return { error: 'Say what the goal is: its lead hears it first' };
  return { thread: t, text };
}

/** The ledger line thread `t` being spun off writes: taken on (next) as the goal `started` from `text`, at a station or in line for one. */
export function spunOffEntry(t: Thread, text: string, started: { agent: Pick<Agent, 'id' | 'lead'> } | { queued: QueuedGoal }): LedgerEntry {
  const spunOff: SpunOff = 'agent' in started ? { goal: started.agent.id, title: started.agent.lead?.title ?? goalTitle(text) } : { title: goalTitle(text) };
  return { kind: 'thread-decided', goalId: t.goal, goal: t.goalTitle, contact: t.contact, text: t.text, as: 'next', spunOff };
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
