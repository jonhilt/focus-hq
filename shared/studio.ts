// The TV studio (docs/studio.md): a scene script (scenes/*.yaml) the recorder plays against a demo office, its cues and
// its beat sheet. Pure, so it's testable and shared by the recorder (scripts/studio.ts) and the browser's director.

import { readScenario, type Scenario } from './scenarios';
import { ACTIVE_STATUSES, type Agent, type Helper } from './types';

/** Where the camera looks, by name: the director (client/src/ui/studio.ts) works out where that is. */
export const SHOTS = ['bridge', 'holodeck', 'station', 'lead', 'helpers', 'crew'] as const;
export type Shot = (typeof SHOTS)[number];

/** What a beat waits for, read off the goal's lead (`cueMet`). */
export const CUES = ['lead-working', 'lead-idle', 'helpers-working', 'helpers-done', 'shipped'] as const;
export type Cue = (typeof CUES)[number];

/** What a beat does as it starts, as the captain would: start the goal, pick the lead's first option, or reply. */
export const ACTIONS = ['start-goal', 'answer', 'reply'] as const;
export type Action = (typeof ACTIONS)[number];

export interface SceneBeat {
  title: string;
  /** On screen while the beat plays, and the line in the beat sheet. */
  caption: string;
  shot?: Shot;
  /** Seconds to glide into the shot; missing cuts to it. */
  glide?: number;
  do?: Action;
  /** What the captain says, for `reply`. */
  say?: string;
  until?: Cue;
  /** How long the beat holds once its cue is met (or from its start, without one). */
  hold: number;
  /** Plays the scene's explainer here, as a cut-away from the ship. */
  insert?: 'explainer';
}

/** The explainer insert: the same input as a lead's explain tool (server/agents/explainer.ts). */
export interface SceneExplainer {
  title: string;
  beats: { title: string; text: string; seconds: number; label?: string; narration?: string }[];
  stage: { html: string; css?: string; script: string };
}

export interface Scene {
  title: string;
  /** The demo's pacing: below 1 is slower than `pnpm run demo`. */
  speed: number;
  /** Seeds the demo's dice, so its waits and picks come out the same each run. */
  seed: number;
  project: string;
  goal: string;
  /** Which parts of the demo lead's story the goal plays (shared/scenarios.ts): `full` without one. */
  scenario: Scenario;
  beats: SceneBeat[];
  explainer?: SceneExplainer;
}

/** How long a beat waits for its cue before the recording gives up. */
export const CUE_TIMEOUT_S = 180;

const oneOf = <T extends string>(list: readonly T[], value: unknown, what: string): T | undefined => {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && (list as readonly string[]).includes(value)) return value as T;
  throw new Error(`${what} is ${JSON.stringify(value)}: it's one of ${list.join(', ')}`);
};
const text = (value: unknown, what: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${what} needs some text`);
  return value.trim();
};
const seconds = (value: unknown, what: string, fallback: number): number => {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !(value >= 0)) throw new Error(`${what} is ${JSON.stringify(value)}: give it in seconds`);
  return value;
};

/** A scene from its parsed YAML, or an error saying what's wrong with it. */
export function readScene(raw: unknown): Scene {
  if (!raw || typeof raw !== 'object') throw new Error('A scene is a YAML mapping, with a title, a goal and beats');
  const s = raw as Record<string, unknown>;
  if (!Array.isArray(s.beats) || s.beats.length === 0) throw new Error('The scene needs some beats');
  const beats = s.beats.map((b: unknown, i): SceneBeat => {
    const r = (b ?? {}) as Record<string, unknown>;
    const which = `Beat ${i + 1}`;
    const beat: SceneBeat = {
      title: text(r.title, `${which}'s title`),
      caption: text(r.caption, `${which}'s caption`),
      shot: oneOf(SHOTS, r.shot, `${which}'s shot`),
      glide: r.glide === undefined ? undefined : seconds(r.glide, `${which}'s glide`, 0),
      do: oneOf(ACTIONS, r.do, `${which}'s do`),
      say: typeof r.say === 'string' ? r.say : undefined,
      until: oneOf(CUES, r.until, `${which}'s until`),
      hold: seconds(r.hold, `${which}'s hold`, 4),
      insert: oneOf(['explainer'] as const, r.insert, `${which}'s insert`),
    };
    if (beat.do === 'reply' && !beat.say) throw new Error(`${which} replies, so it needs what to say`);
    if (beat.insert && !s.explainer) throw new Error(`${which} inserts the explainer, but the scene has none`);
    return beat;
  });
  if (beats.findIndex((b) => b.do === 'start-goal') !== beats.findIndex((b) => b.do || b.until)) throw new Error('The goal has to start before any other beat acts or waits on the lead');
  return {
    title: text(s.title, 'The scene title'),
    speed: seconds(s.speed, 'speed', 1) || 1,
    seed: typeof s.seed === 'number' ? s.seed : 1,
    project: typeof s.project === 'string' ? s.project : 'Sock Shop',
    goal: text(s.goal, 'The goal'),
    scenario: readScenario(s.scenario),
    beats,
    explainer: s.explainer as SceneExplainer | undefined,
  };
}

/** Whether a beat's cue has come, from the goal's lead as the office sees it. */
export function cueMet(cue: Cue, lead: Agent | undefined): boolean {
  if (!lead) return false;
  const active = ACTIVE_STATUSES.includes(lead.status);
  const helpers = lead.helpers ?? [];
  switch (cue) {
    case 'lead-working':
      return active;
    case 'lead-idle':
      return !active && lead.status !== 'queued';
    case 'helpers-working':
      return helpers.some((h) => h.status === 'working');
    case 'helpers-done':
      return helpers.length > 0 && helpers.every((h) => h.status !== 'working');
    case 'shipped':
      return (lead.lead?.prs.length ?? 0) > 0;
  }
}

/** Dice that roll the same each run from `seed` (mulberry32): the studio's demo office stands them in for Math.random. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A model id as people say it: claude-haiku-4-5-20251001 is Haiku 4.5. */
export function modelLabel(model: string | undefined): string | undefined {
  const m = model && /claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?/.exec(model);
  if (!m) return model || undefined;
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] && m[3].length < 3 ? `.${m[3]}` : ''}`;
}

/** The tag over a helper's head while the studio films: what it is, what it runs on, how hard it thinks. */
export function helperTag(helper: Pick<Helper, 'type' | 'model' | 'effort'>): string {
  return [`${helper.type ?? 'general-purpose'} subagent`, modelLabel(helper.model), helper.effort && `${helper.effort} effort`].filter(Boolean).join(' · ');
}

/** When a beat started in the cut, and how long it ran (seconds). */
export interface Timing {
  start: number;
  length: number;
}

/** mm:ss, as YouTube's chapters and a narrator's script want it. */
export function stamp(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The beat sheet: each beat's time in the cut and its caption, to record the voiceover against. */
export function beatSheet(scene: Scene, timings: Timing[]): string {
  const total = timings.reduce((end, t) => Math.max(end, t.start + t.length), 0);
  const rows = scene.beats.map((b, i) => {
    const t = timings[i];
    return `| ${t ? stamp(t.start) : '–'} | ${t ? `${Math.round(t.length)}s` : '–'} | ${b.insert ? `${b.title} (explainer)` : b.title} | ${b.caption.replace(/\|/g, '\\|')} |`;
  });
  return [`# ${scene.title}: beat sheet`, '', `Rough cut: ${stamp(total)}. Record the voiceover against rough-cut.mp4, starting at 0:00.`, '', '| At | For | Beat | Caption |', '|---|---|---|---|', ...rows, ''].join('\n');
}
