import type { DecisionEvent, InboxItem } from './inbox';

// Comms' list, from the captain's inbox as Focus keeps it (inbox.ts): what the chief of staff flags
// for the captain, a line each, and what they decided lately. Pure, so it's unit tested (commsList.test.ts).

/** What an item asks of the captain, in a word, for its tag on the list. */
export function tagOf(item: Pick<InboxItem, 'kind' | 'cos' | 'lane'>): string {
  if (item.kind === 'turn') {
    if (item.lane === 'ready') return 'Ready';
    return item.cos?.route === 3 ? 'Interrupt' : item.cos?.route === 2 ? 'Card' : 'Reply';
  }
  return ({ hand: 'Approve', error: 'Stuck', question: 'Pick', 'wrap-up': 'Close', qa: 'QA', conflicts: 'Conflicts' } as const)[item.kind];
}

/** How a hail's line opens (`needLine`), which its tag on the list already says. */
const SAID_BY_TAG = /^(Approve|Stuck|Pick|Ready to close|QA needs you): (?=\S)/;

/** What's needed, as a row under its tag says it: without the opening the tag already says ("Pick: Which layout?" → "Which layout?"). */
export const rowWhat = (what: string): string => what.replace(SAID_BY_TAG, '');

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

/** Where a step through the list lands from `at`, round from the end to the start and back; `at` itself for no step. */
export const stepped = (at: number, step: number, length: number): number => (step && length ? (((at + step) % length) + length) % length : at);

/** The line under the list while the chief of staff reads turns, or nothing when it reads none. */
export const readingLine = (n: number): string => (n ? `The chief of staff is reading ${n === 1 ? '1 turn' : `${n} turns`}…` : '');

/** Its tray's line: how many turns it has words ready for, and how many it sent by itself today; nothing for neither. */
export function trayLine(ready: number, sentToday: number, open: boolean): string {
  const said = [ready ? `${ready} ready to send` : '', sentToday ? `sent ${sentToday} by itself today` : ''].filter(Boolean).join(' · ');
  return said ? `Chief of staff: ${said} ${open ? '‹' : '›'}` : '';
}

/** What the captain decided lately themselves (not the chief of staff by itself), in the project picked if one is, the latest `max`. */
export const decidedByCaptain = (decided: readonly DecisionEvent[], project: string | null, max: number): DecisionEvent[] =>
  decided.filter((d) => d.via !== 'chief-of-staff' && (!project || d.projectId === project)).slice(0, max);

/** When its words go by themselves, on a row: to the minute, as the row is redrawn every few seconds; nothing when they wait. */
export function sendsIn(sendsAt: number | undefined, now: number): string {
  if (sendsAt === undefined) return '';
  const min = Math.ceil((sendsAt - now) / 60_000);
  return min > 1 ? `⏱ sends itself in ${min} min` : '⏱ sends itself within a minute';
}

/** One goal's items on the list, under its title and who's on it. */
export interface GoalGroup<T> {
  key: string;
  goal: string;
  who: string;
  items: T[];
}

/**
 * The list grouped by goal, so a goal with two things waiting reads as one place: each goal where its most urgent item
 * is, and its items under it in their order. A pull request without a lead is a goal of its own.
 */
export function byGoal<T extends Pick<InboxItem, 'agentId' | 'projectId' | 'goal' | 'who'>>(items: readonly T[]): GoalGroup<T>[] {
  const groups = new Map<string, GoalGroup<T>>();
  for (const it of items) {
    const key = it.agentId ?? `${it.projectId}|${it.goal}`;
    const group = groups.get(key) ?? { key, goal: it.goal, who: it.who, items: [] };
    group.items.push(it);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** The agent a decision was about, from its item's key (`hailKey`); none for a pull request's. */
export const agentOfDecision = (d: Pick<DecisionEvent, 'item'>): string | undefined =>
  /^(hand|question|error|wrap-up|turn):/.test(d.item.id) ? d.item.id.split(':')[1] : undefined;
