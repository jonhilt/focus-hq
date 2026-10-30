// The chief of staff (README.md): what its server part and the browser share.
import type { Agent, FeedbackSignal, VerdictRoute } from '../../plugin-api/shared';
import { isOneOf, isRecord } from '../../plugin-api/shared';

/** The plugin's id: in FOCUS_PLUGINS, and the switch in a project's settings. */
export const CHIEF_OF_STAFF = 'chief-of-staff';

/** Who its words come from, as the lead hears them (`[Chief of Staff] …`). */
export const SENDER = 'Chief of Staff';

/** What a `captain-decision` line says was decided when its words for a lead were sent (by the captain, or itself). */
export const SENT_WORDS = 'Sent the chief of staff’s words';

/** What a `captain-decision` line says was decided when the captain acknowledged a lead's turn (Got it): nothing sent. */
export const ACKNOWLEDGED = 'Acknowledged';

/** Where it sends a turn: 1 carry on, 2 a card for the captain, 3 interrupt the captain, 4 back to the lead. */
export type CosRoute = VerdictRoute;

export const ROUTES: readonly CosRoute[] = [1, 2, 3, 4];

/** How long a lead's ended turn waits for its read before it hails the captain unjudged. */
export const JUDGING_MS = 60_000;

/** How long its words for a lead wait for the captain to hold them, in a project where it sends them itself. */
export const AUTO_SEND_MS = 120_000;

/** How often its server part sends the words whose time has come. */
export const AUTO_SEND_EVERY = 5000;

/** How many replies it suggests on a turn at most: a button each. */
export const MAX_REPLIES = 3;

/** The longest label a reply's button takes: a button doesn't wrap, so a longer one would run off the card. */
export const MAX_REPLY_LABEL = 30;

/** The longest words a reply sends: a short answer, not a letter. */
export const MAX_REPLY_TEXT = 500;

/** A reply it suggests the captain send the lead, a button on the turn: its label, and the words that go. */
export interface Reply {
  /** A few words on the button ("Keep it open"). */
  label: string;
  /** The reply itself, as the captain would write it, sent as theirs. */
  text: string;
}

/**
 * Which of its checks decided a turn (crew/judge.md), in the order it makes them: something that can't be undone or
 * reaches beyond the ship, the lead overreaching what's agreed, a step whose purpose isn't clear, a claim with no
 * evidence, a question that isn't ready for the captain, a step only the captain can agree, or none of them.
 */
export const CHECKS = ['irreversible', 'contradiction', 'overreach', 'compass', 'evidence', 'prepared', 'captains', 'none'] as const;
export type Check = (typeof CHECKS)[number];

/** How many separate decisions it puts to the user on one turn at most: a block each on the card. */
export const MAX_ASKS = 4;

/** Where a move takes work: an open goal, by its lead's id, or a new goal (`NEW_GOAL`). */
export const NEW_GOAL = 'new';

/**
 * Work it found in a lead's turn that belongs in another open goal or in a new one (handoverRules.ts): the lead saying
 * so, or the judge inferring it from what done looks like and the other open goals. Only the user moves it (P3).
 */
export interface Move {
  /** The work, in a few words ("the retry build"). */
  what: string;
  /** The receiving goal's lead id, or `NEW_GOAL`. */
  to: string;
  /** What the receiving lead, or the new goal, is told: what the work is, where it stands, and what's known of it. */
  brief: string;
  /** Its pick: move the work, or keep it in this goal. */
  pick: 'move' | 'keep';
}

const PICKS = ['move', 'keep'] as const;

/**
 * One decision a turn puts to the user, answered on its own (askRules.ts): its headline, and the replies that
 * answer it. On a turn with nothing for the user to decide (routes 1 and 4) there's one, saying in brief what it
 * would tell the lead.
 */
export interface Ask {
  /** The decision, in a line: the user's inbox leads with the first. */
  ask: string;
  /** Replies to this decision alone, a button each; none when a button can't answer it. */
  replies?: Reply[];
  /** The work this ask would move to another goal, when it's that decision ("Move the retry build to Tanaka's goal?"). */
  move?: Move;
}

/** A turn as it judged it: its route, the decisions it puts to the user (each with its replies), why, and its words. */
export interface Verdict {
  route: CosRoute;
  /** The check that decided it: left out by verdicts from before it said. */
  check?: Check;
  /** One per decision, at least one, `MAX_ASKS` at most; one alone on routes 1 and 4. */
  asks: Ask[];
  /** Why the turn goes where it does. */
  why: string;
  /** The turn read to the captain, in a few plain sentences, ending on what they need to do: the stream shows it in the lead's place. Left out by verdicts from before it said. */
  says?: string;
  /** The words it would send: to the lead on routes 1 and 4, to the captain on 2 and 3. */
  message: string;
}

/** An answer the user gave one of a turn's asks, held until every ask has one (askRules.ts). */
export interface AskAnswer {
  /** Which ask it answers: its place in the verdict's `asks`. */
  ask: number;
  /** The words, as they'll go to the lead. */
  text: string;
}

/**
 * Its read of a goal lead's latest turn, its mark on it (`lead.marks[CHIEF_OF_STAFF]`, `PluginGoals.mark`): from the
 * turn's end (`at`) until it's `judged`. The core clears it as the lead's next turn starts.
 */
export interface CosRead {
  /** When the turn ended. */
  at: number;
  judged?: Verdict;
  /**
   * When it sends its words to the lead itself, unless the captain holds them first: set as it judges a turn it would
   * send back, in a project that lets it (`autoSendFor`), never one it would carry on; cleared by Hold.
   */
  sendsAt?: number;
  /**
   * When the captain acknowledged the turn (Got it): read, nothing sent and the lead not woken, so it's off their queue
   * until the lead's next turn, its words don't go by themselves, and the move waits quietly on the captain.
   */
  acked?: number;
  /**
   * The user's answers to the turn's asks so far, held rather than sent: once every ask has one, they go to the lead
   * together as one message (askRules.ts). Kept with the read, so a reload or a restart keeps them.
   */
  answers?: AskAnswer[];
  /** The turn it judged, by its transcript's last line (its `cos-verdict`'s `turnUuid`): what the user's word on it names. Left out by reads from before it was kept. */
  turnUuid?: string;
}

const trimmed = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * A reply, if `v` is one: a label and words, both said and neither too long (`MAX_REPLY_LABEL`, `MAX_REPLY_TEXT`). An
 * overlong one is dropped rather than clipped: a clipped label misnames the button, and clipped words would go to the
 * lead half said.
 */
function replyOf(v: unknown): Reply | undefined {
  if (!isRecord(v)) return undefined;
  const label = trimmed(v.label);
  const text = trimmed(v.text);
  const fits = label.length <= MAX_REPLY_LABEL && text.length <= MAX_REPLY_TEXT;
  return label && text && fits ? { label, text } : undefined;
}

/** The replies in `v`, if it lists any: each with a label and words, no label twice, `MAX_REPLIES` at most. */
export function repliesOf(v: unknown): Reply[] {
  if (!Array.isArray(v)) return [];
  const out: Reply[] = [];
  for (const r of v.map(replyOf)) {
    if (r && out.length < MAX_REPLIES && !out.some((o) => o.label.toLowerCase() === r.label.toLowerCase())) out.push(r);
  }
  return out;
}

/** A move, if `v` is one: the work, where it goes and what they're told all said, and a pick of the two. */
export function moveOf(v: unknown): Move | undefined {
  if (!isRecord(v) || !isOneOf(PICKS, v.pick)) return undefined;
  const what = trimmed(v.what);
  const to = trimmed(v.to);
  const brief = trimmed(v.brief);
  return what && to && brief ? { what, to, brief, pick: v.pick } : undefined;
}

/** An ask, if `v` is one: a headline said, the replies to it (`repliesOf`, left out when there are none), and its move if it has one. */
function askOf(v: unknown): Ask | undefined {
  if (!isRecord(v)) return undefined;
  const ask = trimmed(v.ask);
  const replies = repliesOf(v.replies);
  const move = moveOf(v.move);
  return ask ? { ask, ...(replies.length && { replies }), ...(move && { move }) } : undefined;
}

/**
 * The asks in `v`, `MAX_ASKS` at most: its list of them, or the single `ask` (and its `replies`) a verdict had before
 * a turn could put several decisions to the user, read as a list of one. None when it has neither.
 */
export function asksOf(v: Record<string, unknown>): Ask[] {
  if (Array.isArray(v.asks)) return v.asks.map(askOf).filter((a): a is Ask => a !== undefined).slice(0, MAX_ASKS);
  const one = askOf(v);
  return one ? [one] : [];
}

/** A verdict, if `v` is one: one from before it suggested replies reads as suggesting none, one from before it named its check names none, one with a single `ask` as a list of one. */
export function verdictOf(v: unknown): Verdict | undefined {
  if (!isRecord(v) || !isOneOf(ROUTES, v.route) || typeof v.why !== 'string' || typeof v.message !== 'string') return undefined;
  const asks = asksOf(v);
  if (!asks.length) return undefined;
  return { route: v.route, ...(isOneOf(CHECKS, v.check) && { check: v.check }), asks, why: v.why, message: v.message };
}

/** The answers held on a read, if `v` lists any: each to an ask by its place, with words, the latest to an ask kept. */
export function answersOf(v: unknown): AskAnswer[] {
  if (!Array.isArray(v)) return [];
  const by = new Map<number, string>();
  for (const a of v) if (isRecord(a) && Number.isInteger(a.ask) && typeof a.ask === 'number' && a.ask >= 0 && trimmed(a.text)) by.set(a.ask, trimmed(a.text));
  return [...by].sort(([x], [y]) => x - y).map(([ask, text]) => ({ ask, text }));
}

/**
 * A read, if `v` is one: what the lead's mark holds, from this plugin (or an older one of it). A countdown is only ever
 * on words sending a turn back to the lead: one an older version set on a carry-on is dropped, so it never goes by itself.
 */
export function cosReadOf(v: unknown): CosRead | undefined {
  if (!isRecord(v) || typeof v.at !== 'number') return undefined;
  const judged = verdictOf(v.judged);
  const acked = typeof v.acked === 'number' ? v.acked : undefined;
  const answers = judged ? answersOf(v.answers).filter((a) => a.ask < judged.asks.length) : [];
  return {
    at: v.at,
    ...(judged && { judged }),
    ...(judged?.route === 4 && acked === undefined && typeof v.sendsAt === 'number' && { sendsAt: v.sendsAt }),
    ...(acked !== undefined && { acked }),
    ...(answers.length && { answers }),
    ...(judged && typeof v.turnUuid === 'string' && v.turnUuid && { turnUuid: v.turnUuid }),
  };
}

/** Its read of a lead's latest turn, from the lead's marks. */
export const readOf = (agent: Pick<Agent, 'lead'> | undefined): CosRead | undefined => cosReadOf(agent?.lead?.marks?.[CHIEF_OF_STAFF]);

/**
 * What it keeps across a restart, by project: whether it sends its words by itself (`autoSendFor`), and whether Jev
 * routes its turns (`jevFor`; missing from what was kept before there was the switch). And the captain's watch
 * (README.md#the-watch): the goal at the conn, by its lead's id, and the hails they told to stand by, by `hailKey`.
 */
export interface CosState {
  autoSend: Record<string, boolean>;
  jev?: Record<string, boolean>;
  conn?: string;
  stoodBy?: string[];
  /** The user's direct line to it (README.md#the-direct-line): missing until they first say something on it. */
  line?: CosLine;
}

/** Something said on the direct line: by the user, or by the chief of staff. */
export interface LineMessage {
  from: 'user' | 'cos';
  text: string;
  at: number;
}

/** A goal it started from the direct line: kept so it starts once (`lineRules.ts`), and shown with a way to close it. */
export interface LineStart {
  /** The project and the goal's words, normalised (`goalKey`): the same goal asked for again has the same key. */
  key: string;
  leadId: string;
  projectId: string;
  /** The project's name and the goal's words, as they were when it started. */
  project: string;
  text: string;
  /** Why it started it, in its words to the user. */
  why: string;
  at: number;
  /** When the user closed it from the line (its undo): it may be started again after that. */
  closed?: number;
  /** When the user acknowledged its notice in the muster (Got it): off the muster, the goal running on. */
  acked?: number;
}

/** What it told an existing goal's lead from the direct line, in place of starting one. */
export interface LineTold {
  leadId: string;
  goal: string;
  text: string;
  at: number;
}

/**
 * The direct line (README.md#the-direct-line): the conversation, its Claude Code session so the next message resumes
 * it, and the goals it started or told from it. `thinking` while a turn runs; a turn a restart cut is `failed`.
 */
export interface CosLine {
  status: 'waiting' | 'thinking' | 'failed';
  messages: LineMessage[];
  started: LineStart[];
  told: LineTold[];
  sessionId?: string;
  error?: string;
  costUsd: number;
  /** When the conversation began afresh: what it started or told before then is kept, but not shown. */
  since?: number;
}

export const freshLine = (): CosLine => ({ status: 'waiting', messages: [], started: [], told: [], costUsd: 0 });

/** What it's doing on the line this moment, which isn't saved: a turn reads a lot. */
export interface CosLive {
  lineActivity: string;
  /** The user's word on leads' turns pressed now, by turn (`turnKey`), read again from the ledger as Focus starts (feedbackRules.ts). */
  feedback?: Record<string, FeedbackSignal[]>;
}

export const freshState = (): CosState => ({ autoSend: {}, jev: {} });

const switches = (v: unknown): Record<string, boolean> =>
  isRecord(v) ? Object.fromEntries(Object.entries(v).filter((e): e is [string, boolean] => typeof e[1] === 'boolean')) : {};

/** Its state as the browser has it (`state.plugins[CHIEF_OF_STAFF]`): fresh where it isn't one. */
export function cosStateOf(v: unknown): CosState {
  const kept = isRecord(v) ? v : {};
  const stoodBy = Array.isArray(kept.stoodBy) ? kept.stoodBy.filter((k): k is string => typeof k === 'string') : [];
  return {
    autoSend: switches(kept.autoSend),
    jev: switches(kept.jev),
    ...(typeof kept.conn === 'string' && kept.conn && { conn: kept.conn }),
    ...(stoodBy.length && { stoodBy }),
    ...(isRecord(kept.line) && { line: lineOf(kept.line) }),
  };
}

const listOf = <T>(v: unknown, one: (r: Record<string, unknown>) => T | undefined): T[] =>
  Array.isArray(v) ? v.flatMap((x) => (isRecord(x) ? [one(x)].filter((y): y is T => y !== undefined) : [])) : [];
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

function lineStartOf(r: Record<string, unknown>): LineStart | undefined {
  if (!str(r.key) || !str(r.leadId)) return undefined;
  const closed = typeof r.closed === 'number' ? r.closed : undefined;
  const acked = typeof r.acked === 'number' ? r.acked : undefined;
  return {
    key: str(r.key), leadId: str(r.leadId), projectId: str(r.projectId), project: str(r.project), text: str(r.text), why: str(r.why), at: num(r.at),
    ...(closed !== undefined && { closed }), ...(acked !== undefined && { acked }),
  };
}

/** The direct line, as its state keeps it: what isn't one is left out, so an older or damaged one still reads. */
export function lineOf(v: Record<string, unknown>): CosLine {
  const status = isOneOf(['waiting', 'thinking', 'failed'] as const, v.status) ? v.status : 'waiting';
  return {
    status,
    messages: listOf(v.messages, (m) => (isOneOf(['user', 'cos'] as const, m.from) ? { from: m.from, text: str(m.text), at: num(m.at) } : undefined)),
    started: listOf(v.started, lineStartOf),
    told: listOf(v.told, (t) => (str(t.leadId) ? { leadId: str(t.leadId), goal: str(t.goal), text: str(t.text), at: num(t.at) } : undefined)),
    ...(str(v.sessionId) && { sessionId: str(v.sessionId) }),
    ...(str(v.error) && { error: str(v.error) }),
    costUsd: num(v.costUsd),
    ...(typeof v.since === 'number' && { since: v.since }),
  };
}
