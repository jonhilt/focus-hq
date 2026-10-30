import type { Mention } from './shared';

// The stack of cards beside the sheet in Comms (README.md#the-watch, option B of
// docs/design/side-panels-grammar.html): what a decision mentions, Talk and the exhibits list, each a card. The newest
// slides over the older ones, which stay as headed spines above it; a spine, a lit mention or [ and ] bring one
// forward, and × or Esc close the front one, landing on the one read before. It's the browser's view state only: a
// reload starts with none open. Pure, so it's tested (stackRules.test.ts); stream.ts draws it.

/** A card in the stack: a thing a decision mentions, Talk with the lead, or the list of the lead's exhibits. */
export type Card = Mention | { kind: 'talk' } | { kind: 'exhibits' };

/** How many cards are open at most: opening one more lets the oldest go. */
export const MAX_CARDS = 4;

/** A card's key: the same thing opened twice is one card. */
export const cardKey = (c: Card): string => ('id' in c ? `${c.kind}:${c.id}` : c.kind);

/** What the user did to the stack. */
export type StackPress =
  /** Opened a card (from a list, Discuss, T or E): to the front, once. */
  | { kind: 'open'; card: Card }
  /** Pressed a mention: lit (open anywhere in the stack) closes its card, unlit opens it at the front. */
  | { kind: 'toggle'; card: Card }
  /** Pressed a card's ×. */
  | { kind: 'close'; card: Card }
  /** Esc: the front card closes, and the one before comes forward. */
  | { kind: 'close-front' }
  /** Pressed a card's spine: it comes forward. */
  | { kind: 'forward'; card: Card }
  /** ] brings the card at the back to the front, [ sends the front card to the back. */
  | { kind: 'cycle'; by: 1 | -1 }
  /** Took another goal's conn, or stood down: every card goes. */
  | { kind: 'clear' };

/** The front card: the one being read, last in the stack. */
export const frontOf = (stack: readonly Card[]): Card | undefined => stack.at(-1);

/** Whether a card is open, in front or as a spine: its mention is lit. */
export const isOpen = (stack: readonly Card[], card: Card): boolean => stack.some((c) => cardKey(c) === cardKey(card));

const without = (stack: readonly Card[], card: Card): Card[] => stack.filter((c) => cardKey(c) !== cardKey(card));
const toFront = (stack: readonly Card[], card: Card): Card[] => [...without(stack, card), card].slice(-MAX_CARDS);

/** The stack after a press, oldest first and the front card last. */
export function pressed(stack: readonly Card[], press: StackPress): Card[] {
  switch (press.kind) {
    case 'open':
      return toFront(stack, press.card);
    case 'toggle':
      return isOpen(stack, press.card) ? without(stack, press.card) : toFront(stack, press.card);
    case 'close':
      return without(stack, press.card);
    case 'close-front':
      return stack.slice(0, -1);
    case 'forward':
      return isOpen(stack, press.card) ? toFront(stack, press.card) : [...stack];
    case 'cycle': {
      if (stack.length < 2) return [...stack];
      return press.by === 1 ? [...stack.slice(1), stack[0]] : [stack[stack.length - 1], ...stack.slice(0, -1)];
    }
    case 'clear':
      return [];
  }
}
