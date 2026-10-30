import { type Ask, type CosRoute, NEW_GOAL, type Verdict } from './shared';

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
