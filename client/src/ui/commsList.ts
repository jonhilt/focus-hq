import type { DecisionEvent, InboxItem } from '../../../shared/captainsInbox';

// Comms' list, from the captain's inbox as Focus keeps it (shared/captainsInbox.ts): what the chief of staff flags
// for the captain, a line each, and what they decided lately. Pure, so it's unit tested (commsList.test.ts).

/** What an item asks of the captain, in a word, for its tag on the list. */
export function tagOf(item: Pick<InboxItem, 'kind' | 'cos' | 'lane'>): string {
  if (item.kind === 'turn') {
    if (item.lane === 'ready') return 'Ready';
    return item.cos?.route === 3 ? 'Interrupt' : item.cos?.route === 2 ? 'Card' : 'Reply';
  }
  return ({ hand: 'Approve', error: 'Stuck', question: 'Pick', 'wrap-up': 'Close', qa: 'QA', conflicts: 'Conflicts' } as const)[item.kind];
}

/** How long it's waited, in a few characters: 40s, 4m, 2.6h, 8.5d. */
export function waited(since: number, now: number): string {
  const s = Math.max(0, (now - since) / 1000);
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 48 * 3600) return `${+(s / 3600).toFixed(1)}h`;
  return `${+(s / 86_400).toFixed(1)}d`;
}

/** How many items wait on the captain in each project, for the tabs along the top. */
export function perProject(items: readonly Pick<InboxItem, 'projectId'>[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const { projectId } of items) out.set(projectId, (out.get(projectId) ?? 0) + 1);
  return out;
}

/**
 * The inbox split as Comms shows it: what the chief of staff flags for the captain (the `needs-you` lane, in a project
 * when one's picked), the turns it has words ready for, kept out of the list in its tray, and how many it's still reading.
 */
export function lanes(open: readonly InboxItem[], project: string | null): { flagged: InboxItem[]; ready: InboxItem[]; reading: number } {
  const inView = open.filter((i) => !project || i.projectId === project);
  return {
    flagged: inView.filter((i) => i.lane === 'needs-you'),
    ready: inView.filter((i) => i.lane === 'ready'),
    reading: inView.filter((i) => i.lane === 'judging').length,
  };
}

/** Who decided it, as Recently decided says it: the captain (from Focus's own screens or a bot), or the chief of staff by itself. */
export const decidedBy = (d: Pick<DecisionEvent, 'via'>): string => (d.via === 'chief-of-staff' ? 'Chief of staff' : 'You');

/** How many of the chief of staff's words went by themselves since `since`, for its tray's line. */
export const sentByCos = (decided: readonly Pick<DecisionEvent, 'via' | 'at'>[], since: number): number =>
  decided.filter((d) => d.via === 'chief-of-staff' && d.at >= since).length;
