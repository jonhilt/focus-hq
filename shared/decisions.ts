import type { DecisionRecord, LedgerEntry, LedgerEvent } from './ledger';
import { isOneOf, isRecord } from './records';

// A project's or goal's intent and a goal's decisions, read back from the ledger's `intent` and `decision` lines: kept as typed records,
// not prose, so an open question can't go quiet and a settled one has a record to point to. Each line is whole (every
// field again), so reading them back is taking the latest per goal or per decision, never patching one up.

/** Where a decision stands: waiting to be made, made, or replaced by a later one that `supersedes` it. */
export const DECISION_STATUSES = ['open', 'decided', 'superseded'] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

type Of<K extends LedgerEvent['kind']> = Extract<LedgerEvent, { kind: K }>;

/** A decision as it stands now: its latest line, when it was first raised, and what replaced it, if anything did. */
export interface Decision extends DecisionRecord {
  /** When it was first raised, and when its latest line was written. */
  raisedAt: number;
  at: number;
  projectId: string;
  /** The decision that supersedes this one: its status reads `superseded` from then on. */
  supersededBy?: string;
}

/**
 * Every decision in the ledger by id, as its latest line has it. A decision another one `supersedes` reads as
 * superseded, whatever its own lines say, once the other's been decided (even if that one's since been replaced too): an
 * open proposal to replace it replaces nothing yet.
 */
export function decisionRegister(events: LedgerEvent[], projectId?: string): Map<string, Decision> {
  const register = new Map<string, Decision>();
  for (const e of events) {
    if (e.kind !== 'decision' || (projectId && e.projectId !== projectId)) continue;
    const { kind: _k, seq: _s, ...record } = e;
    register.set(e.id, { ...record, raisedAt: register.get(e.id)?.raisedAt ?? e.at });
  }
  for (const d of register.values()) {
    const old = d.supersedes ? register.get(d.supersedes) : undefined;
    // a replacement that was decided replaced it, even once it was replaced in turn: one with something chosen
    if (old && d.chosen !== undefined) register.set(old.id, { ...old, status: 'superseded', supersededBy: d.id });
  }
  return register;
}

/** A goal's decisions, oldest raised first: open ones (still to make) and decided ones (still standing), superseded ones left out. */
export function goalDecisions(events: LedgerEvent[], goalId: string): { open: Decision[]; decided: Decision[] } {
  const all = [...decisionRegister(events).values()].filter((d) => d.goalId === goalId).sort((a, b) => a.raisedAt - b.raisedAt);
  return { open: all.filter((d) => d.status === 'open'), decided: all.filter((d) => d.status === 'decided') };
}

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

/** What's wrong with a `decision` line read back (or about to be written), or nothing. */
function decisionProblem(line: Record<string, unknown>): string | undefined {
  const missing = ['id', 'goalId', 'goal', 'owner', 'by', 'question'].filter((k) => !text(line[k]));
  if (missing.length) return `has no ${missing.join(', ')}`;
  if (!isOneOf(DECISION_STATUSES, line.status)) return `has a status that isn’t ${DECISION_STATUSES.join(', ')}`;
  if (!texts(line.options)) return 'has options that aren’t a list of words';
  const bad = ['proposed', 'chosen', 'rationale', 'supersedes'].filter((k) => !maybe(line[k]));
  if (bad.length) return `has ${bad.join(', ')} that aren’t words`;
  if (line.rejected !== undefined && !(Array.isArray(line.rejected) && line.rejected.every((r) => isRecord(r) && text(r.option) && text(r.why)))) return 'has rejected options without an option and why';
  if (line.status === 'decided' && line.chosen === undefined) return 'is decided with nothing chosen';
  if (line.status === 'open' && line.chosen !== undefined) return 'is open with something chosen';
  if (line.supersedes === line.id) return 'supersedes itself';
  return undefined;
}

/**
 * What's wrong with a ledger line of a kind with a shape to keep (`intent`, `decision`), or nothing: checked as the
 * ledger loads, so a broken one is reported and left out rather than read as a record, and by whoever writes one.
 */
export function lineProblem(line: Record<string, unknown>): string | undefined {
  if (line.kind === 'intent') return intentProblem(line);
  if (line.kind === 'decision') return decisionProblem(line);
  return undefined;
}
