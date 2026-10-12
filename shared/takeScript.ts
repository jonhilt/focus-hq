// How a take's script becomes something to run, the same in the office (to catch a syntax error before it reaches the
// room) and in the browser (client/src/world/takes.ts): its body runs once with the kit and helpers in scope, and hands
// back its render function.

/** The names a take's script sees, in the order they're passed. */
export const TAKE_PARAMS = ['kit', 'THREE', 'p', 'clamp', 'lerp'] as const;

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
