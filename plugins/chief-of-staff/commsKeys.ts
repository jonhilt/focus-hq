// Comms by keyboard: what a key does there, pure so it's unit tested (commsKeys.test.ts). The answers it presses are
// the reading pane's buttons, each marked with what it does (`data-act`): a key with nothing to press does nothing.

/** What a key asks of Comms: move through the queue, press one of the answers, write a reply, or open the goal. */
export type CommsAct = { move: 1 | -1 } | { press: string } | { reply: true } | { goal: true };

/** The keys, as the hint under the queue lists them. */
export const COMMS_KEYS = 'J/K move · Enter send the chief of staff’s words · H hold · 1–9 pick, or a suggested reply · O got it · M merge · A approve · D decline · R reply · G open the goal · Esc close';

const KEYS: Record<string, CommsAct> = {
  j: { move: 1 },
  ArrowDown: { move: 1 },
  k: { move: -1 },
  ArrowUp: { move: -1 },
  Enter: { press: 'send' },
  h: { press: 'hold' },
  o: { press: 'ack' },
  m: { press: 'merge' },
  a: { press: 'allow' },
  d: { press: 'decline' },
  r: { reply: true },
  g: { goal: true },
};

/**
 * What a key does in Comms, if anything. Never while the captain is writing (`typing`: in a reply or a note), nor
 * with Ctrl, Alt or Cmd held (the panel's own shortcuts, and the browser's). 1 to 9 pick a question's options in order,
 * or send a lead's turn's suggested replies (a card has one or the other, never both).
 */
export function commsKey(e: { key: string; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean }, typing: boolean): CommsAct | null {
  if (typing || e.ctrlKey || e.altKey || e.metaKey) return null;
  if (/^[1-9]$/.test(e.key)) return { press: `pick-${e.key}` };
  return KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key] ?? null;
}
