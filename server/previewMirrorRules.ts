// Which preview mirrors to open and which to close. Pure, so it's unit tested (previewMirrorRules.test.ts);
// previewMirrors.ts opens and closes them.

/** Which mirrors to open and which to close, to go from the ones there are to the ones wanted. */
export function mirrorPlan(open: Iterable<number>, wanted: Iterable<number>): { open: number[]; close: number[] } {
  const have = new Set(open);
  const want = new Set(wanted);
  return { open: [...want].filter((p) => !have.has(p)), close: [...have].filter((p) => !want.has(p)) };
}
