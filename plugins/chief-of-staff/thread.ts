import type { Agent, LedgerEvent, TermLine, VerdictRoute } from '../../plugin-api/shared';
import { blocks, clip, messageFrom, transcriptLines } from '../../plugin-api/server';

// A goal's thread (README.md#a-thread-per-goal): the goal's conversation as the captain would read it in one place, in
// order. What they said to the lead, what the lead said as each turn ended, and, as quieter lines between them, what
// Ops, QA and the chief of staff told the lead, the pull requests that merged, and where the chief of staff sent each
// turn. Built from what's kept already: the messages to the lead from its log (each whole, and who
// it's from: in its transcript, Ops' news is joined to the captain's next message), its words from its transcript,
// and the rest from the ledger. Pure, so it's tested (thread.test.ts).

/** How much of a turn's last words, and of a message to the lead, a thread keeps. */
export const THREAD_LIMITS = { lead: 4000, you: 2000, quiet: 240, entries: 200 } as const;

/** One entry in a goal's thread. */
export type ThreadEntry =
  /** The captain's message to the lead: `via` where they sent it from, when it wasn't Focus (their phone, say). */
  | { kind: 'you'; at: number; text: string; via?: string }
  /** What the lead said as a turn ended. */
  | { kind: 'lead'; at: number; text: string }
  /** What someone else told the lead (Ops, QA, the chief of staff, the scheduler), in brief. */
  | { kind: 'ops'; at: number; from: string; text: string }
  /** One of the goal's pull requests merged. */
  | { kind: 'merged'; at: number; repo: string; number: number }
  /** Where the chief of staff sent a turn of the lead's, and why. */
  | { kind: 'cos'; at: number; route: VerdictRoute; why: string; says?: string; message?: string; check?: string };

const time = (iso: unknown): number | undefined => {
  const t = typeof iso === 'string' ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(t) ? undefined : t;
};

/** A message's first line, clipped: how a quiet entry shows it. */
const firstLine = (text: string, max: number) => clip(text.trim().split('\n')[0] ?? '', max);

/** A message to the lead as its log prints it: `▶ Captain: …`, `▶ Captain, from phone: …`, `▶ Ops: …`. */
const MESSAGE = /^▶ ([^:\n]+): ([\s\S]*)$/;

/**
 * The messages to the lead in its log, in order: the captain's in full, everyone else's in brief. `firstWords`, the
 * goal as the captain first put it, is left out where it's the first message: the thread's header has it.
 */
export function messageEntries(lines: readonly TermLine[], firstWords?: string): ThreadEntry[] {
  const out: ThreadEntry[] = [];
  for (const line of lines) {
    const m = line.kind === 'manager' ? MESSAGE.exec(line.text) : null;
    if (!m) continue;
    const [, who, text] = m;
    const captain = /^Captain(?:, from (.+))?$/.exec(who);
    if (!captain) out.push({ kind: 'ops', at: line.t, from: who, text: firstLine(text, THREAD_LIMITS.quiet) });
    else if (!(out.length === 0 && firstWords && text.trim() === firstWords.trim()))
      out.push({ kind: 'you', at: line.t, text: clip(text, THREAD_LIMITS.you), ...(captain[1] && { via: captain[1] }) });
  }
  return out;
}

/** What the lead said last before each message to them, and at the end, each at its line's time: from its transcript. */
export function leadEntries(jsonl: string): ThreadEntry[] {
  const out: ThreadEntry[] = [];
  let last: { at: number; text: string } | undefined;
  const flush = () => {
    if (last) out.push({ kind: 'lead', at: last.at, text: clip(last.text, THREAD_LIMITS.lead) });
    last = undefined;
  };
  for (const line of transcriptLines(jsonl)) {
    const at = time(line.timestamp);
    if (at === undefined || line.isMeta) continue;
    const texts = blocks(line).flatMap((b) => (b.type === 'text' && b.text?.trim() ? [b.text.trim()] : []));
    if (!texts.length) continue;
    if (line.type === 'assistant') last = { at, text: texts.join('\n\n') };
    // a message to them (anyone's, but the harness's own) ends what they said before it
    else if (line.type === 'user' && messageFrom(texts.join('\n')) !== null) flush();
  }
  flush();
  return out;
}

/** The ledger's lines that belong in a lead's thread: its pull requests merged, its turns judged. */
export function ledgerEntries(lead: Pick<Agent, 'id' | 'sessionId'>, ledger: readonly LedgerEvent[]): ThreadEntry[] {
  const out: ThreadEntry[] = [];
  for (const e of ledger) {
    if (e.kind === 'merged' && e.lead === lead.id) out.push({ kind: 'merged', at: e.at, repo: e.repo, number: e.pr });
    else if (e.kind === 'cos-verdict' && lead.sessionId && e.sessionId === lead.sessionId)
      out.push({ kind: 'cos', at: e.at, route: e.route, why: e.why, ...(e.says && { says: e.says }), ...(e.message && { message: e.message }), ...(e.check && { check: e.check }) });
  }
  return out;
}

/** A lead's thread: the messages to them, their words and the ledger's lines about it, in order, the latest `THREAD_LIMITS.entries`. */
export function goalThread(
  lead: Pick<Agent, 'id' | 'sessionId'> & { lead?: { brief?: string } },
  sources: { ledger: readonly LedgerEvent[]; lines: readonly TermLine[]; jsonl: string },
): ThreadEntry[] {
  const all = [...messageEntries(sources.lines, lead.lead?.brief), ...leadEntries(sources.jsonl), ...ledgerEntries(lead, sources.ledger)];
  // stable: at the same moment, the conversation comes before what the ledger made of it
  return all.sort((a, b) => a.at - b.at).slice(-THREAD_LIMITS.entries);
}
