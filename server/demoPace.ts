// The demo ship's live pace (shared/demoPace.ts): every pretend agent that waits divides its waits by it, from its
// next wait on, so the captain's change reaches them all at once. It starts at FOCUS_DEMO_SPEED.

let set: number | undefined;

/** How fast the demo's pretend agents go now: the captain's pace once they've set one, else FOCUS_DEMO_SPEED (1). */
export function demoPace(): number {
  return set ?? (Number(process.env.FOCUS_DEMO_SPEED ?? 1) || 1);
}

/** The captain's pace (already kept to the ladder by the caller), for every pretend agent from its next wait on. */
export function setDemoPace(pace: number): number {
  set = pace;
  return pace;
}
