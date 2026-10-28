import type { Attention } from '../../plugin-api/shared';

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
  /** To the project's pull requests, where QA's word or the conflict is. */
  | { kind: 'prs'; label: string };

export interface DecisionActs {
  /** The pick, made so with one press: drawn first, as the go button. */
  go?: Act;
  /** What the pick is, said above the buttons, when "Make it so" alone wouldn't say. */
  pick?: string;
  others: Act[];
  /** Got it: read, off the queue, nothing sent. Only a lead's turn has it. */
  ack: boolean;
  /** Their open pull requests can merge from the card, folded under More. */
  more: boolean;
}

/**
 * What a decision offers, by its kind. A lead's turn makes the chief of staff's first suggested reply so, the rest
 * beside it; a raised hand allows its tool or declines (nothing until its request is in); a question picks one of its
 * options, none put first since the lead didn't pick; a wrap-up closes the goal; a pull request's QA or conflicts go
 * to the pull requests. Talking it over is the card's own (Discuss), so an error has nothing else.
 */
export function actsOf(d: {
  kind: Attention['kind'];
  lead?: string;
  replies?: readonly { label: string; text: string }[];
  question?: { id: string; options: readonly { id: string; label: string }[] };
  permission?: { id: string; tool: string };
  prs: number;
}): DecisionActs {
  const more = d.prs > 0;
  switch (d.kind) {
    case 'turn': {
      const [first, ...rest] = (d.replies ?? []).map((r): Act => ({ kind: 'reply', label: r.label, text: r.text }));
      return { ...(first && { go: { ...first, label: 'Make it so' }, pick: first.label }), others: rest, ack: true, more };
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

/** What Discuss sends the lead: the captain's words, after the decision they're about. */
export const aboutIt = (what: string, words: string): string => `About “${what}”: ${words}`;
