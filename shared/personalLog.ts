// The captain's personal log: the thoughts they jot down to come back to (an idea for a video, a feature, something to
// check), kept in a journal of their own (data/personal-log.jsonl, server/store.ts). What's here, pure: the facts
// it's told by, what they add up to, and how the ready room's console lays them out.

/** Where an entry was jotted down: aboard (the ready room, or the I key), or from off the ship. */
export type LogFrom = 'office' | 'remote';

export interface PersonalEntry {
  id: string;
  text: string;
  from: LogFrom;
  /** Who jotted it down for the captain (Number One, say), when someone did. */
  via?: string;
  /** When it was jotted down. */
  at: number;
  status: 'open' | 'done' | 'dropped';
  /** Put aside until then: it's back with the rest once it's passed. */
  until?: number;
  /** When it was done or dropped. */
  closedAt?: number;
}

/** One fact of the personal log. */
export type PersonalFact =
  | { kind: 'noted'; id: string; text: string; from: LogFrom; via?: string }
  | { kind: 'edited'; id: string; text: string }
  | { kind: 'done'; id: string }
  | { kind: 'dropped'; id: string }
  /** Put aside until `until`. */
  | { kind: 'snoozed'; id: string; until: number }
  /** Back to open: done, dropped or snoozed no more. */
  | { kind: 'reopened'; id: string };

export interface PersonalLog {
  seq: number;
  /** Oldest first. */
  entries: PersonalEntry[];
}

export const EMPTY_PERSONAL_LOG: PersonalLog = { seq: 0, entries: [] };

/** The longest an entry can be: a thought, not a document. */
export const MAX_ENTRY = 2000;

/** An entry's text as it's kept: trimmed, and not empty or too long. */
export function entryText(text: unknown): string {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed) throw new Error('Say what to remember');
  if (trimmed.length > MAX_ENTRY) throw new Error(`Keep it under ${MAX_ENTRY} characters`);
  return trimmed;
}

/** Where an entry says it was jotted down: off the ship only when it says so. */
export const logFrom = (from: unknown): LogFrom => (from === 'remote' ? 'remote' : 'office');

/** What the captain did with an entry: every fact but jotting one down. */
export type PersonalMark = Exclude<PersonalFact, { kind: 'noted' }>;

/** The mark a request asks for on entry `id` (`{ kind, text?, until? }`), or why it can't be one. An edit's text is
 * checked by `entryText` as it's kept. */
export function personalMark(id: string, body: unknown): PersonalMark {
  const { kind, text, until }: { kind?: unknown; text?: unknown; until?: unknown } = body && typeof body === 'object' ? body : {};
  switch (kind) {
    case 'edited':
      return { kind, id, text: typeof text === 'string' ? text : '' };
    case 'done':
    case 'dropped':
    case 'reopened':
      return { kind, id };
    case 'snoozed':
      if (typeof until !== 'number' || !Number.isFinite(until)) throw new Error('Say until when');
      return { kind, id, until };
    default:
      throw new Error('kind must be one of edited, done, dropped, snoozed, reopened');
  }
}

/** The entry `id` of the log, or why there's none. */
export function entryIn(entries: readonly PersonalEntry[], id: string): PersonalEntry {
  const entry = entries.find((e) => e.id === id);
  if (!entry) throw new Error('No such entry in your personal log');
  return entry;
}

/** What the personal log adds up to with one more fact (stamped with its number and time). */
export function evolvePersonalLog(log: PersonalLog, fact: PersonalFact & { seq: number; t: number }): PersonalLog {
  const seq = fact.seq;
  if (fact.kind === 'noted') {
    if (log.entries.some((e) => e.id === fact.id)) return { ...log, seq };
    return { seq, entries: [...log.entries, { id: fact.id, text: fact.text, from: fact.from, ...(fact.via && { via: fact.via }), at: fact.t, status: 'open' }] };
  }
  const change = (e: PersonalEntry): PersonalEntry => {
    switch (fact.kind) {
      case 'edited':
        return { ...e, text: fact.text };
      case 'done':
      case 'dropped':
        return { ...e, status: fact.kind, until: undefined, closedAt: fact.t };
      case 'snoozed':
        return { ...e, status: 'open', until: fact.until, closedAt: undefined };
      case 'reopened':
        return { ...e, status: 'open', until: undefined, closedAt: undefined };
    }
  };
  return { seq, entries: log.entries.map((e) => (e.id === fact.id ? change(e) : e)) };
}

/** Whether an entry is put aside right now. */
export const snoozed = (e: PersonalEntry, now: number) => e.status === 'open' && e.until !== undefined && e.until > now;

export interface PersonalLogView {
  /** What's on your mind, newest first: the open entries, those whose snooze has passed among them. */
  open: PersonalEntry[];
  /** Put aside, the soonest back first. */
  later: PersonalEntry[];
  /** Done or dropped, the latest first, the last `CLOSED_SHOWN` of them. */
  closed: PersonalEntry[];
}

export const CLOSED_SHOWN = 20;

/** The log as the console lays it out at `now`. */
export function personalLogView(entries: readonly PersonalEntry[], now: number): PersonalLogView {
  const open = entries.filter((e) => e.status === 'open' && !snoozed(e, now)).sort((a, b) => b.at - a.at);
  const later = entries.filter((e) => snoozed(e, now)).sort((a, b) => (a.until ?? 0) - (b.until ?? 0));
  const closed = entries.filter((e) => e.status !== 'open').sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0)).slice(0, CLOSED_SHOWN);
  return { open, later, closed };
}

export type SnoozeFor = 'tomorrow' | 'week';

/** When an entry put aside `for` is back: nine in the morning, the next day or a week on (local time). */
export function snoozeUntil(now: Date, span: SnoozeFor): number {
  const back = new Date(now);
  back.setDate(back.getDate() + (span === 'tomorrow' ? 1 : 7));
  back.setHours(9, 0, 0, 0);
  return back.getTime();
}
