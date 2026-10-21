import type { CosRoute } from '../../shared/ledger';
import type { JournalEntry, TurnKind } from './runJournal';

// The life of every card the captain was owed, replayed from what the office kept (`pnpm run card-replay`): each work
// turn a goal lead ends opens one, the chief of staff's verdict on it says how much it needed the captain, and it closes
// when the lead's next turn starts. What woke the lead says who closed it: the captain, the chief of staff's words, or
// something else (a QA verdict, a slice landing, a restart) that wiped a card nobody had answered. Cards are never
// stored (they're worked out from the agent each time), so this is the only record of how they ended. Pure: the tool
// reads the files.

/** Who a message to a lead is from, by how the office opens it (`Comms.message`'s `[from]`, its carry-on notes). */
export type Sender =
  | 'captain'
  | 'chief-of-staff'
  | 'qa'
  | 'slice-landed'
  | 'conflict'
  | 'office'
  | 'restart'
  | 'plan-limit'
  | 'quick-answerer'
  | `plugin:${string}`;

const OPENINGS: [RegExp, Sender][] = [
  [/^\[Chief of Staff\]/, 'chief-of-staff'],
  [/^\[QA officer /, 'qa'],
  [/^\[Office\] Slice \d+ has landed/, 'slice-landed'],
  [/^\[Office\] \S+ had merge conflicts/, 'conflict'],
  [/^\[Office\]/, 'office'],
  // the captain's question on a briefing, relayed while the lead was busy
  [/^\[Quick answerer\]/, 'quick-answerer'],
  [/^Focus restarted (while|part way)/, 'restart'],
  [/^The office paused you mid-turn/, 'plan-limit'],
  [/^The office couldn't install/, 'office'],
];

/** Who sent a lead `text`: the captain's own words come plain, everyone else's opened with who they are. */
export function senderOf(text: string): Sender {
  const t = text.trimStart();
  for (const [opening, sender] of OPENINGS) if (opening.test(t)) return sender;
  const from = /^\[([^\]]+)\]/.exec(t)?.[1];
  return from ? `plugin:${from}` : 'captain';
}

/** Words that are the captain's, whoever carried them. */
export const captainVoiced = (sender: Sender): boolean => sender === 'captain' || sender === 'quick-answerer';

/** A `cos-verdict` from the ledger, as much as the replay needs. */
export interface VerdictFact {
  sessionId: string;
  route: CosRoute;
  why: string;
  message?: string;
  at: number;
}

/** A `captain-decision` from the ledger for this lead. */
export interface DecisionFact {
  kind: string;
  answer: string;
  via: string;
  at: number;
}

export interface LeadInfo {
  id: string;
  projectId: string;
  name?: string;
  goal?: string;
}

/** A message the lead was sent while the card was open. */
export interface CardMessage {
  sender: Sender;
  at: number;
  text: string;
  /** Queued for their next turn, or sent into a session still listening. */
  how: 'queued' | 'sent';
}

/**
 * How a card ended: the captain's words woke the lead, the chief of staff's did, something else did first
 * (`superseded`), the goal ended (the lead was sent home), or the lead hasn't been woken yet.
 */
export type CardOutcome = 'captain' | 'cos-sent' | 'superseded' | 'ended' | 'open';

export interface Card {
  agentId: string;
  projectId: string;
  lead?: string;
  goal?: string;
  turn: string;
  session?: string;
  openedAt: number;
  route: CosRoute | 'unjudged';
  why?: string;
  verdictAt?: number;
  outcome: CardOutcome;
  /** What woke the lead (`none`: their next turn started with nothing sent, the office's own doing). */
  by?: Sender | 'none';
  /** For `cos-sent`: whether the chief of staff sent its words itself, or the captain pressed send. */
  cosSentBy?: 'auto' | 'captain';
  /** The captain said something (a message, or an answer in their inbox) while it was open. */
  captainSpoke: boolean;
  /** When the lead was woken (the office picking them up), and when their next turn started (or the goal ended). */
  wokeAt?: number;
  closedAt?: number;
  waitMs?: number;
  waker?: CardMessage;
  /** For a card a slice landing woke the lead from: who merged it (the captain, the office's auto-merge…). */
  mergedBy?: string;
  messages: CardMessage[];
  decisions: DecisionFact[];
}

/** How long after a turn ends the chief of staff's verdict on it can come. */
export const VERDICT_WITHIN_MS = 10 * 60_000;

/** Facts that say the office is picking the lead up: whatever was queued last is what woke them. */
const WAKES = new Set(['waiting', 'held', 'setting-up', 'taken']);

const clip = (text: string, max = 120) => {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
};

interface Open {
  card: Card;
  lastQueued?: CardMessage;
}

/** The chief of staff's verdict on a turn that ended at `at` in `session`: the soonest after, not one already used. */
export function verdictFor(verdicts: readonly VerdictFact[], session: string | undefined, at: number, used: Set<VerdictFact>, within = VERDICT_WITHIN_MS): VerdictFact | undefined {
  if (!session) return undefined;
  const fits = verdicts.filter((v) => v.sessionId === session && v.at >= at && v.at - at <= within && !used.has(v));
  return fits.sort((a, b) => a.at - b.at)[0];
}

/** How a card that was woken ended, from what woke it and what the captain decided while it was open. */
export function outcomeOf(waker: CardMessage | undefined, decisions: readonly DecisionFact[]): Pick<Card, 'outcome' | 'by' | 'cosSentBy'> {
  if (!waker) return { outcome: 'superseded', by: 'none' };
  if (captainVoiced(waker.sender)) return { outcome: 'captain', by: waker.sender };
  if (waker.sender !== 'chief-of-staff') return { outcome: 'superseded', by: waker.sender };
  const sent = decisions.find((d) => d.answer.startsWith('Sent the chief of staff'));
  return { outcome: 'cos-sent', by: waker.sender, ...(sent && { cosSentBy: sent.via === 'chief-of-staff' ? 'auto' : 'captain' }) };
}

function close(open: Open, at: number, decisions: readonly DecisionFact[], ended: boolean): Card {
  const { card } = open;
  const inWindow = decisions.filter((d) => d.at >= card.openedAt && d.at <= at);
  const waker = card.wokeAt === undefined ? open.lastQueued : card.waker;
  const how: Pick<Card, 'outcome' | 'by' | 'cosSentBy'> = ended ? { outcome: 'ended' } : outcomeOf(waker, inWindow);
  const spoke = inWindow.length > 0 || card.messages.some((m) => captainVoiced(m.sender));
  return { ...card, ...how, ...(waker && !ended && { waker }), closedAt: at, waitMs: at - card.openedAt, decisions: inWindow, captainSpoke: spoke };
}

function leftOpen(open: Open, decisions: readonly DecisionFact[]): Card {
  const { card } = open;
  const inWindow = decisions.filter((d) => d.at >= card.openedAt);
  return { ...card, outcome: 'open', decisions: inWindow, captainSpoke: inWindow.length > 0 || card.messages.some((m) => captainVoiced(m.sender)) };
}

/** A card opened by `turn` ending at `at`, judged by the chief of staff's verdict if there was one. */
function opened(lead: LeadInfo, turn: string, session: string | undefined, at: number, verdict: VerdictFact | undefined): Card {
  return {
    agentId: lead.id, projectId: lead.projectId, ...(lead.name && { lead: lead.name }), ...(lead.goal && { goal: lead.goal }),
    turn, ...(session && { session }), openedAt: at,
    route: verdict?.route ?? 'unjudged', ...(verdict && { why: verdict.why, verdictAt: verdict.at }),
    outcome: 'open', captainSpoke: false, messages: [], decisions: [],
  };
}

/** A message while a card is open: noted, and a `sent` one (into a session still listening) is what woke the lead. */
function heard(open: Open, entry: { kind: 'queued' | 'sent'; text: string; t: number }): void {
  const message: CardMessage = { sender: senderOf(entry.text), at: entry.t, text: clip(entry.text), how: entry.kind };
  open.card.messages.push(message);
  if (entry.kind === 'queued') open.lastQueued = message;
  else if (open.card.wokeAt === undefined) Object.assign(open.card, { wokeAt: entry.t, waker: message });
}

/** What the ledger says besides the journal: the chief of staff's verdicts (any lead's), the captain's answers to this lead, merges. */
export interface CardSources {
  verdicts: readonly VerdictFact[];
  decisions: readonly DecisionFact[];
  merges?: readonly MergeFact[];
}

/** A `merged` line from the ledger: who merged a slice's pull request. */
export interface MergeFact {
  repo: string;
  pr: number;
  by: string;
}

/** Who merged the first pull request a "slice has landed" note names. */
export function landedBy(text: string, merges: readonly MergeFact[]): string | undefined {
  const ref = /([\w.-]+\/[\w.-]+)#(\d+) merged/.exec(text);
  return ref ? merges.find((m) => m.repo === ref[1] && m.pr === Number(ref[2]))?.by : undefined;
}

/** A turn that's no card: a compaction, or one the office carried on from by itself. */
const noCard = (kind: TurnKind | undefined, limited: boolean | undefined) => kind === 'compact' || !!limited;

/**
 * Every card one goal lead's run journal opened, and how each ended. A compaction the office starts doesn't close one
 * (the lead's still owed an answer); news held for the turn's end (`later`) is heard as the card opens.
 */
export function leadCards(lead: LeadInfo, entries: readonly JournalEntry[], { verdicts, decisions, merges = [] }: CardSources): Card[] {
  const cards: Card[] = [];
  const kinds = new Map<string, TurnKind>();
  const sessions = new Map<string, string>();
  const used = new Set<VerdictFact>();
  let later: { text: string; t: number }[] = [];
  let open: Open | undefined;
  const finish = (card: Card) => {
    const mergedBy = card.by === 'slice-landed' && card.waker ? landedBy(card.waker.text, merges) : undefined;
    cards.push(mergedBy ? { ...card, mergedBy } : card);
  };
  for (const e of entries) {
    if (e.kind === 'turn-requested') kinds.set(e.turn, e.turnKind);
    if (e.kind === 'turn-started') sessions.set(e.turn, e.session);
    if (open && ((e.kind === 'turn-requested' && e.turnKind !== 'compact') || e.kind === 'reset')) {
      finish(close(open, e.t, decisions, e.kind === 'reset'));
      open = undefined;
    }
    if (e.kind === 'turn-ended' && !noCard(kinds.get(e.turn), e.outcome.limited)) {
      const session = sessions.get(e.turn);
      const verdict = verdictFor(verdicts, session, e.t, used);
      if (verdict) used.add(verdict);
      open = { card: opened(lead, e.turn, session, e.t, verdict) };
      continue;
    }
    if (e.kind === 'queued' && e.at === 'later' && !open) later.push(e);
    if (e.kind === 'released') {
      if (open) for (const l of later) heard(open, { kind: 'queued', text: l.text, t: e.t });
      later = [];
    }
    if (!open) continue;
    // only a turn the lead finished is owed the captain: one carried on, failed or stopped is no card
    if (e.kind === 'decided' && e.turn === open.card.turn && e.target !== 'lead-done') open = undefined;
    else if (e.kind === 'queued' || e.kind === 'sent') heard(open, e);
    else if (WAKES.has(e.kind) && open.card.wokeAt === undefined) Object.assign(open.card, { wokeAt: e.t, ...(open.lastQueued && { waker: open.lastQueued }) });
  }
  if (open) finish(leftOpen(open, decisions));
  return cards;
}

export type RouteKey = CosRoute | 'unjudged';
export const OUTCOMES: readonly CardOutcome[] = ['captain', 'cos-sent', 'superseded', 'ended', 'open'];
export const ROUTES: readonly RouteKey[] = [1, 2, 3, 4, 'unjudged'];

export interface SummaryRow {
  route: RouteKey | 'all';
  counts: Record<CardOutcome, number>;
  total: number;
  /** The median time to close, over the cards that closed. */
  medianWaitMs?: number;
}

export function median(values: readonly number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function summaryRow(route: RouteKey | 'all', cards: readonly Card[]): SummaryRow {
  const counts: Record<CardOutcome, number> = { captain: 0, 'cos-sent': 0, superseded: 0, ended: 0, open: 0 };
  for (const c of cards) counts[c.outcome] += 1;
  const m = median(cards.flatMap((c) => (c.waitMs === undefined ? [] : [c.waitMs])));
  return { route, counts, total: cards.length, ...(m !== undefined && { medianWaitMs: m }) };
}

/** Cards per route and how they ended, with a row for them all. */
export function summarize(cards: readonly Card[]): SummaryRow[] {
  const rows = ROUTES.map((r) => summaryRow(r, cards.filter((c) => c.route === r))).filter((r) => r.total > 0);
  return [...rows, summaryRow('all', cards)];
}

/** The cards the captain truly needed (routes 2 and 3) that something else wiped before they answered. */
export const missed = (cards: readonly Card[]): Card[] => cards.filter((c) => c.outcome === 'superseded' && (c.route === 2 || c.route === 3));

/** Agent ids in an inbox item's id (`turn:<agentId>:<at>`). */
export function itemAgent(itemId: string): string | undefined {
  return /^[a-z-]+:([^:]+):/.exec(itemId)?.[1];
}
