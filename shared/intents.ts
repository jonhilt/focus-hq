import type { LedgerEntry, LedgerEvent } from './ledger';
import { fieldsOf } from './records';

// A project's or goal's intent, read back from the ledger's `intent` lines: kept as typed records, not prose. Each line
// is whole (every field again), so reading them back is taking the latest per goal or per project's id, never patching
// one up.

type Of<K extends LedgerEvent['kind']> = Extract<LedgerEvent, { kind: K }>;

/** A goal's intent: its latest `intent` line, or none yet (or none any more, retired). */
export function goalIntent(events: LedgerEvent[], goalId: string): Of<'intent'> | undefined {
  const latest = events.findLast((e): e is Of<'intent'> => e.kind === 'intent' && e.goalId === goalId);
  return latest?.retired ? undefined : latest;
}

/** The fields an intent line is written from: a goal's names the goal, a project's has none and may have an `id`. */
export interface IntentFields {
  by: string;
  what: string;
  id?: string;
  constraints?: string[];
  why?: string;
  serves?: string[];
  retired?: boolean;
  goal?: { id: string; title: string };
}

/**
 * The one way to write an intent, a project's (no `goal`) or a goal's: the line to record, or what's wrong with it.
 * Whoever keeps intents (a lead's tool, a plugin keeping a project's) writes this line, never a format of its own.
 */
export function intentEntry(fields: IntentFields): { entry: Extract<LedgerEntry, { kind: 'intent' }> } | { problem: string } {
  const { by, what, id, constraints = [], why, serves, retired, goal } = fields;
  const words = (list: string[]) => list.map((c) => c.trim()).filter(Boolean);
  const entry = {
    kind: 'intent' as const, ...(goal && { goalId: goal.id, goal: goal.title }), ...(id && { id: id.trim() }), by, what: what.trim(), constraints: words(constraints),
    ...(why?.trim() && { why: why.trim() }), ...(serves?.length && { serves: words(serves) }), ...(retired && { retired: true as const }),
  };
  const problem = lineProblem(entry);
  return problem ? { problem: `The intent ${problem}` } : { entry };
}

/** A project's own intents, not any one goal's: the latest line for each `id`, first set first, those retired left out. */
export function projectIntents(events: LedgerEvent[], projectId: string): Of<'intent'>[] {
  const latest = new Map<string, Of<'intent'>>();
  for (const e of events) if (e.kind === 'intent' && e.projectId === projectId && e.goalId === undefined) latest.set(e.id ?? '', e);
  return [...latest.values()].filter((e) => !e.retired);
}

const text = (v: unknown) => typeof v === 'string' && v.trim() !== '';
const texts = (v: unknown) => Array.isArray(v) && v.every(text);
const maybe = (v: unknown) => v === undefined || text(v);
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** What's wrong with an `intent` line read back (or about to be written), or nothing. */
function intentProblem(line: Record<string, unknown>): string | undefined {
  const missing = ['by', 'what'].filter((k) => !text(line[k]));
  if (missing.length) return `has no ${missing.join(', ')}`;
  // a project's intent has neither; a goal's has both
  if (!maybe(line.goalId) || !maybe(line.goal) || (line.goalId === undefined) !== (line.goal === undefined)) return 'has a goal without both its id and title';
  if (!texts(line.constraints)) return 'has constraints that aren’t a list of words';
  if (line.id !== undefined && !(typeof line.id === 'string' && SLUG.test(line.id))) return 'has an id that isn’t a slug (lowercase words and dashes)';
  if (!maybe(line.why)) return 'has a why that isn’t words';
  if (line.serves !== undefined && !(texts(line.serves) && line.goalId !== undefined)) return 'serves intents without being a goal’s, or names them oddly';
  if (line.retired !== undefined && line.retired !== true) return 'is retired with something other than true';
  return undefined;
}

/**
 * What's wrong with a ledger line of a kind with a shape to keep (`intent`), or nothing: checked as the ledger loads,
 * so a broken one is reported and left out rather than read as a record, and by whoever writes one.
 */
export function lineProblem(value: unknown): string | undefined {
  const line = fieldsOf(value);
  return line.kind === 'intent' ? intentProblem(line) : undefined;
}
