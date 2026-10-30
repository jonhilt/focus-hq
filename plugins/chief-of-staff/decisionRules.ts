import type { Attention } from '../../plugin-api/shared';
import { answerTo } from './askRules';
import { type Ask, type AskAnswer, type Move, NEW_GOAL } from './shared';

/** An ask's move as its button: the work moves to the goal its headline names, or a goal starts for it. */
export const moveAct = (move: Pick<Move, 'to'>, ask: number): Extract<Act, { kind: 'move' }> =>
  ({ kind: 'move', label: move.to === NEW_GOAL ? 'Start a goal for it' : 'Move it', ask });

// A decision's actions on the bridge (README.md#the-watch): the grammar's "Make it so" on the pick, the other choices
// named for what they do, never a letter, and nothing else on the card. Pure, so it's tested (decisionRules.test.ts).

/** One thing the captain can press on a decision, and what it's called. */
export type Act =
  /** Sends a reply the chief of staff suggested, as the captain's. */
  | { kind: 'reply'; label: string; text: string }
  /** Picks one of the lead's options, on their question. */
  | { kind: 'pick'; label: string; lead: string; question: string; option: string }
  /** Answers the lead's request to use a tool. */
  | { kind: 'allow' | 'decline'; label: string; lead: string; request: string }
  | { kind: 'close-goal'; label: string }
  /** Moves the work one of a turn's asks names to another goal, or starts one for it (handoverRules.ts). */
  | { kind: 'move'; label: string; ask: number }
  /** To the project's pull requests, where QA's word or the conflict is. */
  | { kind: 'prs'; label: string };

export interface DecisionActs {
  /** The pick, made so with one press: drawn first, marked as the pick. */
  go?: Act;
  others: Act[];
  /** Got it: read, off the queue, nothing sent. Only a lead's turn has it. */
  ack: boolean;
  /** Their open pull requests can merge from the card, folded under More. */
  more: boolean;
}

/**
 * What a decision offers, by its kind. A lead's turn makes the chief of staff's first suggested reply the pick, the
 * rest beside it; a raised hand allows its tool or declines (nothing until its request is in); a question picks one of its
 * options, none put first since the lead didn't pick; a wrap-up closes the goal; a pull request's QA or conflicts go
 * to the pull requests. Talking it over is the card's own (Discuss), so an error has nothing else.
 */
export function actsOf(d: {
  kind: Attention['kind'];
  lead?: string;
  /** A turn's replies: those of its one ask (a turn of several asks has its replies in each ask's block, `askBlocksOf`). */
  replies?: readonly { label: string; text: string }[];
  /** Its one ask's move, if it would move work: its button, the pick when the chief of staff picks moving it. */
  move?: Move;
  question?: { id: string; options: readonly { id: string; label: string }[] };
  permission?: { id: string; tool: string };
  prs: number;
}): DecisionActs {
  const more = d.prs > 0;
  switch (d.kind) {
    case 'turn': {
      const replies = (d.replies ?? []).map((r): Act => ({ kind: 'reply', label: r.label, text: r.text }));
      const all = d.move ? (d.move.pick === 'move' ? [moveAct(d.move, 0), ...replies] : [...replies, moveAct(d.move, 0)]) : replies;
      const [first, ...rest] = all;
      return { ...(first && { go: first }), others: rest, ack: true, more };
    }
    case 'hand': {
      const { lead, permission: p } = d;
      if (!lead || !p) return { others: [], ack: false, more: false };
      return { go: { kind: 'allow', label: `Allow ${p.tool}`, lead, request: p.id }, others: [{ kind: 'decline', label: 'Decline', lead, request: p.id }], ack: false, more: false };
    }
    case 'question': {
      const { lead, question: q } = d;
      return { others: lead && q ? q.options.map((o) => ({ kind: 'pick', label: o.label, lead, question: q.id, option: o.id })) : [], ack: false, more: false };
    }
    case 'wrap-up':
      return { go: { kind: 'close-goal', label: 'Close the goal' }, others: [], ack: false, more };
    case 'qa':
    case 'conflicts':
      return { go: { kind: 'prs', label: 'Pull requests' }, others: [], ack: false, more: false };
    case 'error':
      return { others: [], ack: false, more: false };
  }
}

/**
 * How a card lays out what it offers: moving work first when that's the pick (the replies beside it only keep the work
 * here); the replies, each drawn with the words it sends, since a short label alone can't say what it decides; and the
 * other buttons.
 */
export function actsLaidOut(acts: Pick<DecisionActs, 'go' | 'others'>): { moveFirst?: Extract<Act, { kind: 'move' }>; choices: Extract<Act, { kind: 'reply' }>[]; buttons: Act[] } {
  const all = [acts.go, ...acts.others].filter((x): x is Act => !!x);
  const moveFirst = acts.go?.kind === 'move' ? acts.go : undefined;
  return {
    ...(moveFirst && { moveFirst }),
    choices: all.filter((x): x is Extract<Act, { kind: 'reply' }> => x.kind === 'reply'),
    buttons: all.filter((x) => x.kind !== 'reply' && x !== moveFirst),
  };
}

/**
 * What a decision card gives the captain to decide by: on a turn brought to them (routes 2 and 3), the chief of staff's
 * words to them, every call with its pick and alternatives; otherwise its reading of the turn, or why it routed it so.
 * The routing reason alone says why it's the captain's, not what they're choosing (28 October 2026).
 */
export const briefOf = (cos: { route: number; message: string; says?: string; why: string }): string =>
  (cos.route === 2 || cos.route === 3) && cos.message ? cos.message : cos.says ?? cos.why;

/** What Discuss sends the lead: the captain's words, after the decision they're about. */
export const aboutIt = (what: string, words: string): string => `About “${what}”: ${words}`;

/** One of a turn's asks, as its block on a card: its headline, its replies, and the answer held to it, if any. */
export interface AskBlock {
  /** Its place in the verdict's asks: what an answer to it names. */
  index: number;
  ask: string;
  choices: Extract<Act, { kind: 'reply' }>[];
  /** Its move's button, when it would move work; `pick` when the chief of staff picks moving it. */
  move?: Extract<Act, { kind: 'move' }> & { pick: boolean };
  /** The answer held to it: one of its choices' words, or the user's own. */
  answer?: string;
  /** The choice the held answer is, by label; none for the user's own words. */
  picked?: string;
}

/**
 * A turn's asks as blocks on its card, each answered on its own, and where they stand: how many have an answer held,
 * and in a line, that they go to the lead together once every ask has one.
 */
export function askBlocksOf(asks: readonly Ask[], answers: readonly AskAnswer[], lead: string): { blocks: AskBlock[]; answered: number; status: string } {
  const blocks = asks.map((a, index): AskBlock => {
    const choices = (a.replies ?? []).map((r) => ({ kind: 'reply' as const, label: r.label, text: r.text }));
    const answer = answerTo(answers, index);
    const picked = answer === undefined ? undefined : choices.find((c) => c.text === answer)?.label;
    const move = a.move && { ...moveAct(a.move, index), pick: a.move.pick === 'move' };
    return { index, ask: a.ask, choices, ...(move && { move }), ...(answer !== undefined && { answer }), ...(picked && { picked }) };
  });
  const answered = blocks.filter((b) => b.answer !== undefined).length;
  const status = answered === asks.length
    ? `All ${asks.length} answered: sending them to ${lead} as one message`
    : `${answered} of ${asks.length} answered · nothing goes to ${lead} until all are, then they go together`;
  return { blocks, answered, status };
}
