// Adaptive resolution: the picture's pixel ratio drops a step when frames run slow and climbs back when there's
// headroom, so a weak GPU (an older laptop's integrated graphics) gets a softer picture rather than a slow one, and a
// strong one keeps every pixel. Everything costly is drawn per pixel (frame.ts), so pixels are what to cut.

/** The pixel ratios it steps between, coarsest first. */
export const RATIOS = [0.75, 1, 1.25, 1.5, 1.75, 2];
/** How long (ms) it watches frames before deciding anything. */
export const WINDOW = 1500;
/** A frame slower than this (ms, under ~55 fps) is slow, however fast the screen refreshes. */
const SLOW = 18;
/** How long (ms) a ratio that ran slow is left alone before it's tried again; it doubles each time it fails. */
const BACKOFF = 10_000;

export interface ResolutionState {
  ratio: number;
  /** When each ratio last ran slow, and how long to leave it after: it isn't tried again until then. */
  blocked: Record<number, { until: number; wait: number }>;
}

/** Starts at the finest ratio the screen has (`max`: its devicePixelRatio, capped at 2). */
export function initialResolution(max: number): ResolutionState {
  return { ratio: ratios(max).at(-1)!, blocked: {} };
}

function ratios(max: number): number[] {
  const steps = RATIOS.filter((r) => r <= max + 1e-6);
  return steps.length ? steps : [RATIOS[0]];
}

/**
 * What to do after a window of frames: `frames` are their intervals (ms), `busy` how long each kept the CPU busy
 * (ms: the frame's own work, its JavaScript and draw calls), `refresh` the screen's interval (ms). Slow frames (most
 * slower than SLOW and than a refresh and a half) that the CPU wasn't busy for are waiting on the GPU, which fewer
 * pixels helps: they step down a ratio and leave the one they left alone for a while, and as the one above that ran
 * slow too it wasn't to blame, so it's tried again whenever. Slow frames the CPU was busy for are left as they are:
 * fewer pixels wouldn't help. Keeping up with the screen steps up a ratio, unless that one ran slow lately.
 */
export function adapt(state: ResolutionState, frames: number[], busy: number[], refresh: number, max: number, now: number): ResolutionState {
  if (frames.length < 10) return state;
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1] ?? 0;
  const interval = median(frames);
  const steps = ratios(max);
  const i = Math.max(0, steps.findIndex((r) => Math.abs(r - state.ratio) < 1e-6));
  if (interval > SLOW && interval > refresh * 1.5) {
    if (i === 0 || median(busy) > interval * 0.6) return state;
    const wait = Math.min((state.blocked[state.ratio]?.wait ?? BACKOFF / 2) * 2, 8 * BACKOFF);
    const blocked = { ...state.blocked, [state.ratio]: { until: now + wait, wait } };
    const above = steps[i + 1];
    if (above !== undefined) delete blocked[above];
    return { ratio: steps[i - 1], blocked };
  }
  const up = steps[i + 1];
  if (up !== undefined && interval <= refresh * 1.15 && now >= (state.blocked[up]?.until ?? 0)) return { ...state, ratio: up };
  return state;
}
