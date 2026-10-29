// Who sits round the goal viewing station. Pure: no Three.js, so it's testable outside the browser.

/**
 * Who sits where at the goal viewing station: each helper keeps the seat it took, a newcomer takes the first free one (in the
 * order they started), and anyone gone leaves theirs empty. Helpers beyond the seats wait their turn for one.
 */
export function seatHelpers(seated: (string | undefined)[], helpers: string[]): (string | undefined)[] {
  const next = seated.map((id) => (id && helpers.includes(id) ? id : undefined));
  for (const id of helpers) {
    if (next.includes(id)) continue;
    const free = next.indexOf(undefined);
    if (free < 0) break;
    next[free] = id;
  }
  return next;
}
