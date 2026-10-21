// A machine laid out to draw: ELK's layered layout (elkjs), left to right, compound states as boxes round their
// children, each arrow carrying every event that takes it, and those taken from any state drawn from a box of their own. A machine's layout is the same for every run of it, so it's
// made once as Focus starts and the runs are drawn over it (draw.ts).
import ELK, { type ElkExtendedEdge, type ElkNode } from 'elkjs/lib/elk.bundled.js';
import type { MachineGraph, MachineTransition } from '../../plugin-api/shared';
import { ANY_STATE, type LaidEdge, type LaidState, type MachineLayout } from './shared';

/** Roughly how wide a character is, for the label sizes ELK leaves room for. */
const STATE_CH = 9;
const EDGE_CH = 7;
const STATE_H = 34;
const COMPOUND_PAD = '[top=32,left=14,bottom=14,right=14]';
/** What the box the transitions taken from any state leave from says. */
export const ANY_LABEL = 'any state';
const ANYWHERE: Pick<LaidState, 'id' | 'key' | 'kind'> = { id: ANY_STATE, key: ANY_LABEL, kind: 'anywhere' };

/** A transition's label: its events, and the guard they share. */
const labelOf = (events: string[], guard?: string): string => `${events.join(' | ')}${guard ? ` [${guard}]` : ''}`;

/** The transitions as arrows: one per from, to and guard, with every event that takes it; those from any state ('') from ANY_STATE. */
export function arrows(transitions: readonly MachineTransition[]): { from: string; to: string; label: string }[] {
  const grouped = new Map<string, { from: string; to: string; guard?: string; events: string[] }>();
  for (const t of transitions) {
    const from = t.from || ANY_STATE;
    const key = `${from}→${t.to}[${t.guard ?? ''}]`;
    const arrow = grouped.get(key) ?? { from, to: t.to, guard: t.guard, events: [] };
    arrow.events.push(t.event);
    grouped.set(key, arrow);
  }
  return [...grouped.values()].map((a) => ({ from: a.from, to: a.to, label: labelOf(a.events, a.guard) }));
}

/** The machine as ELK's graph: its states nested as they are, the arrows at the top (ELK routes them through the boxes). */
export function elkGraph(graph: MachineGraph): ElkNode {
  const nodes = new Map<string, ElkNode>();
  const top: ElkNode[] = [];
  for (const s of graph.states) {
    const label = { text: s.key, width: s.key.length * STATE_CH, height: 16 };
    const node: ElkNode = s.kind === 'compound'
      ? { id: s.id, labels: [label], layoutOptions: { 'elk.padding': COMPOUND_PAD }, children: [] }
      : { id: s.id, labels: [label], width: Math.max(80, s.key.length * STATE_CH + 24), height: STATE_H };
    nodes.set(s.id, node);
    const parent = s.parent ? nodes.get(s.parent) : undefined;
    (parent?.children ?? top).push(node);
  }
  if (graph.transitions.some((t) => !t.from)) top.unshift({ id: ANY_STATE, labels: [{ text: ANY_LABEL, width: ANY_LABEL.length * STATE_CH, height: 16 }], width: ANY_LABEL.length * STATE_CH + 24, height: STATE_H });
  const edges: ElkExtendedEdge[] = arrows(graph.transitions).map((a, i) => ({ id: `e${i}`, sources: [a.from], targets: [a.to], labels: [{ text: a.label, width: a.label.length * EDGE_CH, height: 14 }] }));
  return {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.layered.spacing.nodeNodeBetweenLayers': '44',
      'elk.spacing.nodeNode': '22',
      'elk.spacing.edgeLabel': '4',
      'elk.padding': '[top=16,left=16,bottom=16,right=16]',
    },
    children: top,
    edges,
  };
}

/** ELK's answer as boxes and arrows in the drawing's own coordinates: ELK gives each relative to what it's in. */
export function laidOut(graph: MachineGraph, laid: ElkNode): MachineLayout {
  const kinds = new Map(graph.states.map((s) => [s.id, s]));
  const states: LaidState[] = [];
  const origin = new Map<string, { x: number; y: number }>([['root', { x: 0, y: 0 }]]);
  const edges: LaidEdge[] = [];
  const visit = (node: ElkNode, ox: number, oy: number): void => {
    for (const child of node.children ?? []) {
      const x = ox + (child.x ?? 0);
      const y = oy + (child.y ?? 0);
      origin.set(child.id, { x, y });
      const state = child.id === ANY_STATE ? ANYWHERE : kinds.get(child.id);
      if (state) states.push({ id: state.id, key: state.key, kind: state.kind, x, y, w: child.width ?? 0, h: child.height ?? 0 });
      visit(child, x, y);
    }
  };
  visit(laid, 0, 0);
  const collect = (node: ElkNode): void => {
    for (const e of node.edges ?? []) {
      // an edge's points are relative to the box it's in (its container)
      const o = origin.get(e.container ?? node.id) ?? { x: 0, y: 0 };
      const at = (p: { x: number; y: number }) => ({ x: o.x + p.x, y: o.y + p.y });
      const section = e.sections?.[0];
      const label = e.labels?.[0];
      edges.push({
        from: e.sources[0],
        to: e.targets[0],
        label: label?.text ?? '',
        points: section ? [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map(at) : [],
        ...(label && { at: at({ x: label.x ?? 0, y: label.y ?? 0 }) }),
      });
    }
    for (const child of node.children ?? []) collect(child);
  };
  collect(laid);
  return { id: graph.id, title: graph.title, about: graph.about, runs: graph.runs, width: laid.width ?? 0, height: laid.height ?? 0, states, edges };
}

const elk = new ELK();

/** Lays `graph` out. */
export async function layOut(graph: MachineGraph): Promise<MachineLayout> {
  return laidOut(graph, await elk.layout(elkGraph(graph)));
}
