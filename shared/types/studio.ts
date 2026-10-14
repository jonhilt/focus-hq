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
  /** Builds the cast with `kit` once, and defines render(t). */
  script: string;
  version: number;
  at: number;
  /** What went wrong the last time the room ran this version, if anything. */
  error?: string;
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
