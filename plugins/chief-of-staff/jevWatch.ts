import type { LedgerEvent } from '../../plugin-api/server';

// Watching Route with Jev live (README.md#how-it-judges-a-turn): how many turns each router read a day, and how many it
// interrupted the captain on, from the chief of staff's own verdicts. The script (`scripts/jevWatch.ts`) prints it.

/** A day's verdicts by who routed them: Jev, or Haiku (with the turns Haiku routed because Jev couldn't). */
export interface DayVolume {
  day: string;
  jev: { turns: number; interrupts: number };
  haiku: { turns: number; interrupts: number; jevFailed: number };
}

/** The verdicts since `since` (ms) in the projects `wanted` keeps, a row a day in date order. */
export function verdictVolume(events: readonly LedgerEvent[], since: number, wanted: (projectId: string) => boolean = () => true): DayVolume[] {
  const days = new Map<string, DayVolume>();
  for (const e of events) {
    if (e.kind !== 'cos-verdict' || e.at < since || !wanted(e.projectId)) continue;
    const day = new Date(e.at).toISOString().slice(0, 10);
    const row = days.get(day) ?? { day, jev: { turns: 0, interrupts: 0 }, haiku: { turns: 0, interrupts: 0, jevFailed: 0 } };
    days.set(day, row);
    const by = e.router?.by === 'jev' ? row.jev : row.haiku;
    by.turns++;
    if (e.route === 3) by.interrupts++;
    if (e.routerFailed) row.haiku.jevFailed++;
  }
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
}
