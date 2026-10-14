// A system model's pure rules (docs/studio.md): whether one the studio's computer sends holds together, checking its
// cites against the code, how long its scenario plays, and where its parts stand. The same in the office (to refuse or
// check a model) and in the browser (to lay it out), so a model always lands the same way.

import { MODEL_EDGE_KINDS, MODEL_KINDS, type ModelCite, type ModelEdge, type ModelNode, type ModelStep, type SystemModel } from './types';

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
  return citeError(n.cite, `Part ${n.id}`);
}

function edgeError(e: ModelEdge, ids: ReadonlySet<string>): string | undefined {
  const name = `${e.from} → ${e.to}`;
  if (!ids.has(e.from) || !ids.has(e.to)) return `Connection ${name} names a part that isn't in the model.`;
  if (!(MODEL_EDGE_KINDS as readonly string[]).includes(e.kind)) return `Connection ${name}'s kind is one of ${MODEL_EDGE_KINDS.join(', ')}.`;
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
    if (!all) return { text: undefined, why: `${c.file} isn't there (or isn't one the office can read)` };
    if (c.line > all.length) return { text: undefined, why: `${short(c.file)} has only ${all.length} lines` };
    return { text: all.slice(Math.max(0, c.line - 1 - NEAR), c.line + NEAR).join('\n'), why: '' };
  };
  const byId = new Map(m.nodes.map((n) => [n.id, n]));
  const nodes = m.nodes.map((n) => {
    if (!n.cite) {
      problems.push(`Part ${n.id} has no cite.`);
      return { ...n, found: false };
    }
    const { text, why } = near(n.cite);
    const found = text !== undefined && (!n.symbol || text.includes(n.symbol));
    if (!found) problems.push(`Part ${n.id}: ${why || `${short(n.cite.file)}:${n.cite.line} doesn't mention ${n.symbol}`}.`);
    return { ...n, found };
  });
  const edges = m.edges.map((e) => {
    const name = `${e.from} → ${e.to}`;
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

/** How a model's parts are spaced: columns `gapX` apart, up to `stack` parts one above another `gapY` apart from `base` up, then another stack `gapZ` behind. */
export const MODEL_LAYOUT = { gapX: 3, gapY: 1.5, gapZ: 2, base: 1.2, stack: 4 } as const;

/**
 * Where each part stands on the stage: in columns by how far down the connections it is (the parts nothing reaches
 * first, on the left as seen from the front), a column's parts stacked one above another like a diagram standing up,
 * then in another stack behind once a column's full; centred, and squeezed across to fit within `radius`. Computed, so
 * the same model always lands the same way.
 */
export function layoutModel(m: SystemModel, radius = 5): Map<string, { x: number; y: number; z: number }> {
  const depth = new Map(m.nodes.map((n) => [n.id, 0]));
  // longest path from a source, relaxed at most once per part, so a cycle can't run on
  for (let pass = 0; pass < m.nodes.length; pass++) {
    let moved = false;
    for (const e of m.edges) {
      if (e.from === e.to) continue;
      const next = (depth.get(e.from) ?? 0) + 1;
      if (next > (depth.get(e.to) ?? 0) && next < m.nodes.length) {
        depth.set(e.to, next);
        moved = true;
      }
    }
    if (!moved) break;
  }
  const columns = new Map<number, string[]>();
  for (const n of m.nodes) {
    const d = depth.get(n.id) ?? 0;
    columns.set(d, [...(columns.get(d) ?? []), n.id]);
  }
  const ordered = [...columns.keys()].sort((a, b) => a - b);
  const { gapX, gapY, gapZ, base, stack } = MODEL_LAYOUT;
  const deepest = Math.max(...ordered.map((d) => Math.ceil((columns.get(d)?.length ?? 1) / stack)));
  const spanX = Math.max(0.001, ((ordered.length - 1) / 2) * gapX);
  const k = Math.min(1, (radius * 0.9) / spanX);
  const out = new Map<string, { x: number; y: number; z: number }>();
  ordered.forEach((d, ci) => {
    const ids = columns.get(d) ?? [];
    const tall = Math.min(stack, ids.length);
    ids.forEach((id, i) => {
      const row = i % stack;
      const back = Math.floor(i / stack);
      out.set(id, {
        x: (ci - (ordered.length - 1) / 2) * gapX * k,
        // a short column sits round the middle of a full one's height
        y: base + ((stack - tall) / 2 + (tall - 1 - row)) * gapY,
        z: ((deepest - 1) / 2 - back) * gapZ,
      });
    });
  });
  return out;
}
