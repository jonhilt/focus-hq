import type { LandedItem } from './landed';
import type { Attention, CaptainAnswer, DecidedVia, LedgerEvent, QaReview, TermLine } from '../../plugin-api/shared';
import { artifactUrl, isRecord, lastWords, openQuestion, shownThisTurn, turnRead } from '../../plugin-api/shared';
import { type Lane, laneOf, lineOf } from './laneRules';
import { ACKNOWLEDGED, readOf, SENT_WORDS, type Verdict } from './shared';

// The captain's inbox, as the chief of staff keeps it (docs/ledger.md#the-captains-inbox-api): each thing that needs
// them with an id that stays the same from look to look, and what they decided lately, from the ledger's
// `captain-decision` lines. Comms and anything outside Focus (a bot on the API) read the same list and answer it the
// same way. What waits on them, and which answers fit, is inboxRules.ts'. Pure, so it's tested (inbox.test.ts).

/** What a hail is about, the same hail from look to look. A lead's turn keeps its key once it's read. */
export function hailKey(a: Attention): string {
  switch (a.kind) {
    case 'hand':
      return `hand:${a.agent.id}:${a.agent.permission?.id}`;
    case 'question':
      return `question:${a.agent.id}:${openQuestion(a.agent)?.id}`;
    case 'error':
      return `error:${a.agent.id}:${a.agent.finishedAt}`;
    case 'wrap-up':
      return `wrap-up:${a.agent.id}:${a.agent.lead?.closing?.at}`;
    case 'turn':
      return `turn:${a.agent.id}:${a.agent.finishedAt}`;
    case 'qa':
    case 'conflicts':
      return `${a.kind}:${a.projectId}:${a.pr.repo}#${a.pr.number}`;
  }
}

/** One thing that needs the captain, as the inbox's API gives it. */
export interface InboxItem {
  id: string;
  kind: Attention['kind'];
  projectId: string;
  /** The agent it's about; none for a pull request's. */
  agentId?: string;
  /** Who: the agent's name, or the pull request (`repo#n`). */
  who: string;
  /** The goal it's part of (a lead's), or what the agent or PR is on. */
  goal: string;
  /** What's needed, in a line. */
  what: string;
  /** When it began: the hand went up, the turn ended. */
  since?: number;
  /** A lead's turn the captain has read: still theirs to answer, but no longer hailing. */
  read?: boolean;
  /** A question's options, to pick one of by its id. */
  options?: { id: string; label: string; detail?: string }[];
  /** Whether it needs the captain, or is a lead's turn the chief of staff has words ready for, or is reading (`laneOf`). */
  lane: Lane;
  /** A lead's turn as the chief of staff judged it: its route, the line on what's decided, why, and its words. */
  cos?: Verdict;
  /** What the agent said last (`lastWords`), to read before deciding. */
  said?: string;
  /** What a lead showed on their screen this turn (`shownThisTurn`): its live page and its picture, served by the API. */
  shown?: { title: string; html: string; image?: string }[];
}

/** An item as the API serves it; given the agent's terminal `lines`, with what they said and showed. */
export function inboxItem(a: Attention, reviews: ReadonlyMap<string, QaReview>, now: number, lines?: readonly TermLine[]): InboxItem {
  const { what } = lineOf(a, reviews);
  const lane = laneOf(a, now);
  if (!('agent' in a)) return { id: hailKey(a), kind: a.kind, projectId: a.projectId, who: `${a.pr.repo}#${a.pr.number}`, goal: a.pr.title, what, lane };
  const cos = a.kind === 'turn' ? readOf(a.agent)?.judged : undefined;
  const { agent } = a;
  const since = a.kind === 'hand' ? agent.permission?.at : agent.finishedAt;
  const q = a.kind === 'question' ? openQuestion(agent) : undefined;
  const said = lines && lastWords(lines);
  const shown = lines && a.kind !== 'error' ? shownThisTurn(agent.lead?.artifacts, lines) : [];
  return {
    id: hailKey(a), kind: a.kind, projectId: agent.projectId, agentId: agent.id, who: agent.name, goal: agent.lead?.title ?? agent.issue.title, what, lane,
    ...(cos && { cos }),
    ...(since !== undefined && { since }),
    ...(a.kind === 'turn' && turnRead(agent) && { read: true }),
    ...(q && { options: q.options.map((o) => ({ id: o.id, label: o.label, ...(o.detail && { detail: o.detail }) })) }),
    ...(said && { said }),
    ...(shown.length && { shown: shown.map((s) => ({ title: s.title, html: artifactUrl(agent.id, s, 'html'), ...(s.image && { image: artifactUrl(agent.id, s, 'jpg') }) })) }),
  };
}

/**
 * How the captain answers an item: approve or decline a hand, pick a question's option, say something, close the goal,
 * send the chief of staff's words to the lead (a turn in the `ready` lane), or acknowledge a lead's turn (`ack`: read,
 * nothing sent, the lead not woken).
 */
export type Decide = CaptainAnswer | { send: true } | { ack: true };

export type { DecidedVia };

const SAY_HOW = 'Say how you decide: allow, option, text, close, send or ack';

/** A decision's body, as it comes over the API: one of `Decide`'s shapes, or why not. */
export function decideOf(body: unknown): Decide {
  if (!isRecord(body)) throw new Error(SAY_HOW);
  if (typeof body.allow === 'boolean') return { allow: body.allow };
  if (typeof body.option === 'string' && body.option) return { option: body.option, ...(typeof body.note === 'string' && body.note.trim() && { note: body.note.trim() }) };
  if (typeof body.text === 'string' && body.text.trim()) return { text: body.text.trim() };
  if (body.close === true) return { close: true };
  if (body.send === true) return { send: true };
  if (body.ack === true) return { ack: true };
  throw new Error(SAY_HOW);
}

/** What the captain decided, in a few words, for the record. */
export function answerText(d: Decide): string {
  if ('allow' in d) return d.allow ? 'Approved' : 'Declined';
  if ('option' in d) return `Picked ${d.option.toUpperCase()}${d.note ? `: ${d.note}` : ''}`;
  if ('close' in d) return 'Closed the goal';
  if ('send' in d) return SENT_WORDS;
  if ('ack' in d) return ACKNOWLEDGED;
  return d.text;
}

/** How many hours of decisions the inbox shows, and at most how many. */
const DECIDED_HOURS = 48;
const DECIDED_MAX = 30;

export type DecisionEvent = Extract<LedgerEvent, { kind: 'captain-decision' }>;

/** What the captain decided lately, newest first. */
export function recentDecisions(ledger: readonly LedgerEvent[], now: number): DecisionEvent[] {
  const since = now - DECIDED_HOURS * 3_600_000;
  const out: DecisionEvent[] = [];
  for (let i = ledger.length - 1; i >= 0 && out.length < DECIDED_MAX; i--) {
    const e = ledger[i];
    if (e.at < since) break;
    if (e.kind === 'captain-decision') out.push(e);
  }
  return out;
}

/** The inbox as the API gives it: what needs the captain, what landed in Show for them to hear of, and what they decided lately. */
export interface Inbox {
  open: InboxItem[];
  landed: LandedItem[];
  decided: DecisionEvent[];
}
