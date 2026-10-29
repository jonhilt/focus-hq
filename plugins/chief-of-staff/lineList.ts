import type { CosLine, LineMessage, LineStart, LineTold } from './shared';

/** Something on the direct line as Comms draws it: a message, a goal it started, or words it told an open goal. */
export type LineEntry = { kind: 'message'; message: LineMessage } | { kind: 'started'; start: LineStart } | { kind: 'told'; told: LineTold };

const atOf = (e: LineEntry): number => (e.kind === 'message' ? e.message.at : e.kind === 'started' ? e.start.at : e.told.at);

/**
 * The line in the order it happened: each goal it started or told comes where it did, between what the user said and
 * its reply. What it started or told before the conversation began afresh (`since`) isn't shown.
 */
export function lineEntries(line: Pick<CosLine, 'messages' | 'started' | 'told' | 'since'>): LineEntry[] {
  const from = line.since ?? -Infinity;
  const all: LineEntry[] = [
    ...line.messages.map((message): LineEntry => ({ kind: 'message', message })),
    ...line.started.filter((s) => s.at >= from).map((start): LineEntry => ({ kind: 'started', start })),
    ...line.told.filter((t) => t.at >= from).map((told): LineEntry => ({ kind: 'told', told })),
  ];
  // stable: a notice and a message at the same moment keep the message first
  return all.map((e, i) => ({ e, i })).sort((a, b) => atOf(a.e) - atOf(b.e) || a.i - b.i).map(({ e }) => e);
}
