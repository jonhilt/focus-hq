import type { InboxItem } from './inbox';
import type { ThreadEntry } from './thread';

// What the bridge draws from the goals and their conversations (stream.ts, README.md#the-watch): the rail's berths by
// project, what a goal's sheet asks of the captain, what came in since the watch began, the lead's conversation for the
// panel. Pure, so it's tested (streamList.test.ts).

/** When the captain last looked at each goal's conversation, from what this browser kept: only entries that are a time. */
export function seenOf(kept: unknown): Record<string, number> {
  if (typeof kept !== 'object' || kept === null || Array.isArray(kept)) return {};
  return Object.fromEntries(Object.entries(kept).filter((e): e is [string, number] => typeof e[1] === 'number' && Number.isFinite(e[1])));
}

/**
 * What a goal's sheet asks of the captain: the first thing that needs them there which this browser has too (its
 * decision card), else a turn the chief of staff has words ready for (`ready`: sent with a press, or heard).
 */
export function footOf(items: readonly Pick<InboxItem, 'id' | 'lane'>[], known: (id: string) => boolean): { card?: string; ready?: true } {
  const item = items.find((i) => i.lane === 'needs-you' && known(i.id)) ?? items.find((i) => i.lane === 'ready' && known(i.id));
  if (!item) return {};
  return { card: item.id, ...(item.lane === 'ready' && { ready: true as const }) };
}

/** What a goal's lead is doing, in plain words. */
export function doing(status: string): string {
  const words: Record<string, string> = { done: 'between turns', working: 'working', testing: 'testing', waiting: 'waiting on a permission', pushing: 'pushing', 'setting-up': 'setting up', queued: 'about to start', error: 'stopped on an error', stopped: 'stopped' };
  return words[status] ?? status;
}

/** The rail: every shown project's goals in their berths, under its name, in the order the project lists them. */
export function berths<G extends { projectId: string }>(goals: readonly G[], projects: readonly { id: string; name: string }[]): { name: string; goals: G[] }[] {
  return projects.map((p) => ({ name: p.name, goals: goals.filter((g) => g.projectId === p.id) })).filter((s) => s.goals.length);
}

/** What came in since the watch began, in brief: what merged, what QA passed, what went back or was flagged. */
export function bundleSays(entries: readonly ThreadEntry[]): string[] {
  const says: string[] = [];
  const merged = entries.flatMap((e) => (e.kind === 'merged' ? [`#${e.number}`] : []));
  if (merged.length) says.push(`merged ${merged.join(', ')}`);
  // QA's verdict is its message's first line: what follows (its findings) may say "passed" of anything
  const passed = entries.filter((e) => e.kind === 'ops' && /^QA/.test(e.from) && /\bpassed\b/.test(e.text.split('\n')[0] ?? '')).length;
  if (passed) says.push(passed > 1 ? `QA passed ${passed}` : 'QA passed');
  const back = entries.filter((e) => e.kind === 'cos' && e.route === 4).length;
  if (back) says.push(back > 1 ? `sent back ${back}×` : 'sent back once');
  if (entries.some((e) => e.kind === 'cos' && e.route === 3)) says.push('flagged to you');
  return says;
}

/**
 * A lead's conversation, for the panel: what they said, what the user said to them, and what anyone else told them
 * (drawn folded, collapsedMessage.ts), nothing else.
 */
export const conversation = (entries: readonly ThreadEntry[]): ThreadEntry[] => entries.filter((e) => e.kind === 'lead' || e.kind === 'you' || e.kind === 'ops');

/** The project's preview, when it's running one of this lead's pull requests: on the exhibit card. */
export function previewFor<P extends { repo: string; number: number }>(preview: P | undefined, prs: readonly { repo: string; number: number }[]): P | undefined {
  return preview && prs.some((p) => p.repo === preview.repo && p.number === preview.number) ? preview : undefined;
}
