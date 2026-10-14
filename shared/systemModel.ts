// A system model's pure rules (docs/studio.md): whether one the studio's computer sends holds together, checking its
// cites against the code, how long its scenario plays, and where its parts stand. The same in the office (to refuse or
// check a model) and in the browser (to lay it out), so a model always lands the same way.

import { MODEL_CHANGES, MODEL_EDGE_KINDS, MODEL_KINDS, type ModelCite, type ModelEdge, type ModelNode, type ModelStep, type SystemModel } from './types';

export const MODEL_LIMITS = { nodes: 40, edges: 80, steps: 24, label: 48, question: 200, simplified: 8, checks: 5 } as const;
const L = MODEL_LIMITS;
/** How long each step of a scenario plays, and the lead-in before the first and the hold after the last (s). */
export const MODEL_TIMING = { step: 1.8, lead: 2, hold: 1.5 } as const;

const ID = /^[a-z][a-z0-9-]{0,31}$/;
const citeError = (c: ModelCite | undefined, what: string) =>
  c && !(typeof c.file === 'string' && c.file.length > 0 && Number.isInteger(c.line) && c.line >= 1) ? `${what}'s cite needs a file and a line (from 1).` : undefined;

/** Why a model won't do, or undefined if it holds together. */
export function modelError(m: SystemModel): string | undefined {
  const ids = new Set<string>();
  return sizeError(m) ?? first(m.nodes, (n) => nodeError(n, ids)) ?? first(m.edges, (e) => edgeError(e, ids)) ?? first(m.trace, (s, i) => stepError(m.edges, s, i));
}

/** The first error `check` finds in `list`, in order. */
function first<T>(list: readonly T[], check: (item: T, i: number) => string | undefined): string | undefined {
  for (const [i, item] of list.entries()) {
    const bad = check(item, i);
    if (bad) return bad;
  }
  return undefined;
}

function sizeError(m: SystemModel): string | undefined {
  if (!m.question.trim() || m.question.length > L.question) return `Say the question it answers, in at most ${L.question} characters.`;
  if (!m.nodes.length || m.nodes.length > L.nodes) return `A model has 1 to ${L.nodes} parts.`;
  if (m.edges.length > L.edges) return `A model has at most ${L.edges} connections.`;
  if (m.trace.length > L.steps) return `A scenario has at most ${L.steps} steps.`;
  if (m.simplified.length > L.simplified || (m.checks?.length ?? 0) > L.checks) return `At most ${L.simplified} simplifications and ${L.checks} checks.`;
  return undefined;
}

/** What's wrong with part `n`, adding its id to `ids` (the ids seen so far). */
function nodeError(n: ModelNode, ids: Set<string>): string | undefined {
  if (!ID.test(n.id)) return `Part id “${n.id}” needs to be short, lowercase letters, digits and dashes.`;
  if (ids.has(n.id)) return `Two parts have the id ${n.id}.`;
  ids.add(n.id);
  if (!n.label.trim() || n.label.length > L.label) return `Part ${n.id} needs a label of at most ${L.label} characters.`;
  if (!(MODEL_KINDS as readonly string[]).includes(n.kind)) return `Part ${n.id}'s kind is one of ${MODEL_KINDS.join(', ')}.`;
  if (!n.layer.trim()) return `Part ${n.id} needs a layer.`;
  if (n.change && !(MODEL_CHANGES as readonly string[]).includes(n.change)) return `Part ${n.id}'s change is one of ${MODEL_CHANGES.join(', ')}.`;
  return citeError(n.cite, `Part ${n.id}`);
}

function edgeError(e: ModelEdge, ids: ReadonlySet<string>): string | undefined {
  const name = `${e.from} → ${e.to}`;
  if (!ids.has(e.from) || !ids.has(e.to)) return `Connection ${name} names a part that isn't in the model.`;
  if (!(MODEL_EDGE_KINDS as readonly string[]).includes(e.kind)) return `Connection ${name}'s kind is one of ${MODEL_EDGE_KINDS.join(', ')}.`;
  if (e.change && !(MODEL_CHANGES as readonly string[]).includes(e.change)) return `Connection ${name}'s change is one of ${MODEL_CHANGES.join(', ')}.`;
  return citeError(e.cite, `Connection ${name}`);
}

function stepError(edges: readonly ModelEdge[], s: ModelStep, i: number): string | undefined {
  if (!edgeFor(edges, s.from, s.to)) return `Step ${i + 1} (${s.from} → ${s.to}) doesn't follow a connection in the model: add the connection, or route the step along one.`;
  if (!s.label.trim()) return `Step ${i + 1} needs a label.`;
  return undefined;
}

/** The connection a step moves along: from → to, or to → from (an answer coming back the way the call went). */
export function edgeFor(edges: readonly ModelEdge[], from: string, to: string): ModelEdge | undefined {
  return edges.find((e) => e.from === from && e.to === to) ?? edges.find((e) => e.from === to && e.to === from);
}

/** How far either side of a cited line a mention still counts. */
const NEAR = 2;

/**
 * The model with each cite checked against the code, and what didn't check out. `lines` reads a file's lines, or
 * undefined if it can't (missing, or outside what the office may read). A part is found when its file has its line and,
 * if it names a symbol, the symbol is within two lines of it; a connection is backed when the line it cites (or one
 * within two lines) mentions the part it reaches, by its symbol (or label).
 */
export function checkModel(m: SystemModel, lines: (file: string) => string[] | undefined): { model: SystemModel; problems: string[] } {
  const problems: string[] = [];
  const near = (c: ModelCite) => {
    const all = lines(c.file);
    if (!all) return { text: undefined, line: '', why: `${c.file} isn't there (or isn't one the office can read)` };
    if (c.line > all.length) return { text: undefined, line: '', why: `${short(c.file)} has only ${all.length} lines` };
    return { text: all.slice(Math.max(0, c.line - 1 - NEAR), c.line + NEAR).join('\n'), line: all[c.line - 1] ?? '', why: '' };
  };
  const byId = new Map(m.nodes.map((n) => [n.id, n]));
  const nodes = m.nodes.map((n) => {
    // what a change removed is only in the code it was removed from, not the code being checked
    if (n.change === 'removed') return n;
    if (!n.cite) {
      problems.push(`Part ${n.id} has no cite.`);
      return { ...n, found: false };
    }
    const { text, line, why } = near(n.cite);
    // an import mentions a part but isn't where it's defined (except for something outside the code, which is only imported)
    const imported = n.kind !== 'external' && /^\s*(import|using|from|require)\b/.test(line);
    const found = text !== undefined && !imported && (!n.symbol || text.includes(n.symbol));
    if (!found) problems.push(`Part ${n.id}: ${why || (imported ? `${short(n.cite.file)}:${n.cite.line} is an import, not where it's defined` : `${short(n.cite.file)}:${n.cite.line} doesn't mention ${n.symbol}`)}.`);
    return { ...n, found };
  });
  const edges = m.edges.map((e) => {
    const name = `${e.from} → ${e.to}`;
    if (e.change === 'removed') return e;
    if (!e.cite) {
      problems.push(`Connection ${name} has no cite.`);
      return { ...e, backed: false };
    }
    const to = byId.get(e.to);
    const mention = to?.symbol ?? to?.label ?? e.to;
    const { text, why } = near(e.cite);
    const backed = text !== undefined && text.includes(mention);
    if (!backed) problems.push(`Connection ${name}: ${why || `${short(e.cite.file)}:${e.cite.line} doesn't mention ${mention}`}.`);
    return { ...e, backed };
  });
  return { model: { ...m, nodes, edges }, problems };
}

const short = (file: string) => file.split(/[\\/]/).slice(-2).join('/');

/**
 * Where the scenario jumps: a step that starts neither where the step before it ended nor where it started (a fan-out
 * from the same part), so the token would leap across the diagram. Advice, not an error: say why, or add the step between.
 */
export function traceGaps(m: SystemModel): string[] {
  return m.trace.flatMap((s, i) => {
    const prev = m.trace[i - 1] as ModelStep | undefined;
    if (!prev || s.from === prev.to || s.from === prev.from) return [];
    return [`Step ${i + 1} starts at ${s.from}, but step ${i} ended at ${prev.to}: the scenario jumps there.`];
  });
}

/** How long a model's scenario plays: a lead-in, each step, and a hold. */
export function modelSeconds(m: SystemModel): number {
  return Math.min(60, Math.max(4, MODEL_TIMING.lead + m.trace.length * MODEL_TIMING.step + MODEL_TIMING.hold));
}

/** Each step's stretch of the scenario, named s1, s2…, so the scene can be retimed like any other. */
export function modelPhases(m: SystemModel): Record<string, [number, number]> {
  const { lead, step } = MODEL_TIMING;
  return Object.fromEntries(m.trace.map((_, i) => [`s${i + 1}`, [round(lead + i * step), round(lead + (i + 1) * step)] as [number, number]]));
}

const round = (x: number) => Math.round(x * 100) / 100;

/** Where a part sits in a layered layout: its column (how far down the connections it is) and its row in that column. */
export interface Slot {
  col: number;
  row: number;
}

/**
 * A layered layout of the model's parts, as a professional diagram lays one out (the Sugiyama method), computed so the
 * same model always lands the same way and no two parts share a place:
 * - loops are broken first: a connection back to a part still being followed (in the order the scenario reaches parts,
 *   then the model's order) doesn't count for the columns, so a reply or a callback can't drag everything rightwards;
 * - each part's column is the longest run of connections into it from a part nothing reaches;
 * - each column's parts are ordered by where their neighbours in the column before sit (two sweeps), to cut crossings.
 */
export function layoutLayers(m: SystemModel): { at: Map<string, Slot>; cols: number; rows: number } {
  const ids = order(m);
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of m.edges) if (e.from !== e.to) out.get(e.from)?.push(e.to);
  // depth-first from each part in order, marking connections back onto the path being followed
  const back = new Set<string>();
  const state = new Map<string, 'on' | 'done'>();
  const visit = (id: string) => {
    state.set(id, 'on');
    for (const to of out.get(id) ?? []) {
      if (state.get(to) === 'on') back.add(`${id}>${to}`);
      else if (!state.has(to)) visit(to);
    }
    state.set(id, 'done');
  };
  for (const id of ids) if (!state.has(id)) visit(id);
  const forward = m.edges.filter((e) => e.from !== e.to && !back.has(`${e.from}>${e.to}`));
  // longest path: with the loops broken it settles within a pass per part
  const col = new Map(ids.map((id) => [id, 0]));
  for (let pass = 0; pass < ids.length; pass++) {
    let moved = false;
    for (const e of forward) {
      const next = (col.get(e.from) ?? 0) + 1;
      if (next > (col.get(e.to) ?? 0)) {
        col.set(e.to, next);
        moved = true;
      }
    }
    if (!moved) break;
  }
  const cols = Math.max(...col.values()) + 1;
  const columns: string[][] = Array.from({ length: cols }, () => []);
  for (const id of ids) columns[col.get(id) ?? 0].push(id);
  // order each column by its neighbours' rows in the column before (and after, on the way back), to cut crossings
  const rowOf = () => new Map(columns.flatMap((c) => c.map((id, i) => [id, i] as const)));
  const near = (id: string, side: -1 | 1) => forward.filter((e) => (side < 0 ? e.to === id : e.from === id)).map((e) => (side < 0 ? e.from : e.to)).filter((x) => col.get(x) === (col.get(id) ?? 0) + side);
  for (const side of [-1, 1, -1] as const) {
    const rows = rowOf();
    const range = side < 0 ? columns.keys() : [...columns.keys()].reverse();
    for (const c of range) {
      const keyed = columns[c].map((id, i) => {
        const n = near(id, side);
        return { id, key: n.length ? n.reduce((sum, x) => sum + (rows.get(x) ?? 0), 0) / n.length : i };
      });
      columns[c] = keyed.sort((a, b) => a.key - b.key).map((k) => k.id);
    }
  }
  const at = new Map<string, Slot>();
  columns.forEach((c, ci) => c.forEach((id, row) => at.set(id, { col: ci, row })));
  return { at, cols, rows: Math.max(...columns.map((c) => c.length)) };
}

/** The parts in the order the scenario first reaches them, then the rest in the model's order. */
function order(m: SystemModel): string[] {
  const seen: string[] = [];
  for (const s of m.trace) for (const id of [s.from, s.to]) if (!seen.includes(id) && m.nodes.some((n) => n.id === id)) seen.push(id);
  for (const n of m.nodes) if (!seen.includes(n.id)) seen.push(n.id);
  return seen;
}

/**
 * What the office tells whoever sent a model after checking it: what didn't check out (drawn flagged), where the
 * scenario jumps, and whether it's too big to take in, each with what to do about it.
 */
export function modelReport(m: SystemModel, problems: readonly string[]): string {
  const checked = problems.length
    ? `The check against the code found ${problems.length} problem${problems.length === 1 ? '' : 's'}, drawn flagged in red: ${problems.join(' ')} Fix each (cite the line that really does it, or drop what isn't in the code) and send the model again under the same id.`
    : 'Every cite checked out against the code.';
  const gaps = traceGaps(m);
  const jumps = gaps.length ? ` Where the scenario jumps (add the step between, or say why it jumps): ${gaps.join(' ')}` : '';
  const size = m.nodes.length > 16 ? ` It has ${m.nodes.length} parts: more than 16 is hard to take in, so fold the plumbing into the parts it serves.` : '';
  return `${checked}${jumps}${size}`;
}
