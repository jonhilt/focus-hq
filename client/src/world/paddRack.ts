// The PADD rack by the hall's entrance: each open pull request waits there as a little pile of PADDs, the way the
// crew in TNG hand each other a PADD rather than share a file. Nothing here draws (room.ts builds the rack), so it can
// be tested without a browser.

/** How many piles fit along the rack. */
export const RACK_PILES = 8;

/**
 * The piles on the rack, left to right, each a list of its PADDs' pull requests: one pile per pull request, of one to
 * three PADDs (by its number, so the rack looks lived in and doesn't shuffle), and any pull requests beyond the
 * rack's piles stacked onto them in turn, so the rack fills up as reviews wait.
 */
export function paddPiles<T>(prs: readonly T[], number: (pr: T) => number, piles = RACK_PILES): T[][] {
  const out: T[][] = [];
  prs.forEach((pr, i) => {
    const padds = Array.from({ length: 1 + (Math.abs(number(pr)) % 3) }, () => pr);
    if (i < piles) out.push(padds);
    else out[i % piles].push(...padds);
  });
  return out;
}
