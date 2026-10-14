// The studio: an empty holodeck where the captain describes something to see and the holodeck's computer, a Claude
// session of its own (not a goal), builds it as a moving 3D scene in the middle of the hall, to walk round, spin, pause
// and scrub (docs/studio.md). Under the hood a scene is a take: a script against the studio's kit, cheap to change.

import type { Effort } from './agents';

/**
 * A scene (a take, as the code calls it): a script the computer wrote against the studio's 3D kit
 * (client/src/world/takeKit.ts) that plays in the middle of the holodeck, looping. Staged again under the same id, it's
 * swapped in place (`version` counts up). The one staged last is the one standing in the hall.
 */
export interface StudioTake {
  /** a, b, c… as the computer names it: short, so the captain can say "make b slower". */
  id: string;
  label: string;
  /** What it's trying, and what it trades off, in a line. */
  detail?: string;
  /**
   * The idea it shows the concept as, in a sentence: what moves, and what that movement means ("subagents are runners
   * sent to stations, each bringing back one sealed box"). Missing on takes staged before there were metaphors.
   */
  metaphor?: string;
  /** Its named phases, each a stretch of its seconds that its script times things by, so it can be retimed without rewriting. */
  phases?: Record<string, [number, number]>;
  /** How long it plays before it loops (s). */
  seconds: number;
  /** Builds the cast with `kit` once, and defines render(t); empty for a model scene. */
  script: string;
  /** A system model, drawn by the holodeck's own renderer rather than a script. */
  model?: SystemModel;
  version: number;
  at: number;
  /** What went wrong the last time the room ran this version, if anything. */
  error?: string;
}

/** The kinds of part a system model is drawn with, each in a shape of its own (client/src/world/modelScene.ts). */
export const MODEL_KINDS = ['ui', 'route', 'handler', 'service', 'store', 'queue', 'external', 'job', 'type'] as const;
export type ModelKind = (typeof MODEL_KINDS)[number];
/** How one part reaches another. */
export const MODEL_EDGE_KINDS = ['calls', 'reads', 'writes', 'emits', 'renders'] as const;
export type ModelEdgeKind = (typeof MODEL_EDGE_KINDS)[number];

/** Where in the code something is: an absolute path, as the computer read it, and a line (from 1). */
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
 * A system model recovered from code (docs/studio.md): the parts and how they connect, each cited, and one scenario as
 * steps along the connections. The holodeck draws it one fixed way, so every model reads the same.
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

export interface StudioMessage {
  from: 'captain' | 'computer';
  text: string;
  at: number;
}

export type StudioStatus = 'thinking' | 'waiting' | 'failed';

/** The studio's one conversation, and what it's built so far. */
export interface StudioSession {
  status: StudioStatus;
  /** What the computer's doing right now, while it thinks. */
  activity: string;
  messages: StudioMessage[];
  /** The scenes it's built, oldest first: the one staged (or changed) last stands in the hall. */
  takes: StudioTake[];
  updatedAt: number;
  costUsd: number;
  error?: string;
  /** The model the captain picked for the computer; missing = the office's `model` setting. Kept across videos. */
  model?: string;
  /** How hard it thinks; missing = the model's default. Kept across videos. */
  effort?: Effort;
  /** The model its last turn ran on, as Claude Code reported it. */
  ranOn?: string;
}
