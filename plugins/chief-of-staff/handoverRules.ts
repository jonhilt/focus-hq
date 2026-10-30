import { type Ask, type CosRead, type CosRoute, type Move, NEW_GOAL, type Verdict } from './shared';

// Work moves between goals only through the chief of staff (README.md#work-that-belongs-in-another-goal): reading a
// lead's turn, it may find work that belongs in another open goal or a new one, and puts the move to the user as an ask
// with its pick; it never moves work itself (P3). Pure, so it's tested (handoverRules.test.ts).

/**
 * The route a turn goes with a move in it: a move is always the user's to make, so a turn it would carry on or send
 * back to the lead goes to them as a card instead; a card or an interrupt stays as it is.
 */
export const routeWithMoves = (route: CosRoute, moves: boolean): CosRoute => (moves && (route === 1 || route === 4) ? 2 : route);

/**
 * `v` with only the moves it can make: to a new goal, or to an open goal's lead (`open`) other than the sender's
 * (`from`). An ask whose move goes anywhere else loses the move. A turn that keeps a move goes to the user
 * (`routeWithMoves`); one it would carry on or send back with none keeps its first ask alone, as any such turn does.
 */
export function movesOpen(v: Verdict, open: ReadonlySet<string>, from: string): Verdict {
  const asks: Ask[] = v.asks.map(({ move, ...ask }) => (move && (move.to === NEW_GOAL || (move.to !== from && open.has(move.to))) ? { ...ask, move } : ask));
  const route = routeWithMoves(v.route, asks.some((a) => a.move));
  return { ...v, route, asks: route === 1 || route === 4 ? asks.slice(0, 1) : asks };
}

/** The turn (by when it ended) and ask a move comes from: a `cos-handover` line keeps it, so the work moves once. */
export const handoverKey = (leadId: string, turnAt: number, ask: number): string => `${leadId}:${turnAt}:${ask}`;

/** Moving the work an ask names: refused, and why, or the move to make, by its key. */
export type MoveStep = { kind: 'refuse'; why: string } | { kind: 'move'; move: Move; key: string };

/**
 * The user approved the move on the ask at `ask` of `lead`'s turn (`read`): made once (`moved` has the keys of the
 * moves made), only while the receiving goal is still open (`open`, the leads aboard).
 */
export function moveStep(read: Pick<CosRead, 'at' | 'judged'> | undefined, ask: number, lead: string, moved: ReadonlySet<string>, open: ReadonlySet<string>): MoveStep {
  const move = read?.judged?.asks[ask]?.move;
  if (!read || !move) return { kind: 'refuse', why: 'That ask moves no work: answer it with words' };
  const key = handoverKey(lead, read.at, ask);
  if (moved.has(key)) return { kind: 'refuse', why: `${move.what} has moved already` };
  if (move.to !== NEW_GOAL && !open.has(move.to)) return { kind: 'refuse', why: 'The goal it was to go to is closed: answer it with words instead' };
  return { kind: 'move', move, key };
}

/** A goal, as a lead hears it named: its lead's, by title. */
type Goal = { name: string; title?: string };
const named = (g: Goal): string => `${g.name}'s goal${g.title ? ` “${g.title}”` : ''}`;

/** What the receiving lead is told, as the chief of staff's: where the work came from, then its brief. */
export const receivedWords = (from: Goal, move: Move): string =>
  `The captain has moved work to your goal from ${named(from)}: ${move.what}.\n\n${move.brief}\n\nIt's yours now: ${from.name} has been told it's gone.`;

/** The words a goal started for moved work starts with: the brief, and where it came from. */
export const startWords = (from: Goal, move: Move): string => `${move.brief}\n\n(Moved here from ${named(from)} by the chief of staff, as the captain approved.)`;

/** What the sending lead is told, as the answer to the ask: the work has gone, and to whom. */
export const goneWords = (move: Move, to: Goal, started: boolean): string =>
  `${started ? `A new goal was started for ${move.what}, led by ${to.name}` : `Moved to ${named(to)}: ${move.what}`}. It's theirs now, so leave it to them.`;

/** A goal's lead as a hold on closing reads them: their name, when their latest turn started, and when it ended. */
type Receiver = { name: string; finishedAt?: number; lead?: { turnStarted?: number } };

/** Whether `r` has picked up what moved to them at `at`: a turn of theirs has started since (it woke them), or ended since (it reached them mid-turn). */
const pickedUp = (r: Receiver, at: number): boolean => (r.lead?.turnStarted ?? 0) > at || (r.finishedAt ?? 0) > at;

/**
 * Why `lead` shouldn't propose closing their goal yet, if they shouldn't: work it handed on (`handovers`, the ledger's
 * `cos-handover` lines) that the receiving lead hasn't picked up. A receiving goal that's closed since holds nothing:
 * nobody's left to pick it up.
 */
export function closeHold(lead: string, handovers: readonly { from: string; to: string; at: number; what: string }[], receiver: (id: string) => Receiver | undefined): string | undefined {
  const waiting = handovers.flatMap((h) => {
    const r = h.from === lead ? receiver(h.to) : undefined;
    return r && !pickedUp(r, h.at) ? [`${h.what} (${r.name})`] : [];
  });
  if (!waiting.length) return undefined;
  return `Not yet: work this goal handed on hasn't been picked up: ${waiting.join(', ')}. Propose closing it once they've taken it up.`;
}
