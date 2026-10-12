// The studio: an empty holodeck where the captain and the holodeck's computer, a Claude session of its own (not a goal),
// think a video through and try out ways to show it (docs/studio.md). What they build up is the video (its premise,
// narrative beats with their lines, and the loose threads still to pull), and the takes: rough 3D visualisations the
// computer stages in the room, cheap to change.

import type { Effort } from './agents';

/** The video as it stands: its premise first, then the rest as it comes. */
export interface StudioVideo {
  /** The basic idea, in a sentence or two. */
  premise: string;
  /** What the viewer should come away with. */
  takeaway?: string;
  /** The narrative, in order. */
  beats: StudioBeat[];
  /** Loose threads (something we're not sure how it works, a fact to check), open and closed, oldest first. */
  threads: StudioThread[];
}

export interface StudioBeat {
  title: string;
  /** What it gets across, in a line. */
  point?: string;
  /** What's said over it so far: the script, built up as we go. */
  lines?: string;
}

/** A loose thread: open until it's answered (research, or the captain) or dropped. */
export interface StudioThread {
  /** t1, t2, …: unique within the video. */
  id: string;
  text: string;
  at: number;
  closed?: { as: 'answered' | 'dropped'; answer?: string; at: number };
}

/**
 * A take: one rough way of showing something, a script the computer wrote against the studio's 3D kit
 * (client/src/world/takeKit.ts) that plays on the holodeck's floor, looping. Staged again under the same id, it's
 * swapped in place (`version` counts up).
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
  /** Which beat it's for (its index), if any. */
  beat?: number;
  /** How long it plays before it loops (s). */
  seconds: number;
  /** Builds the cast with `kit` once, and defines render(t). */
  script: string;
  version: number;
  at: number;
  /** What went wrong the last time the room ran this version, if anything. */
  error?: string;
}

/**
 * One way the computer pitches to show a beat, before it builds anything: the captain picks, mixes or pushes back, and
 * only then does it stage takes.
 */
export interface StudioPitch {
  /** A few words naming it. */
  title: string;
  /** What the concept is shown as, in a sentence: what moves, and what that movement means. */
  metaphor: string;
  /** How big it is and where it stands: a tabletop model, the room round you, something hall-sized overhead… */
  scale: string;
  /** How it holds up against what's true (the numbers, the limits), and where it bends. */
  check?: string;
}

/** The pitches for one beat (or the whole video, without one), numbered 1, 2, 3… in order: the latest for that beat. */
export interface StudioPitches {
  beat?: number;
  pitches: StudioPitch[];
  at: number;
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
  /** Missing until the computer has the premise. */
  video?: StudioVideo;
  /** On the holodeck's floor, oldest first. */
  takes: StudioTake[];
  /** The ways the computer's pitched to show each beat, the latest per beat; missing before it's pitched any. */
  pitches?: StudioPitches[];
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
