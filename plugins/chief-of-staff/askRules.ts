import type { Ask, AskAnswer } from './shared';

// A lead's turn that puts several decisions to the user (README.md#suggested-replies-and-got-it): each is an ask of its
// own, answered by itself, and the answers are held until every ask has one; then they go to the lead together, as
// one message, each under its ask's headline. A turn with one ask is answered as before: its answer goes at once.
// Pure, so it's tested (askRules.test.ts).

/** What the inbox headline adds for the asks after the first: " (+2 more)". */
export const moreAsks = (n: number): string => (n > 0 ? ` (+${n} more)` : '');

/** A turn's headline in the inbox, a toast or a status line: its first ask, and how many more there are. */
export const headlineOf = (asks: readonly Pick<Ask, 'ask'>[]): string => `${asks[0]?.ask ?? ''}${moreAsks(asks.length - 1)}`;

/** The answer held to the ask at `i`, if there's one. */
export const answerTo = (answers: readonly AskAnswer[], i: number): string | undefined => answers.find((a) => a.ask === i)?.text;

/** The words that go to the lead once every ask is answered: one ask's answer as it is; several, each under its headline. */
export function together(asks: readonly Pick<Ask, 'ask'>[], answers: readonly AskAnswer[]): string {
  if (asks.length === 1) return answerTo(answers, 0) ?? '';
  return asks.map((a, i) => `**${a.ask}**\n${answerTo(answers, i) ?? ''}`).join('\n\n');
}

/** What answering one ask does: refused, held with the others (`answers`, all of them now), or every ask answered, so all of it goes (`text`). */
export type Answering =
  | { kind: 'refuse'; why: string }
  | { kind: 'hold'; answers: AskAnswer[] }
  | { kind: 'send'; answers: AskAnswer[]; text: string };

/**
 * The user answers the ask at `answer.ask` with `answer.text`, given the answers held so far: a new answer to an
 * ask replaces the one before it, so a held answer can be changed until the last ask is answered. While any ask is
 * unanswered it's held; once none is, the answers go together.
 */
export function answerAsk(asks: readonly Pick<Ask, 'ask'>[], held: readonly AskAnswer[], answer: AskAnswer): Answering {
  const text = answer.text.trim();
  if (!Number.isInteger(answer.ask) || answer.ask < 0 || answer.ask >= asks.length) return { kind: 'refuse', why: 'That turn has no such ask: answer one it lists' };
  if (!text) return { kind: 'refuse', why: 'Say what you answer it with: text' };
  const answers = [...held.filter((a) => a.ask !== answer.ask && a.ask < asks.length), { ask: answer.ask, text }].sort((x, y) => x.ask - y.ask);
  if (answers.length < asks.length) return { kind: 'hold', answers };
  return { kind: 'send', answers, text: together(asks, answers) };
}
