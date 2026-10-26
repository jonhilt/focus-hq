import type { LedgerEntry, ThreadDecidedAs } from '../../plugin-api/shared';
import { clean, NOTE_LIMIT, THREAD_ENDS, type Thread, type ThreadEnd } from './shared';

// The threads plugin's decisions (README.md): what the captain deciding a thread, accepting a model's proposals or
// spinning a thread off writes or starts, or why it's refused; and which threads Sort for me asks about. Pure, so it's
// tested (threadsRules.test.ts).

/** The ends that say nothing without a note: parked until when, dropped why. */
const NEEDS_NOTE: Partial<Record<ThreadEnd, string>> = { parked: 'Say until when it’s parked', dropped: 'Say why it’s dropped' };

const isAs = (as: unknown): as is ThreadDecidedAs => as === 'open' || THREAD_ENDS.some((end) => end === as);

/**
 * The ledger line the captain deciding where a thread ends writes, or why it's refused (then nothing is written):
 * `threads` are its project's closed goals' threads, and `underWay` the goals under way there, whose threads are
 * their leads'. The same decision again is refused, so a second press of the same button writes nothing.
 */
export function decision(threads: readonly Thread[] | undefined, underWay: ReadonlySet<string>, input: Record<string, unknown>): { entry: LedgerEntry } | { error: string } {
  const { goal, contact, as } = input;
  if (!isAs(as)) return { error: `A thread ends as ${THREAD_ENDS.join(', ')}, or goes back to be decided (open)` };
  const t = (threads ?? []).find((x) => x.goal === goal && x.contact === contact);
  if (!t) return { error: 'There’s no such thread left open on a closed goal' };
  if (underWay.has(t.goal)) return { error: `“${t.goalTitle}” is under way again: the thread is its lead’s until it closes` };
  const note = clean(typeof input.note === 'string' ? input.note : '');
  if (note.length > NOTE_LIMIT) return { error: `The note is ${note.length} characters (at most ${NOTE_LIMIT})` };
  if (as === 'open') {
    if (!t.decided) return { error: 'It isn’t decided yet' };
  } else {
    const needs = NEEDS_NOTE[as];
    if (needs && !note) return { error: needs };
    if (t.decided?.as === as && (t.decided.note ?? '') === note) return { error: `It’s already ${as === 'next' ? 'taken on' : as}` };
  }
  return { entry: { kind: 'thread-decided', goalId: t.goal, goal: t.goalTitle, contact: t.contact, text: t.text, as, ...(as !== 'open' && note && { note }) } };
}

const isEnd = (as: unknown): as is ThreadEnd => THREAD_ENDS.some((end) => end === as);

/** The ledger line accepting what was proposed of `t` writes: the decision as proposed, saying so. */
const accepted = (t: Thread): LedgerEntry[] =>
  t.proposed ? [{ kind: 'thread-decided', goalId: t.goal, goal: t.goalTitle, contact: t.contact, text: t.text, as: t.proposed.as, note: t.proposed.note, proposed: true }] : [];

/**
 * The ledger lines the captain accepting a model's proposals writes, or why it's refused (then nothing is written):
 * one thread's (`goal` and `contact`), or every one still to decide whose proposal ends it `as` (all the drops, say).
 * Only a closed goal's threads, as for any decision (`underWay` keeps its leads').
 */
export function acceptances(threads: readonly Thread[] | undefined, underWay: ReadonlySet<string>, input: Record<string, unknown>): { entries: LedgerEntry[] } | { error: string } {
  const open = (threads ?? []).filter((t) => t.proposed && !t.decided && !underWay.has(t.goal));
  if (input.contact !== undefined) {
    const t = open.find((x) => x.goal === input.goal && x.contact === input.contact);
    return t ? { entries: accepted(t) } : { error: 'There’s no proposal for that thread to accept' };
  }
  if (!isEnd(input.as)) return { error: `Say which proposals to accept: ${THREAD_ENDS.join(', ')}` };
  const entries = open.filter((t) => t.proposed?.as === input.as).flatMap(accepted);
  return entries.length ? { entries } : { error: `No thread to decide has ${input.as} proposed` };
}

/**
 * The thread the captain spins off as a goal of its own, starting it with `text`, or why it's refused (then no goal
 * starts): one left open on a closed goal of `threads` (not one under way, of `underWay`), and not spun off already.
 */
export function toSpinOff(threads: readonly Thread[] | undefined, underWay: ReadonlySet<string>, input: Record<string, unknown>): { thread: Thread; text: string } | { error: string } {
  const t = (threads ?? []).find((x) => x.goal === input.goal && x.contact === input.contact);
  if (!t) return { error: 'There’s no such thread left open on a closed goal' };
  if (underWay.has(t.goal)) return { error: `“${t.goalTitle}” is under way again: the thread is its lead’s until it closes` };
  if (t.decided?.spunOff) return { error: `It’s a goal of its own already: “${t.decided.spunOff.title}”` };
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (!text) return { error: 'Say what the goal is: its lead hears it first' };
  return { thread: t, text };
}

/**
 * At most this many threads a sort: every one a project has to decide, in one call, so a thread said twice is seen
 * twice and a press doesn't ask about the same oldest ones again (Focus's own had about 200 at the first press).
 */
export const SORT_LIMIT = 300;

/** The threads a sort asks about: a closed goal's (not one under way, of `underWay`), still to decide; never proposed first, then oldest first. */
export function toSort(threads: readonly Thread[] | undefined, underWay: ReadonlySet<string>): Thread[] {
  return (threads ?? [])
    .filter((t) => !t.decided && !underWay.has(t.goal))
    .sort((a, b) => Number(!!a.proposed) - Number(!!b.proposed) || a.at - b.at)
    .slice(0, SORT_LIMIT);
}
