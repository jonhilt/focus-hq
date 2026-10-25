import type { DecisionRecord, LedgerEntry, LedgerEvent } from './ledger';
import { fieldsOf, isOneOf, isRecord } from './records';

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

/** A goal's decisions: open ones (still to make) and decided ones (still standing). */
export interface GoalDecisions {
  open: Decision[];
  decided: Decision[];
}

/** A goal's decisions, oldest raised first: open ones (still to make) and decided ones (still standing), superseded ones left out. */
export function goalDecisions(events: LedgerEvent[], goalId: string): GoalDecisions {
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
export function lineProblem(value: unknown): string | undefined {
  const line = fieldsOf(value);
  if (line.kind === 'intent') return intentProblem(line);
  if (line.kind === 'decision') return decisionProblem(line);
  return undefined;
}

type DecisionEntry = Extract<LedgerEntry, { kind: 'decision' }>;

/** What a lead sends to raise a decision on their goal, or change one still open (`id`): never to decide it. */
export interface RaiseInput {
  question: string;
  options: string[];
  /** The option the lead would pick, for whoever decides it. */
  proposed?: string;
  id?: string;
}

/** The most options a decision is raised with. */
export const MAX_OPTIONS = 6;

/**
 * A lead raising a decision on their goal, or changing one of its open ones (its question, options, or what they'd
 * propose): the line to write, or why not. Only the captain or the chief of staff decides it (`settleDecision`), and
 * a decided one isn't raised again: a new one supersedes it. A new decision's id is the goal's and its number in it.
 */
export function raiseDecision(events: LedgerEvent[], goal: { id: string; title: string }, lead: string, input: RaiseInput): { entry: DecisionEntry } | { problem: string } {
  const register = decisionRegister(events);
  const options = input.options.map((o) => o.trim()).filter(Boolean);
  const proposed = input.proposed?.trim() || undefined;
  if (options.length < 2 || options.length > MAX_OPTIONS) return { problem: `A decision needs 2 to ${MAX_OPTIONS} options` };
  if (proposed && !options.includes(proposed)) return { problem: 'What you propose has to be one of the options, word for word' };
  const was = input.id ? register.get(input.id) : undefined;
  if (input.id && was?.goalId !== goal.id) return { problem: `There’s no decision ${input.id} on your goal` };
  if (was && was.status !== 'open') return { problem: `${was.id} is ${was.status} already: it isn’t raised again` };
  const ofGoal = [...register.values()].filter((d) => d.goalId === goal.id).length;
  const entry: DecisionEntry = {
    kind: 'decision', id: was?.id ?? `${goal.id}.d${ofGoal + 1}`, status: 'open', goalId: goal.id, goal: goal.title, owner: was?.owner ?? lead, by: lead,
    question: input.question.trim(), options, ...(proposed && { proposed }),
  };
  const problem = lineProblem(entry);
  return problem ? { problem: `The decision ${problem}` } : { entry };
}

/**
 * An open decision decided (by the captain, or a plugin by its id where the captain lets it): the line to write, or why
 * not. `chosen` is one of its options; the others go down as rejected, with `why` (or that `by` chose otherwise).
 */
export function settleDecision(events: LedgerEvent[], id: string, by: string, chosen: string, rationale?: string, why?: string): { entry: DecisionEntry } | { problem: string } {
  const was = decisionRegister(events).get(id);
  if (!was) return { problem: `There’s no decision ${id}` };
  if (was.status !== 'open') return { problem: `${id} is ${was.status} already` };
  const { raisedAt: _r, at: _a, projectId: _p, supersededBy: _s, ...record } = was;
  const rejected = was.options.filter((o) => o !== chosen).map((option) => ({ option, why: why?.trim() || `${by} chose ${chosen}` }));
  const entry: DecisionEntry = { ...record, kind: 'decision', status: 'decided', by, chosen, ...(rationale?.trim() && { rationale: rationale.trim() }), ...(rejected.length && { rejected }) };
  const problem = lineProblem(entry);
  return problem ? { problem: `The decision ${problem}` } : { entry };
}

/**
 * Whether a decision line may follow the ones before it, as Ops writes it, or why not: it stays on its goal, a decided
 * one changes no further (it's superseded by another, never reopened or decided again), and one that supersedes
 * another names one that was decided, on the same goal.
 */
export function decisionChangeProblem(events: LedgerEvent[], entry: DecisionEntry): string | undefined {
  const register = decisionRegister(events);
  const was = register.get(entry.id);
  if (was && was.goalId !== entry.goalId) return `${entry.id} is another goal’s`;
  if (was && was.status !== 'open') return `${entry.id} is ${was.status} already: a new decision supersedes it instead`;
  const old = entry.supersedes ? register.get(entry.supersedes) : undefined;
  if (entry.supersedes && (old?.status !== 'decided' || old.goalId !== entry.goalId)) return `${entry.supersedes} isn’t a decision of this goal’s that stands`;
  return undefined;
}

/**
 * Why the lead can't ask the captain to decide `id` with these options' labels, or nothing: it's an open decision of
 * their goal, and each label is one of its options word for word, so the pick says which was chosen.
 */
export function askProblem(events: LedgerEvent[], goalId: string, id: string, labels: string[]): string | undefined {
  const d = decisionRegister(events).get(id);
  if (d?.goalId !== goalId) return `There’s no decision ${id} on your goal`;
  if (d.status !== 'open') return `${id} is ${d.status} already`;
  const odd = labels.filter((l) => !d.options.includes(l.trim()));
  return odd.length ? `Label each option as one of ${id}’s options, word for word (${odd.map((l) => `“${l}”`).join(', ')} isn’t)` : undefined;
}
