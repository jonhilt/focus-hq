// System models: how real code works, recovered from the code itself (its parts, how they connect, and one scenario
// along them), each part and connection cited at a file and line the office checks. A goal lead's `model` tool sends one.

/** The kinds of part a system model is drawn with, each in a shape of its own (shared/modelDrawing.ts). */
export const MODEL_KINDS = ['ui', 'route', 'handler', 'service', 'store', 'queue', 'external', 'job', 'type'] as const;
export type ModelKind = (typeof MODEL_KINDS)[number];
/** How one part reaches another. */
export const MODEL_EDGE_KINDS = ['calls', 'reads', 'writes', 'emits', 'renders'] as const;
export type ModelEdgeKind = (typeof MODEL_EDGE_KINDS)[number];
/** What a change (a slice, a pull request) does to a part or connection: new, changed, or gone. */
export const MODEL_CHANGES = ['added', 'changed', 'removed'] as const;
export type ModelChange = (typeof MODEL_CHANGES)[number];

/** Where in the code something is: an absolute path, as the agent read it, and a line (from 1). */
export interface ModelCite {
  file: string;
  line: number;
}

/** A part of the system: a page, a route, a handler, a service, a store… */
export interface ModelNode {
  id: string;
  label: string;
  kind: ModelKind;
  /** Which layer or owner it belongs to (UI, API, domain, data…): its colour. */
  layer: string;
  /** Its name in the code (a class, function or table), which a connection to it should mention. */
  symbol?: string;
  /** Where it's defined. */
  cite?: ModelCite;
  /** Whether the office found its cite in the code (set by the check). */
  found?: boolean;
  /** What the change being shown does to it, if it's a model of a change. */
  change?: ModelChange;
}

/** One part reaching another, cited where it does. */
export interface ModelEdge {
  from: string;
  to: string;
  kind: ModelEdgeKind;
  label?: string;
  /** Where in the code `from` reaches `to`: the line should mention `to`'s symbol. */
  cite?: ModelCite;
  /** Whether the office found `to`'s symbol at (or within two lines of) the cite (set by the check). */
  backed?: boolean;
  /** What the change being shown does to it, if it's a model of a change. */
  change?: ModelChange;
}

/** One step of the scenario: data moving along an edge, in order. */
export interface ModelStep {
  from: string;
  to: string;
  label: string;
  /** What moves, in a few words (the payload's shape: "ProposalDto { title, body }"). */
  payload?: string;
}

/** A question the captain should be able to answer from the model, with its answer and where the code confirms it. */
export interface ModelCheck {
  q: string;
  a: string;
  cite?: ModelCite;
}

/**
 * A system model recovered from code (the leads' `model` tool, docs/goals.md): the parts and how they connect, each cited, and one scenario as
 * steps along the connections. The office draws it one fixed way, so every model reads the same.
 */
export interface SystemModel {
  /** The question it answers, in a sentence. */
  question: string;
  nodes: ModelNode[];
  edges: ModelEdge[];
  trace: ModelStep[];
  /** What was left out or simplified. */
  simplified: string[];
  checks?: ModelCheck[];
}
