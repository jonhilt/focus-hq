// How a take's script becomes something to run, the same in the office (to catch a syntax error before it reaches the
// room) and in the browser (client/src/world/takes.ts): its body runs once with the kit and helpers in scope, and hands
// back its render function. The helpers are pure functions of time, as render(t) is, so a take can be jumped to any
// moment and played backwards: easing between two times, a glide that settles, a flash that dies away, many parts
// starting one after another, and the take's own named phases, which the computer can retime without touching the script.

/** The names a take's script sees, in the order they're passed. */
export const TAKE_PARAMS = ['kit', 'THREE', 'p', 'clamp', 'lerp', 'settle', 'burst', 'stagger', 'phase'] as const;

/** A take's named phases: each a stretch of its seconds, [from, to], that its script times things by. */
export type TakePhases = Record<string, [number, number]>;

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
export const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

/** Eases from 0 to 1 between `a` and `b` seconds (smoothstep), as the explainers' p() does. */
export function p(t: number, a: number, b: number): number {
  const k = clamp((t - a) / (b - a || 1), 0, 1);
  return k * k * (3 - 2 * k);
}

/** 0 until `a`, then glides to 1 and settles there without overshooting (critically damped): `speed` is how briskly. */
export function settle(t: number, a: number, speed = 8): number {
  const x = Math.max(0, t - a) * speed;
  return 1 - (1 + x) * Math.exp(-x);
}

/** A flash at `at`: up to 1 over `rise` seconds, then dying away over about `fall`. Add bursts together for repeats. */
export function burst(t: number, at: number, rise = 0.08, fall = 0.5): number {
  const age = t - at;
  if (age < 0) return 0;
  if (age < rise) return age / rise;
  return Math.exp(-(age - rise) / fall);
}

/** p() for the `i`th of many parts, each starting `gap` seconds after the one before it. */
export function stagger(t: number, i: number, a: number, b: number, gap = 0.15): number {
  return p(t, a + i * gap, b + i * gap);
}

/** phase(t, name): eased 0 → 1 through one of the take's named phases; phase.start(name) and phase.end(name) are its times. */
export interface Phase {
  (t: number, name: string): number;
  start(name: string): number;
  end(name: string): number;
}

/** The helpers a take's script is handed, by name, with `phase` reading the take's own phases. */
export function takeHelpers(phases: TakePhases = {}): { p: typeof p; clamp: typeof clamp; lerp: typeof lerp; settle: typeof settle; burst: typeof burst; stagger: typeof stagger; phase: Phase } {
  const span = (name: string): [number, number] => {
    const found = phases[name];
    if (!found) throw new Error(`The take has no phase “${name}”: its phases are ${Object.keys(phases).join(', ') || 'none'}`);
    return found;
  };
  const phase = ((t: number, name: string) => p(t, ...span(name))) as Phase;
  phase.start = (name) => span(name)[0];
  phase.end = (name) => span(name)[1];
  return { p, clamp, lerp, settle, burst, stagger, phase };
}

/** The function body a take's script runs as: the script, then its render(t) handed back. */
export function takeBody(script: string): string {
  return `"use strict";\n${script}\n;return typeof render === 'function' ? render : undefined;`;
}

/** Why a take's script won't even parse, or undefined if it does. */
export function takeSyntaxError(script: string): string | undefined {
  try {
    // only compiled, never run: running it needs the browser's kit
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function(...TAKE_PARAMS, takeBody(script));
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** The scene standing in the hall: the one staged or retimed last. */
export function currentTake<T extends { at: number }>(takes: readonly T[]): T | undefined {
  return takes.reduce<T | undefined>((last, t) => (!last || t.at >= last.at ? t : last), undefined);
}
