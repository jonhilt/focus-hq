import { INTERRUPTED_ACTIVITY, resumedNote, type RunState } from './runJournal';

// What Ops does after a restart with the run an agent's journal tells (runJournal.ts folds it): carry the turn on,
// finish its delivery, hold it again, put it back in line, or wait for the captain; and whether a turn signed in with
// a key Ops didn't mean. Pure, so it's unit tested (runJournalRules.test.ts); manager/sessions.ts does what it says.

/**
 * Claude Code signed a turn in with a key that costs when Ops meant your plan's login: an `env` or
 * `apiKeyHelper` in Claude Code's own settings can do that behind Ops' back. The other way round (Ops
 * meant the key, Claude Code used the login) costs nothing, so it isn't one.
 */
export function signInMismatch(onKey: boolean | undefined, keySource: string | undefined): boolean {
  return onKey === false && (keySource === 'ANTHROPIC_API_KEY' || keySource === 'apiKeyHelper');
}

/** What Ops does at startup with a turn it never saw end. */
export type Recovery =
  /** Nothing was in flight. */
  | { kind: 'none' }
  /** Pick the conversation back up with `prompt` (it goes in front of whatever else is waiting). */
  | { kind: 'resume'; turn: string; prompt: string; session: string }
  /** The turn's gone and the agent waits for the captain: `why` is their activity. */
  | { kind: 'wait'; turn: string; why: string }
  /** Their work was going onto GitHub: Ops finishes it (pushing again, finding or opening the pull request), no Claude turn needed. */
  | { kind: 'deliver'; turn: string; summary: string; unasked?: true }
  /** On hold for your plan's limit: held again till `until`, or picked back up now if that's passed. */
  | { kind: 'hold-again'; until: number }
  /** They were waiting for a free slot: they wait for one again, with what was waiting for them. */
  | { kind: 'requeue' }
  /** They were waiting for a free slot, but going back to their conversation would be on your API key. */
  | { kind: 'hold'; why: string };

/** What about the agent decides whether an interrupted turn carries on by itself. */
export interface RecoveryAgent {
  task: string;
  sessionId?: string;
}

/** The tasks whose conversation carries on after a restart: QA's too, with the review it was at (`reviewRecovery`). */
const RESUMES: ReadonlySet<string> = new Set(['issue', 'fix', 'conflicts', 'brief', 'lead', 'review']);

/**
 * What to do with a turn the journal says was in flight when Focus stopped. It carries on in the same conversation
 * when there's one to go back to, on this machine, for work that carries on (not a compaction); and on
 * your plan's login only: on the API key (`onKey`, as Ops signs in now) the captain says whether it's worth it.
 * A turn Claude Code had (it reported the session) is told it was interrupted; one it never got is asked again.
 */
export function recovery(state: RunState, agent: RecoveryAgent, onKey: boolean): Recovery {
  const turn = state.open;
  const delivering = delivers(state, agent);
  if (delivering) return delivering;
  if (!turn && state.phase === 'held' && state.heldUntil && RESUMES.has(agent.task)) return { kind: 'hold-again', until: state.heldUntil };
  if (!turn) return state.phase === 'waiting' ? requeue(agent, onKey) : { kind: 'none' };
  // a turn that went back into no conversation was starting a new one: there's none of its own to carry on
  const session = turn.session ?? turn.resumes;
  if (turn.stopped) return { kind: 'wait', turn: turn.id, why: 'Stopped by the captain just before Focus shut down. Send a message to pick it back up.' };
  if (turn.kind === 'compact') return { kind: 'wait', turn: turn.id, why: 'Focus shut down while compacting the conversation. Send a message to carry on.' };
  if (!RESUMES.has(agent.task) || !session) return { kind: 'wait', turn: turn.id, why: INTERRUPTED_ACTIVITY };
  if (turn.mismatch) return { kind: 'wait', turn: turn.id, why: 'Stopped for signing in with the API key. Send a message to pick it back up.' };
  if (onKey) return { kind: 'wait', turn: turn.id, why: 'Interrupted when Focus shut down. Picking it back up would be on your API key, so send a message when you want it to.' };
  return { kind: 'resume', turn: turn.id, prompt: turn.session ? resumedNote(turn.sent ?? []) : turn.prompt, session };
}

/** The tasks whose work goes onto GitHub when a turn's done (`Delivery`): not QA's, or a lead's (they ship with a tool). */
const DELIVERS: ReadonlySet<string> = new Set(['issue', 'fix', 'conflicts', 'brief']);

/**
 * Their work was going onto GitHub (`delivering`), or about to: the turn ended and it was decided to deliver it, but
 * Ops hadn't got as far as asking them to commit what they left (`unasked`), so that goes first.
 */
function delivers(state: RunState, agent: RecoveryAgent): Recovery | undefined {
  if (state.open || !DELIVERS.has(agent.task)) return undefined;
  if (state.delivery && inPhase(state, 'delivering')) return { kind: 'deliver', turn: state.delivery.turn, summary: state.delivery.summary };
  const last = state.last;
  if (last?.target === 'deliver' && last.summary !== undefined && inPhase(state, 'ended')) return { kind: 'deliver', turn: last.id, summary: last.summary, unasked: true };
  return undefined;
}

/** The run is in `phase`, or one of its states. */
function inPhase(state: RunState, phase: string): boolean {
  return state.phase === phase || (typeof state.phase === 'object' && phase in state.phase);
}

/** An agent that was waiting for a free slot: in line again, unless that would pick a conversation up on your API key. */
function requeue(agent: RecoveryAgent, onKey: boolean): Recovery {
  if (!RESUMES.has(agent.task)) return { kind: 'none' };
  if (onKey && agent.sessionId) return { kind: 'hold', why: 'Was waiting for a free slot when Focus shut down. Picking their conversation back up would be on your API key, so send a message when you want it to.' };
  return { kind: 'requeue' };
}
