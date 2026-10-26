// The chief of staff (README.md): what its server part and the browser share.
import type { Agent, VerdictRoute } from '../../plugin-api/shared';
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

/** A turn as it judged it: its route, the line on what's decided, why, its words, and the replies it suggests. */
export interface Verdict {
  route: CosRoute;
  /** The check that decided it: left out by verdicts from before it said. */
  check?: Check;
  /** What's being decided, in a line: the captain's inbox leads with it. */
  ask: string;
  /** Why the turn goes where it does. */
  why: string;
  /** The words it would send: to the lead on routes 1 and 4, to the captain on 2 and 3. */
  message: string;
  /** Replies to what the lead asked or offered, a button each; none when the turn asks nothing a button answers. */
  replies?: Reply[];
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

/** A verdict, if `v` is one: one from before it suggested replies reads as suggesting none. */
export function verdictOf(v: unknown): Verdict | undefined {
  if (!isRecord(v) || !isOneOf(ROUTES, v.route) || typeof v.ask !== 'string' || typeof v.why !== 'string' || typeof v.message !== 'string') return undefined;
  const replies = repliesOf(v.replies);
  return { route: v.route, ask: v.ask, why: v.why, message: v.message, ...(replies.length && { replies }) };
}

/**
 * A read, if `v` is one: what the lead's mark holds, from this plugin (or an older one of it). A countdown is only ever
 * on words sending a turn back to the lead: one an older version set on a carry-on is dropped, so it never goes by itself.
 */
export function cosReadOf(v: unknown): CosRead | undefined {
  if (!isRecord(v) || typeof v.at !== 'number') return undefined;
  const judged = verdictOf(v.judged);
  const acked = typeof v.acked === 'number' ? v.acked : undefined;
  return {
    at: v.at,
    ...(judged && { judged }),
    ...(judged?.route === 4 && acked === undefined && typeof v.sendsAt === 'number' && { sendsAt: v.sendsAt }),
    ...(acked !== undefined && { acked }),
  };
}

/** Its read of a lead's latest turn, from the lead's marks. */
export const readOf = (agent: Pick<Agent, 'lead'> | undefined): CosRead | undefined => cosReadOf(agent?.lead?.marks?.[CHIEF_OF_STAFF]);

/**
 * What it keeps across a restart, by project: whether it sends its words by itself (`autoSendFor`), and whether Jev
 * routes its turns (`jevFor`; missing from what was kept before there was the switch).
 */
export interface CosState {
  autoSend: Record<string, boolean>;
  jev?: Record<string, boolean>;
}

export const freshState = (): CosState => ({ autoSend: {}, jev: {} });

const switches = (v: unknown): Record<string, boolean> =>
  isRecord(v) ? Object.fromEntries(Object.entries(v).filter((e): e is [string, boolean] => typeof e[1] === 'boolean')) : {};

/** Its state as the browser has it (`state.plugins[CHIEF_OF_STAFF]`): fresh where it isn't one. */
export function cosStateOf(v: unknown): CosState {
  return { autoSend: switches(isRecord(v) ? v.autoSend : undefined), jev: switches(isRecord(v) ? v.jev : undefined) };
}
