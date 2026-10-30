import type { FeedbackSignal, FeedbackVia, LedgerEntry, LedgerEvent, VerdictRoute } from '../../plugin-api/shared';
import { FEEDBACK_SAID, FEEDBACK_SIGNALS, FEEDBACK_VIA, isOneOf, isRecord } from '../../plugin-api/shared';

// The user's one-tap word on a lead's turn (README.md#didnt-need-me-and-you-should-have-asked-me): "Didn't need me"
// or "You should have asked me", each a `captain-feedback` line naming the turn by its session and last transcript
// line, as its `cos-verdict` does. Pressed again, it's taken back by the same line with `undo`: the log stays
// append-only, and the latest line for a turn and signal says whether it's pressed. Pure, so it's tested
// (feedbackRules.test.ts); the feedback route (feedback.ts) does the reading and the writing.

export type FeedbackLine = Extract<LedgerEntry, { kind: 'captain-feedback' }>;

/** A press as the browser sends it: which lead, which of their turns (its last line's uuid), which signal, and where. */
export interface FeedbackPress {
  agentId: string;
  turnUuid: string;
  signal: FeedbackSignal;
  via: FeedbackVia;
}

/** A press from a body, or why it isn't one. */
export function feedbackPressOf(body: unknown): FeedbackPress {
  if (!isRecord(body)) throw new Error('Say which turn and what of it: agentId, turnUuid, signal, via');
  const { agentId, turnUuid, signal, via } = body;
  if (typeof agentId !== 'string' || !agentId) throw new Error('Say whose turn: agentId');
  if (typeof turnUuid !== 'string' || !turnUuid) throw new Error('Say which turn: turnUuid');
  if (!isOneOf(FEEDBACK_SIGNALS, signal)) throw new Error(`Say what of it: signal, one of ${FEEDBACK_SIGNALS.join(', ')}`);
  if (!isOneOf(FEEDBACK_VIA, via)) throw new Error(`Say where it was pressed: via, one of ${FEEDBACK_VIA.join(', ')}`);
  return { agentId, turnUuid, signal, via };
}

/** A turn's key in what's pressed: its session and its last line. */
export const turnKey = (sessionId: string, turnUuid: string): string => `${sessionId}:${turnUuid}`;

/**
 * What's pressed, by turn (`turnKey`), from the ledger read in order: each turn's signals whose latest line isn't an
 * undo. A turn with nothing pressed is left out.
 */
export function feedbackPressed(ledger: readonly LedgerEvent[]): Record<string, FeedbackSignal[]> {
  const on = new Map<string, Set<FeedbackSignal>>();
  for (const e of ledger) {
    if (e.kind !== 'captain-feedback') continue;
    const key = turnKey(e.sessionId, e.turnUuid);
    const signals = on.get(key) ?? new Set<FeedbackSignal>();
    if (e.undo) signals.delete(e.signal);
    else signals.add(e.signal);
    on.set(key, signals);
  }
  const out: Record<string, FeedbackSignal[]> = {};
  for (const [key, signals] of on) if (signals.size) out[key] = FEEDBACK_SIGNALS.filter((s) => signals.has(s));
  return out;
}

/** Whether a turn's signal is pressed now, in what's pressed (`feedbackPressed`, or the browser's copy of it). */
export const isPressed = (pressed: Readonly<Record<string, readonly FeedbackSignal[]>>, sessionId: string | undefined, turnUuid: string | undefined, signal: FeedbackSignal): boolean =>
  !!sessionId && !!turnUuid && (pressed[turnKey(sessionId, turnUuid)]?.includes(signal) ?? false);

/** The chief of staff's verdict on a turn, from the ledger: its line's number and route, the latest if it judged it twice. */
export function verdictOn(ledger: readonly LedgerEvent[], sessionId: string, turnUuid: string): { seq: number; route: VerdictRoute } | undefined {
  for (let i = ledger.length - 1; i >= 0; i--) {
    const e = ledger[i];
    if (e.kind === 'cos-verdict' && e.sessionId === sessionId && e.turnUuid === turnUuid) return { seq: e.seq, route: e.route };
  }
  return undefined;
}

/** What a press does: a line to write (pressing it, or taking it back), or why it's refused. */
export type FeedbackStep = { kind: 'record'; line: FeedbackLine } | { kind: 'refuse'; why: string };

/**
 * What a press does. `lead` is who it's about, as Focus has them now (none: not a goal's lead aboard); `turnKnown`
 * whether the turn is one of their session's (a verdict names it, or their transcript has the line). A turn whose
 * signal is pressed is taken back (`undo`), else pressed, with the verdict's line and route when it was judged.
 */
export function feedbackStep(
  press: FeedbackPress,
  lead: { name: string; goal?: string; sessionId?: string } | undefined,
  ledger: readonly LedgerEvent[],
  turnKnown: boolean,
): FeedbackStep {
  if (!lead) return { kind: 'refuse', why: 'That goal isn’t aboard' };
  if (!lead.sessionId) return { kind: 'refuse', why: `${lead.name} has no conversation yet` };
  const verdict = verdictOn(ledger, lead.sessionId, press.turnUuid);
  if (!verdict && !turnKnown) return { kind: 'refuse', why: `That isn’t one of ${lead.name}’s turns` };
  const undo = isPressed(feedbackPressed(ledger), lead.sessionId, press.turnUuid, press.signal);
  return {
    kind: 'record',
    line: {
      kind: 'captain-feedback', signal: press.signal, agent: lead.name, ...(lead.goal && { goal: lead.goal }), sessionId: lead.sessionId, turnUuid: press.turnUuid,
      ...(verdict && { verdictSeq: verdict.seq, route: verdict.route }), via: press.via, ...(undo && { undo: true as const }),
    },
  };
}

/** What's pressed as the browser has it (`CosLive.feedback` in the plugin's state): only turns with known signals. */
export function pressedOf(kept: unknown): Record<string, FeedbackSignal[]> {
  const feedback = isRecord(kept) ? kept.feedback : undefined;
  if (!isRecord(feedback)) return {};
  const out: Record<string, FeedbackSignal[]> = {};
  for (const [key, v] of Object.entries(feedback)) {
    const signals = Array.isArray(v) ? FEEDBACK_SIGNALS.filter((s) => v.includes(s)) : [];
    if (signals.length) out[key] = signals;
  }
  return out;
}

/** One of a turn's feedback buttons: its signal, its words, whether it's pressed, and what pressing it sends. */
export interface FeedbackButton {
  signal: FeedbackSignal;
  label: string;
  pressed: boolean;
  press: FeedbackPress;
}

/**
 * The feedback buttons on a lead's turn, `signals` of them in that order: none for a turn that isn't named (`turnUuid`:
 * a read from before reads named their turn, or a message the transcript didn't place), since a press must say which.
 */
export function feedbackButtons(
  lead: { id: string; sessionId?: string },
  turnUuid: string | undefined,
  pressed: Readonly<Record<string, readonly FeedbackSignal[]>>,
  via: FeedbackVia,
  signals: readonly FeedbackSignal[] = FEEDBACK_SIGNALS,
): FeedbackButton[] {
  if (!turnUuid) return [];
  return signals.map((signal) => ({
    signal, label: FEEDBACK_SAID[signal], pressed: isPressed(pressed, lead.sessionId, turnUuid, signal), press: { agentId: lead.id, turnUuid, signal, via },
  }));
}
