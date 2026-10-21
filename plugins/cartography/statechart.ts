// A state chart a lead shows with the statechart tool (statechartTool.ts), as data: what makes one legible (a strict
// top-down tree, short text, every branch asking its question), and its flow as mermaid source. Pure.

export type NodeKind = 'works' | 'bug' | 'fix' | 'risk' | 'branch';
export type ActorKind = 'person' | 'staff' | 'system' | 'other';
export type PropStatus = 'holds' | 'broken' | 'unchecked';
export type Severity = 'hi' | 'med' | 'lo';

export interface ChartNode {
  id: string;
  /** What's so at this point; a branch has none (it's drawn as an empty diamond, its question on the edge into it). */
  text?: string;
  kind: NodeKind;
}

export interface ChartEdge {
  from: string;
  to: string;
  label?: string;
}

export interface ChartCite {
  file: string;
  line: number;
}

export interface ChartProp {
  id: string;
  text: string;
  status: PropStatus;
  note?: string;
}

export interface ChartRisk {
  id: string;
  severity: Severity;
  title: string;
  path: string;
  where: ChartCite[];
}

export interface Statechart {
  title: string;
  source: string;
  nodes: ChartNode[];
  edges: ChartEdge[];
  actors?: { name: string; kind: ActorKind }[];
  leftOut?: string;
  triggers?: { transition: string; actor: string; guard: string; where: ChartCite[] }[];
  properties?: { safety?: ChartProp[]; liveness?: ChartProp[] };
  risks?: ChartRisk[];
  open?: string[];
  formal?: string;
}

/** The longest a node's text and an edge's label may be, and where each is wrapped. */
export const NODE_MAX = 90;
export const LABEL_MAX = 50;
export const NODE_WRAP = 28;
export const LABEL_WRAP = 22;

/** Text on one line: hand-made breaks (`<br/>`, newlines) are dropped, since the chart wraps it itself. */
export const flat = (s: string): string => s.replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim();

/** `text` broken into lines of at most `width` characters at spaces (a longer word keeps a line to itself). */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const word of flat(text).split(' ').filter(Boolean)) {
    const last = lines.length - 1;
    if (last >= 0 && lines[last].length + 1 + word.length <= width) lines[last] += ` ${word}`;
    else lines.push(word);
  }
  return lines;
}

// mermaid's own entity codes (#quot; and the like), so nothing a lead writes can close a string or a shape, or reach
// the page as markup: mermaid turns each back into the character as it draws
const MERMAID_ENTITIES: Record<string, string> = { '"': '#quot;', '#': '#35;', '<': '#lt;', '>': '#gt;', '&': '#amp;', '`': '#96;', '|': '#124;', '[': '#91;', ']': '#93;', '{': '#123;', '}': '#125;', '(': '#40;', ')': '#41;', ';': '#59;' };

/** One line of text, safe inside a mermaid quoted string. */
export const mermaidEscape = (s: string): string => s.replace(/["#<>&`|[\]{}();]/g, (c) => MERMAID_ENTITIES[c] ?? c);

/** Text wrapped at `width` and escaped for a mermaid quoted string, its lines joined by mermaid's line break. */
export const mermaidText = (s: string, width: number): string => wrap(s, width).map(mermaidEscape).join('<br/>');

export interface ChartProblems {
  /** What keeps it from being drawn: every one, for the lead to fix and send again. */
  errors: string[];
  /** Drawn anyway, but worth fixing. */
  warnings: string[];
}

const count = <T>(items: readonly T[], key: (t: T) => string): Map<string, number> => {
  const out = new Map<string, number>();
  for (const t of items) out.set(key(t), (out.get(key(t)) ?? 0) + 1);
  return out;
};

const dupes = (ids: readonly string[]): string[] => [...count(ids, (s) => s)].filter(([, n]) => n > 1).map(([id]) => id);

/** The nodes no edge goes into. */
export const roots = (c: Pick<Statechart, 'nodes' | 'edges'>): ChartNode[] => {
  const into = new Set(c.edges.map((e) => e.to));
  return c.nodes.filter((n) => !into.has(n.id));
};

/** The nodes reachable from `from`, in the order a depth-first walk meets them, children in the edges' order. */
export function walk(c: Pick<Statechart, 'nodes' | 'edges'>, from: string): string[] {
  const seen: string[] = [];
  const visit = (id: string) => {
    if (seen.includes(id)) return;
    seen.push(id);
    for (const e of c.edges) if (e.from === id) visit(e.to);
  };
  visit(from);
  return seen;
}

/** A strict top-down tree: one root, one arrow into every other node, no loops, every edge between nodes there are. */
function treeProblems(c: Statechart): string[] {
  const out: string[] = [];
  const ids = new Set(c.nodes.map((n) => n.id));
  for (const id of dupes(c.nodes.map((n) => n.id))) out.push(`Two nodes have the id "${id}": give each its own.`);
  for (const e of c.edges) for (const end of [e.from, e.to]) if (!ids.has(end)) out.push(`The edge ${e.from} → ${e.to} names "${end}", which isn't a node.`);
  for (const [id, n] of count(c.edges, (e) => e.to)) {
    if (n > 1 && ids.has(id)) out.push(`${n} arrows go into "${id}" (from ${c.edges.filter((e) => e.to === id).map((e) => e.from).join(', ')}): only one may. Repeat a short end node under each instead.`);
  }
  const top = roots(c);
  if (top.length !== 1) out.push(top.length ? `There are ${top.length} roots (${top.map((n) => n.id).join(', ')}): there must be one, where the story starts.` : 'Every node has an arrow into it, so there\'s no root: the chart loops back on itself.');
  const reached = new Set(top.length === 1 ? walk(c, top[0].id) : []);
  const lost = top.length === 1 ? c.nodes.filter((n) => !reached.has(n.id)) : [];
  if (lost.length) out.push(`${lost.map((n) => n.id).join(', ')} can't be reached from the root: an arrow loops back. Draw no arrows back up; repeat a short end node instead.`);
  return out;
}

/** A branch asks a question (the label of the arrow into it) and has at least two answers. */
function branchProblems(c: Statechart): string[] {
  return c.nodes.filter((n) => n.kind === 'branch').flatMap((n) => {
    const out: string[] = [];
    const outs = c.edges.filter((e) => e.from === n.id).length;
    if (outs < 2) out.push(`Branch "${n.id}" has ${outs} arrow${outs === 1 ? '' : 's'} out of it: a branch needs at least two answers.`);
    const into = c.edges.find((e) => e.to === n.id);
    if (!into) out.push(`Branch "${n.id}" is the root: start with a box saying where things stand.`);
    else if (!into.label?.trim()) out.push(`The arrow into branch "${n.id}" (from ${into.from}) needs a label: the branch's question, like "what does the client do?".`);
    return out;
  });
}

function textProblems(c: Statechart): string[] {
  const out: string[] = [];
  for (const n of c.nodes) {
    const text = flat(n.text ?? '');
    if (n.kind !== 'branch' && !text) out.push(`Node "${n.id}" has no text.`);
    if (text.length > NODE_MAX) out.push(`Node "${n.id}" is ${text.length} characters: keep it to ${NODE_MAX}.`);
  }
  for (const e of c.edges) {
    const label = flat(e.label ?? '');
    if (label.length > LABEL_MAX) out.push(`The label on ${e.from} → ${e.to} is ${label.length} characters: keep it to ${LABEL_MAX}.`);
  }
  return out;
}

/** Properties are P1, P2…, risks R1, R2…, each id once. */
function idProblems(c: Statechart): string[] {
  const props = [...(c.properties?.safety ?? []), ...(c.properties?.liveness ?? [])].map((p) => p.id);
  const risks = (c.risks ?? []).map((r) => r.id);
  return [
    ...props.filter((id) => !/^P\d+$/.test(id)).map((id) => `Property "${id}" should be named P1, P2 and so on.`),
    ...risks.filter((id) => !/^R\d+$/.test(id)).map((id) => `Risk "${id}" should be named R1, R2 and so on.`),
    ...dupes(props).map((id) => `Two properties are ${id}.`),
    ...dupes(risks).map((id) => `Two risks are ${id}.`),
  ];
}

/** Everything that keeps `c` from being drawn, and what's worth fixing though it's drawn. */
export function chartProblems(c: Statechart): ChartProblems {
  const errors = c.nodes.length ? [...treeProblems(c), ...branchProblems(c), ...textProblems(c), ...idProblems(c)] : ['The chart has no nodes.'];
  const kinds = new Map(c.nodes.map((n) => [n.id, n.kind]));
  const warnings = c.nodes
    .filter((n) => n.kind === 'bug' && !c.edges.some((e) => e.from === n.id && kinds.get(e.to) === 'fix'))
    .map((n) => `Bug "${n.id}" has no fix under it: draw the fix (an edge labelled "with the fix" to a fix node), or call it a risk until there's one.`);
  return { errors, warnings };
}

const CLASSES = `  classDef default fill:#f1f3f5,stroke:#868e96,color:#212529
  classDef bug fill:#fde8e8,stroke:#c92a2a,stroke-width:2px,color:#8b1a1a
  classDef fix fill:#e6f4ea,stroke:#2b8a3e,stroke-width:2px,color:#1e5e2c
  classDef risk fill:#fff4e0,stroke:#e8590c,stroke-width:2px,color:#7a3b00
  classDef start fill:#222,stroke:#222`;

/** The chart's flow as mermaid source (a checked chart): a start dot, then the tree from its root, top-down. */
export function flowchart(c: Pick<Statechart, 'nodes' | 'edges'>): string {
  const root = roots(c).at(0);
  if (!root) return 'flowchart TD';
  // ids of mermaid's own (n0, n1…) so a lead's (`end`, `graph`, ones with spaces) can't clash with its grammar
  const order = walk(c, root.id);
  const ref = new Map(order.map((id, i) => [id, `n${i}`]));
  const byId = new Map(c.nodes.map((n) => [n.id, n]));
  const shape = (n: ChartNode) => (n.kind === 'branch' ? '{" "}' : `["${mermaidText(n.text ?? '', NODE_WRAP)}"]${n.kind === 'works' ? '' : `:::${n.kind}`}`);
  const lines = order.map((id) => {
    const n = byId.get(id);
    return n ? `  ${ref.get(id)}${shape(n)}` : '';
  });
  const edges = order.flatMap((id) => c.edges.filter((e) => e.from === id)).map((e) => {
    const label = flat(e.label ?? '');
    return `  ${ref.get(e.from)} -->${label ? `|"${mermaidText(label, LABEL_WRAP)}"|` : ''} ${ref.get(e.to)}`;
  });
  return ['flowchart TD', '  s0((" ")):::start', ...lines, `  s0 --> ${ref.get(root.id)}`, ...edges, CLASSES].join('\n');
}
