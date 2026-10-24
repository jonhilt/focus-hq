// What both halves of the intents plugin (README.md) share: a project's compass, what its work is for, read from the
// ledger's `intent` lines (the core's one intent format), and the lines a change to it writes, or why it's refused.
import { intentEntry, type IntentFields, type LedgerEntry, type LedgerEvent, projectIntents } from '../../plugin-api/shared';

export const INTENTS = 'intents';

/** Who agrees a project's intents: only the user's own save writes one. */
export const AGREED_BY = 'the user';

/** How many intents a compass holds at most: a few lasting outcomes, not a task list. */
export const MOST_INTENTS = 8;

/** How long an intent, or what a project is for, may be. */
const WHAT_LIMIT = 400;

type IntentLine = Extract<LedgerEvent, { kind: 'intent' }>;

/** One of a project's intents as it stands: its latest line, by whom and when it was set, and why it last changed. */
export interface Intent {
  id: string;
  what: string;
  why?: string;
  by: string;
  at: number;
}

/** A project's compass: what it's for, with the guardrails for how its work is done, and its intents, first set first. */
export interface Compass {
  about?: Omit<Intent, 'id'> & { guardrails: string[] };
  intents: Intent[];
}

export interface IntentsState {
  compasses: Record<string, Compass>;
}

export const freshIntents = (): IntentsState => ({ compasses: {} });

const asIntent = (e: IntentLine): Intent => ({ id: e.id ?? '', what: e.what, ...(e.why && { why: e.why }), by: e.by, at: e.at });

/**
 * Project `projectId`'s compass as its own intent lines stand (the core's `projectIntents`: the latest line for each
 * id, first set first, those retired left out): the one with no id is what the project is for.
 */
export function compassOf(events: readonly LedgerEvent[], projectId: string): Compass {
  const lines = projectIntents([...events], projectId);
  const about = lines.find((e) => !e.id);
  return {
    ...(about && { about: { what: about.what, guardrails: [...about.constraints], ...(about.why && { why: about.why }), by: about.by, at: about.at } }),
    intents: lines.filter((e) => e.id).map(asIntent),
  };
}

/** Every project's compass, from the ledger: those with any intent line of their own (a goal's aren't a project's). */
export function compasses(events: readonly LedgerEvent[]): Record<string, Compass> {
  const projects = new Set(events.flatMap((e) => (e.kind === 'intent' && e.goalId === undefined ? [e.projectId] : [])));
  return Object.fromEntries([...projects].map((p) => [p, compassOf(events, p)]));
}

/** An intent's name, if it leads with one ("Deliver value, reliably: each goal lands…"), or none. */
export function intentName(what: string): string | undefined {
  const colon = what.indexOf(': ');
  return colon > 0 && colon <= 60 ? what.slice(0, colon) : undefined;
}

/** A line's words as one, a list's bullet or number taken off ("1. ", "- ", "• "). */
const unlisted = (line: string) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').replace(/\s+/g, ' ').trim();

/** The lines of `text`, one item each, empty ones left out. */
export const itemsOf = (text: unknown): string[] => (typeof text === 'string' ? text.split('\n').map(unlisted).filter(Boolean) : []);

/** An id for a new intent from its words (its name, or its first words), not one of `taken`. */
export function newId(what: string, taken: ReadonlySet<string>): string {
  const base = (intentName(what) ?? what.split(' ').slice(0, 5).join(' ')).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'intent';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

const words = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

type Made = { entries: LedgerEntry[] } | { error: string };

/** The lines `fields` write, each through the core's one intent format, or the first one's problem. */
function written(fields: IntentFields[]): Made {
  const entries: LedgerEntry[] = [];
  for (const f of fields) {
    const made = intentEntry(f);
    if ('problem' in made) return { error: made.problem };
    entries.push(made.entry);
  }
  return { entries };
}

const tooLong = (what: string) => (what.length > WHAT_LIMIT ? `Keep it under ${WHAT_LIMIT} characters: a line, not a spec` : undefined);

/** Intents added, one a line of `text`: each a new id. */
function added(now: Compass, text: unknown, why: string): Made {
  const whats = itemsOf(text);
  if (!whats.length) return { error: 'Say what the intent is' };
  if (now.intents.length + whats.length > MOST_INTENTS) return { error: `Keep it to ${MOST_INTENTS} intents at most: a few lasting outcomes, not a task list` };
  const long = whats.map(tooLong).find(Boolean);
  if (long) return { error: long };
  const taken = new Set(now.intents.map((i) => i.id));
  return written(whats.map((what) => {
    const id = newId(what, taken);
    taken.add(id);
    return { by: AGREED_BY, id, what, ...(why && { why }) };
  }));
}

/** One intent reworded, keeping its id. */
function edited(now: Compass, id: string, what: string, why: string): Made {
  const was = now.intents.find((i) => i.id === id);
  if (!was) return { error: 'That intent isn’t one of this project’s any more' };
  if (!what) return { error: 'Say what the intent is, or retire it' };
  if (what === was.what) return { error: 'It says that already' };
  const long = tooLong(what);
  return long ? { error: long } : written([{ by: AGREED_BY, id, what, ...(why && { why }) }]);
}

/** One intent retired: its last words kept on the line, with why. */
function retired(now: Compass, id: string, why: string): Made {
  const was = now.intents.find((i) => i.id === id);
  if (!was) return { error: 'That intent isn’t one of this project’s any more' };
  if (!why) return { error: 'Say why it’s retired' };
  return written([{ by: AGREED_BY, id, what: was.what, why, retired: true }]);
}

/** What the project is for, and its guardrails (one a line of `guardrails`). */
function about(now: Compass, what: string, guardrails: unknown, why: string): Made {
  if (!what) return { error: 'Say what this project’s work is for, in a line' };
  const rails = itemsOf(guardrails);
  if (now.about?.what === what && now.about.guardrails.join('\n') === rails.join('\n')) return { error: 'It says that already' };
  const long = tooLong(what);
  return long ? { error: long } : written([{ by: AGREED_BY, what, constraints: rails, ...(why && { why }) }]);
}

/**
 * The lines a change to project's compass `compass` writes, or why it's refused: intents `add`ed (one a line), one
 * `edit`ed or `retire`d (by `id`), or what it's for and its guardrails set (`about`). `why` says why, kept on each line.
 */
export function changeLines(compass: Compass | undefined, body: Record<string, unknown>): Made {
  const now = compass ?? { intents: [] };
  const [what, why, id] = [words(body.what), words(body.why), words(body.id)];
  if (body.do === 'add') return added(now, body.text, why);
  if (body.do === 'edit') return edited(now, id, what, why);
  if (body.do === 'retire') return retired(now, id, why);
  if (body.do === 'about') return about(now, what, body.guardrails, why);
  return { error: 'Add, edit or retire an intent, or say what the project’s for' };
}
