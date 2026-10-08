// Adaptive resolution: the picture drops a level when frames run slow and climbs back when there's headroom, so a weak
// GPU (an older laptop's integrated graphics) gets a plainer, softer picture rather than a slow one, and a strong one
// keeps it all. Everything costly is drawn per pixel (frame.ts), so what to cut is first the screen-space ambient
// occlusion (the decks keep the occlusion baked into them, blender/bake.py), then pixels.

/** The pixel ratios it steps between, coarsest first. */
export const RATIOS = [0.75, 1, 1.25, 1.5, 1.75, 2];
/** How long (ms) it watches frames before deciding anything. */
export const WINDOW = 1500;
/** How few frames it'll decide on: a very slow machine has only a handful in a window. */
export const FEWEST = 5;
/** A frame slower than this (ms, under ~55 fps) is slow, however fast the screen refreshes. */
const SLOW = 18;
/** Frames this quick (ms, 60 fps) keep up, however fast the screen refreshes. */
const SMOOTH = 1000 / 60;
/** How long (ms) a level that ran slow is left alone before it's tried again; it doubles each time it fails. */
const BACKOFF = 10_000;

/** One rung of the ladder: how fine the picture is, and whether the screen-space ambient occlusion is drawn. */
export interface Level {
  ratio: number;
  occlusion: boolean;
}

/**
 * The levels it steps between, plainest first: each pixel ratio up to the finest the screen has (`max`: its
 * devicePixelRatio, capped at 2) without the occlusion, then the finest with it, if it's drawn at all (`occlusion`).
 */
export function levels(max: number, occlusion: boolean): Level[] {
  const steps = RATIOS.filter((r) => r <= max + 1e-6);
  const ladder = (steps.length ? steps : [RATIOS[0]]).map((ratio) => ({ ratio, occlusion: false }));
  if (occlusion) ladder.push({ ratio: ladder.at(-1)!.ratio, occlusion: true });
  return ladder;
}

export interface ResolutionState {
  /** Which of the levels it's at. */
  level: number;
  /** When each level last ran slow, and how long to leave it after: it isn't tried again until then. */
  blocked: Record<number, { until: number; wait: number }>;
}

/** Starts at the top of the ladder. */
export function initialResolution(ladder: Level[]): ResolutionState {
  return { level: ladder.length - 1, blocked: {} };
}

/**
 * What to do after a window of frames: `frames` are their intervals (ms), `busy` how long each kept the CPU busy
 * (ms: the frame's own work, its JavaScript and draw calls), `refresh` the screen's interval (ms). Slow frames (most
 * slower than SLOW and than a refresh and a half) that the CPU wasn't busy for are waiting on the GPU, which less
 * per-pixel work helps: they step down a level and leave the one they left alone for a while, and as the one above
 * that ran slow too it wasn't to blame, so it's tried again whenever. Slow frames the CPU was busy for are left as
 * they are: less per-pixel work wouldn't help. Keeping up with the screen, or at 60 fps on a faster one, steps up a
 * level, unless that one ran slow lately.
 */
export function adapt(state: ResolutionState, frames: number[], busy: number[], refresh: number, ladder: Level[], now: number): ResolutionState {
  if (frames.length < FEWEST) return state;
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1] ?? 0;
  const interval = median(frames);
  const i = Math.min(state.level, ladder.length - 1);
  if (interval > SLOW && interval > refresh * 1.5) {
    if (i === 0 || median(busy) > interval * 0.6) return state;
    const wait = Math.min((state.blocked[i]?.wait ?? BACKOFF / 2) * 2, 8 * BACKOFF);
    const blocked = { ...state.blocked, [i]: { until: now + wait, wait } };
    delete blocked[i + 1];
    return { level: i - 1, blocked };
  }
  const up = i + 1;
  if (up < ladder.length && interval <= Math.max(refresh, SMOOTH) * 1.15 && now >= (state.blocked[up]?.until ?? 0)) return { ...state, level: up };
  return state;
}
