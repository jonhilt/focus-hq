// A shot plan for the studio's holodeck stage (studio/director.md, docs/studio.md): the narration's beats, the cast, and
// the shots, each with its camera, what happens in it and how it hands over to the next. `compilePlan` turns a plan
// into a timeline on the narration's clock: every anchor resolved to seconds, every act to one target at one time.
// Pure, so the recorder and the browser's stage share it and it's testable.

export type V3 = [number, number, number];

export interface Beat {
  id: string;
  at: number;
  end?: number;
  text: string;
  /** The start of each stressed word, by name. */
  marks?: Record<string, number>;
}

/** Where the camera is, as a framing the stage solves (`size`, `on`, `angle`) or as a pose (`pos`, `look`). */
export interface Framing {
  size?: string;
  /** Where each named subject sits on screen, 0–1 from the top left. */
  on?: Record<string, [number, number]>;
  /** Yaw off straight-on (+ from screen-right) and pitch (− looks down), degrees. */
  angle?: [number, number];
  /** Vertical field of view, degrees. */
  fov?: number;
  pos?: V3;
  look?: V3;
}

export type Ease = 'inOut' | 'out' | 'in' | 'linear' | 'log';

export interface Move {
  kind: string;
  /** For push-in, pull-out, truck and crane: a new size, or a new framing merged over the shot's. */
  to?: string | Framing;
  /** For orbit: degrees round the subject. */
  by?: number;
  at?: string | number;
  over?: number;
  ease?: Ease;
  why?: string;
}

export interface Transition {
  kind: 'cut' | 'move' | 'dissolve' | 'grid-wipe';
  over?: number;
  title?: string;
  /** Props the grid wipe puts back as they started. */
  resets?: string[];
}

export interface PlanShot {
  id: string;
  span: [string | number, string | number];
  idea?: string;
  look?: string | string[];
  camera: Framing & { move?: Move; keys?: (Framing & { at: string | number; hold?: number })[] };
  do?: Record<string, unknown>[];
  out?: Transition;
}

export interface Plan {
  plan: number;
  episode: string;
  narration?: { audio?: string; beats?: string };
  /** Shown while there's no narration yet: the beats' text as subtitles. */
  preview?: { captions?: boolean };
  beats: Beat[];
  cast: Record<string, Record<string, unknown>>;
  shots: PlanShot[];
  notes?: string[];
}

/** One act, at one time, on one target (or none), with the rest of its parameters. */
export interface Act {
  at: number;
  act: string;
  /** The cast member (or part, like `lead.gauge`) it acts on. */
  target?: string;
  /** Which of the act's targets this is, for parameters given as a list (a line, a text). */
  index: number;
  shot: string;
  params: Record<string, unknown>;
}

/** A point on a shot's camera track: the framing it's at by `at`, eased from the one before. */
export interface CameraKey {
  at: number;
  framing: Framing;
  ease: Ease;
}

export interface CompiledShot {
  id: string;
  start: number;
  end: number;
  keys: CameraKey[];
  out: Transition;
  idea?: string;
}

export interface Timeline {
  episode: string;
  duration: number;
  beats: Beat[];
  cast: Plan['cast'];
  shots: CompiledShot[];
  acts: Act[];
  captions: boolean;
}

/** A shot plan from its parsed YAML, or an error saying what's wrong with it. */
export function readPlan(raw: unknown): Plan {
  if (!raw || typeof raw !== 'object') throw new Error('A shot plan is a YAML mapping, with beats, cast and shots');
  const p = raw as Partial<Plan>;
  if (!Array.isArray(p.beats) || !p.beats.length) throw new Error('The plan needs its narration beats');
  if (!Array.isArray(p.shots) || !p.shots.length) throw new Error('The plan needs some shots');
  if (!p.cast || typeof p.cast !== 'object') throw new Error('The plan needs a cast');
  for (const [i, b] of p.beats.entries()) {
    if (typeof b?.id !== 'string' || typeof b.at !== 'number') throw new Error(`Beat ${i + 1} needs an id and an at`);
  }
  for (const [i, s] of p.shots.entries()) {
    if (typeof s?.id !== 'string' || !Array.isArray(s.span) || s.span.length !== 2) throw new Error(`Shot ${i + 1} needs an id and a span: [start, end]`);
    if (!s.camera || typeof s.camera !== 'object') throw new Error(`Shot ${s.id} needs a camera`);
  }
  return { plan: p.plan ?? 1, episode: p.episode ?? 'episode', ...p } as Plan;
}

const ANCHOR = /^([A-Za-z_][\w]*)(?:\.([A-Za-z_][\w]*))?\s*([+-]\s*\d+(?:\.\d+)?)?$/;

/**
 * Seconds on the narration's clock for an anchor: a number, a beat (`r2`), a mark in it (`r2.fresh`), a beat's end
 * (`r2.end`), any of them with an offset (`r2.fresh-0.2`, `r1+2.8`).
 */
export function resolveAnchor(anchor: string | number, beats: Beat[]): number {
  if (typeof anchor === 'number') return anchor;
  const m = ANCHOR.exec(anchor.trim());
  if (!m) throw new Error(`"${anchor}" isn't an anchor: a beat, beat.mark or beat.end, with an optional +/- seconds`);
  const i = beats.findIndex((b) => b.id === m[1]);
  if (i < 0) throw new Error(`"${anchor}": there's no beat called ${m[1]}`);
  const beat = beats[i];
  let t = beat.at;
  if (m[2] === 'end') t = beatEnd(beats, i);
  else if (m[2]) {
    const mark = beat.marks?.[m[2]];
    if (mark === undefined) throw new Error(`"${anchor}": beat ${beat.id} has no mark called ${m[2]}`);
    t = mark;
  }
  return t + (m[3] ? Number(m[3].replace(/\s/g, '')) : 0);
}

/** When a beat ends: its own end, the next beat's start, or a reading-speed guess for the last. */
function beatEnd(beats: Beat[], i: number): number {
  const beat = beats[i];
  return beat.end ?? beats[i + 1]?.at ?? beat.at + Math.max(2, beat.text.split(/\s+/).length * 0.4);
}

const SIZES = ['ECU', 'CU', 'MCU', 'MS', 'MLS', 'FS', 'LS', 'ELS'];

/** The framing a move ends on: the shot's, with the move's change made. */
export function moveTarget(from: Framing, move: Move): Framing {
  const base: Framing = { size: from.size, on: from.on, angle: from.angle, fov: from.fov, pos: from.pos, look: from.look };
  if (move.kind === 'orbit') {
    const [yaw, pitch] = from.angle ?? [0, 0];
    return { ...base, angle: [yaw + (move.by ?? 0), pitch] };
  }
  if (move.kind === 'zoom' && typeof move.to === 'number') return { ...base, fov: move.to };
  if (typeof move.to === 'string') {
    if (!SIZES.includes(move.to)) throw new Error(`A ${move.kind} to "${move.to}": sizes are ${SIZES.join(' ')}`);
    return { ...base, size: move.to };
  }
  if (move.to && typeof move.to === 'object') return { ...base, ...move.to };
  return base;
}

/** A shot's camera track: where it starts, and each change along the way. */
function cameraKeys(shot: PlanShot, start: number, end: number, beats: Beat[]): CameraKey[] {
  const { move, keys, ...framing } = shot.camera;
  if (keys?.length) {
    const track: CameraKey[] = [];
    for (const k of keys) {
      const { at, hold = 0, ...f } = k;
      const t = Math.max(start, resolveAnchor(at, beats));
      track.push({ at: t, framing: { ...framing, ...f }, ease: 'inOut' });
      if (hold) track.push({ at: Math.min(end, t + hold), framing: { ...framing, ...f }, ease: 'linear' });
    }
    // the first key holds from the shot's start
    return [{ at: start, framing: track[0].framing, ease: 'linear' }, ...track];
  }
  const track: CameraKey[] = [{ at: start, framing, ease: 'linear' }];
  if (move && move.kind !== 'hold' && move.kind !== 'follow') {
    const at = move.at === undefined ? start : Math.max(start, resolveAnchor(move.at, beats));
    track.push({ at, framing, ease: 'linear' }, { at: Math.min(end, at + (move.over ?? 2)), framing: moveTarget(framing, move), ease: move.ease ?? 'inOut' });
  }
  return track;
}

const list = <T>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x]);

/** A shot's acts, each on one target at one time: lists of targets spread `gap` seconds apart, `after` chained on. */
function shotActs(shot: PlanShot, start: number, beats: Beat[]): Act[] {
  const acts: Act[] = [];
  let previous = start;
  for (const raw of shot.do ?? []) {
    // `gap` stays in the params too: the stage spreads a group (like `lanes.console`) by it as well
    const { at, after, act, who, what, ...params } = raw as { at?: unknown; after?: number; act?: string; who?: unknown; what?: unknown; gap?: number };
    const gap = typeof params.gap === 'number' ? params.gap : 0;
    if (typeof act !== 'string') throw new Error(`Shot ${shot.id}: an act needs an act: name`);
    const times = list(at as string | number | (string | number)[]).map((a) => resolveAnchor(a, beats));
    const first = times[0] ?? (after !== undefined ? previous + after : start);
    previous = first;
    const targets = list((who ?? what) as string | string[]);
    if (!targets.length) acts.push({ at: first, act, index: 0, shot: shot.id, params });
    targets.forEach((target, index) => acts.push({ at: times.length > 1 ? (times[index] ?? first) : first + index * gap, act, target, index, shot: shot.id, params }));
  }
  return acts;
}

/** The plan as a timeline on the narration's clock. */
export function compilePlan(plan: Plan): Timeline {
  const beats = [...plan.beats].sort((a, b) => a.at - b.at);
  const shots: CompiledShot[] = plan.shots.map((s) => {
    const start = resolveAnchor(s.span[0], beats);
    const end = resolveAnchor(s.span[1], beats);
    if (!(end > start)) throw new Error(`Shot ${s.id} ends (${end.toFixed(2)} s) before it starts (${start.toFixed(2)} s)`);
    return { id: s.id, start, end, keys: cameraKeys(s, start, end, beats), out: s.out ?? { kind: 'cut' }, idea: s.idea };
  });
  for (let i = 1; i < shots.length; i++) {
    const gap = shots[i].start - shots[i - 1].end;
    if (Math.abs(gap) > 0.05) throw new Error(`Shots ${shots[i - 1].id} and ${shots[i].id} ${gap > 0 ? `leave ${gap.toFixed(2)} s uncovered` : `overlap by ${(-gap).toFixed(2)} s`}: shots play back to back`);
  }
  const acts = plan.shots.flatMap((s, i) => shotActs(s, shots[i].start, beats)).sort((a, b) => a.at - b.at);
  return { episode: plan.episode, duration: shots.at(-1)?.end ?? 0, beats, cast: plan.cast, shots, acts, captions: !!plan.preview?.captions };
}

export const EASES: Record<Ease, (k: number) => number> = {
  linear: (k) => k,
  inOut: (k) => k * k * (3 - 2 * k),
  in: (k) => k * k * k,
  out: (k) => 1 - (1 - k) ** 3,
  // a change of scale at a steady perceived speed: fast while far, slow as it lands
  log: (k) => (Math.exp(3 * k) - 1) / (Math.exp(3) - 1),
};

/** Where a shot's camera track is at `t`: the two keys either side, and how far between them (eased). */
export function trackAt(keys: CameraKey[], t: number): { from: Framing; to: Framing; k: number } {
  let i = 0;
  while (i < keys.length - 1 && t >= keys[i + 1].at) i++;
  const a = keys[i];
  const b = keys[Math.min(i + 1, keys.length - 1)];
  if (a === b || b.at <= a.at) return { from: a.framing, to: a.framing, k: 1 };
  const k = Math.min(1, Math.max(0, (t - a.at) / (b.at - a.at)));
  return { from: a.framing, to: b.framing, k: EASES[b.ease](k) };
}
