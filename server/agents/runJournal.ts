// An agent's run journal, pure: the facts the office records about a run (data/runs/<agent>.jsonl), what they add up
// to, and what the office does with them after a restart. The journal is the truth for the run's turns and its inbox:
// each fact is on disk before the office acts on it (`Store.journal`), so a crash loses nothing it had decided.

/** Where a message waits in the inbox: heard next (`end`, or `front` before the rest), or once the turn in hand ends (`later`). */
export type QueuedAt = 'end' | 'front' | 'later';

/** What a turn was for: the agent's work, or the office compacting their conversation. */
export type TurnKind = 'work' | 'compact';

/** How a turn ended, as much of `RunOutcome` as decides what follows. */
export interface TurnEnding {
  ok: boolean;
  error?: string;
  aborted?: boolean;
  started?: boolean;
  limited?: boolean;
}

/** How a turn ended, for the journal: no summary or structured answer (that's in Claude Code's transcript). */
export function turnEnding({ ok, error, aborted, started, limited }: TurnEnding): TurnEnding {
  return { ok, ...(error !== undefined && { error }), ...(aborted && { aborted }), ...(started && { started }), ...(limited && { limited }) };
}

/** One fact about an agent's run. */
export type RunFact =
  | { kind: 'queued'; text: string; at: QueuedAt }
  /** The messages waiting for after the turn join the rest. */
  | { kind: 'released' }
  /**
   * Every message waiting was taken: into a session that was listening in turn `turn`, or (without one) into the
   * prompt of a turn about to be requested, so they're still owed until it is.
   */
  | { kind: 'taken'; turn?: string }
  /** A message went straight into turn `turn`'s session, which was listening. */
  | { kind: 'sent'; turn: string; text: string }
  /** The captain stopped turn `turn`: it's not one to pick back up after a restart. */
  | { kind: 'stop-requested'; turn: string }
  /** The agent was sent home: a new run starts from nothing (an id comes back for a reopened goal, QA's next review). */
  | { kind: 'reset' }
  /** Found at startup: messages taken for a turn that was never requested go back in the inbox, first. */
  | { kind: 'restored' }
  /** Every message waiting was dropped, unheard. */
  | { kind: 'cleared' }
  /** The office is about to start a turn: written before Claude Code starts, so a crash finds it. */
  | { kind: 'turn-requested'; turn: string; turnKind: TurnKind; prompt: string; resumes?: string }
  /** How the office signed the turn's session in: your API key, or your plan's login. */
  | { kind: 'signed-in'; turn: string; onKey: boolean }
  /** Claude Code has the turn: its session, and where it says its credential came from (`apiKeySource`). */
  | { kind: 'turn-started'; turn: string; session: string; keySource?: string }
  | { kind: 'turn-ended'; turn: string; outcome: TurnEnding }
  /** Claude Code signed in some other way than the office meant, at a cost: the turn is stopped. */
  | { kind: 'sign-in-mismatch'; turn: string; observed: string }
  /** Found at startup: a turn the office started and never saw end. */
  | { kind: 'interrupted'; turn: string };

/** A fact as journaled: numbered from 1 in its agent’s journal, and when (`t`). */
export type JournalEntry = RunFact & { v: 1; seq: number; t: number };

/** A turn as the journal tells it. */
export interface JournalTurn {
  id: string;
  kind: TurnKind;
  prompt: string;
  resumes?: string;
  onKey?: boolean;
  /** Claude Code's session for it, once it said so. */
  session?: string;
  keySource?: string;
  mismatch?: string;
  /** Messages that went into its session while it ran. */
  sent?: string[];
  /** The captain stopped it. */
  stopped?: boolean;
}

/** What an agent's journal adds up to. */
export interface RunState {
  /** Messages for the agent's next turn, in order. */
  inbox: string[];
  /** Messages waiting for the turn in hand to end. */
  later: string[];
  /** Messages taken for a turn's prompt, until that turn is requested. */
  owed: string[];
  /** The turn the office started and hasn't seen end. */
  open?: JournalTurn;
  /** The last turn that ended, and how. */
  last?: JournalTurn & { outcome: TurnEnding };
  /** The latest session Claude Code reported. */
  session?: string;
  /** The last fact's number. */
  seq: number;
}

export const EMPTY_RUN: RunState = { inbox: [], later: [], owed: [], seq: 0 };

/** The run after one more fact. */
export function evolve(state: RunState, entry: RunFact & { seq?: number }): RunState {
  const s = { ...state, seq: entry.seq ?? state.seq + 1 };
  switch (entry.kind) {
    case 'queued':
      if (entry.at === 'later') return { ...s, later: [...s.later, entry.text] };
      return { ...s, inbox: entry.at === 'front' ? [entry.text, ...s.inbox] : [...s.inbox, entry.text] };
    case 'released':
      return { ...s, inbox: [...s.inbox, ...s.later], later: [] };
    case 'taken':
      if (!entry.turn) return { ...s, inbox: [], owed: [...s.owed, ...s.inbox] };
      return { ...withOpen(s, entry.turn, (t) => ({ ...t, sent: [...(t.sent ?? []), ...s.inbox] })), inbox: [] };
    case 'sent':
      return withOpen(s, entry.turn, (t) => ({ ...t, sent: [...(t.sent ?? []), entry.text] }));
    case 'restored':
      return { ...s, inbox: [...s.owed, ...s.inbox], owed: [] };
    case 'cleared':
      return { ...s, inbox: [], later: [], owed: [] };
    case 'stop-requested':
      return withOpen(s, entry.turn, (t) => ({ ...t, stopped: true }));
    case 'reset':
      return { ...EMPTY_RUN, seq: s.seq };
    case 'turn-requested':
      return { ...s, owed: entry.turnKind === 'work' ? [] : s.owed, open: { id: entry.turn, kind: entry.turnKind, prompt: entry.prompt, resumes: entry.resumes } };
    case 'signed-in':
      return withOpen(s, entry.turn, (t) => ({ ...t, onKey: entry.onKey }));
    case 'turn-started':
      return { ...withOpen(s, entry.turn, (t) => ({ ...t, session: entry.session, keySource: entry.keySource })), session: entry.session };
    case 'sign-in-mismatch':
      return withOpen(s, entry.turn, (t) => ({ ...t, mismatch: entry.observed }));
    case 'turn-ended':
      if (s.open?.id !== entry.turn) return s;
      return { ...s, open: undefined, last: { ...s.open, outcome: entry.outcome } };
    case 'interrupted':
      if (s.open?.id !== entry.turn) return s;
      return { ...s, open: undefined, last: { ...s.open, outcome: { ok: false, error: INTERRUPTED_ERROR } } };
  }
}

function withOpen(s: RunState, turn: string, f: (t: JournalTurn) => JournalTurn): RunState {
  return s.open?.id === turn ? { ...s, open: f(s.open) } : s;
}

/** The run its journal tells, from the start. */
export function fold(entries: readonly (RunFact & { seq?: number })[]): RunState {
  return entries.reduce(evolve, EMPTY_RUN);
}

export const INTERRUPTED_ERROR = 'Focus shut down during this turn';

/**
 * Claude Code signed a turn in with a key that costs when the office meant your plan's login: an `env` or
 * `apiKeyHelper` in Claude Code's own settings can do that behind the office's back. The other way round (the office
 * meant the key, Claude Code used the login) costs nothing, so it isn't one.
 */
export function signInMismatch(onKey: boolean | undefined, keySource: string | undefined): boolean {
  return onKey === false && (keySource === 'ANTHROPIC_API_KEY' || keySource === 'apiKeyHelper');
}

/** What the agent is told when its turn stopped for signing in with the key. */
export function mismatchError(observed: string): string {
  const how = observed === 'apiKeyHelper' ? 'an apiKeyHelper' : 'ANTHROPIC_API_KEY';
  return `Claude Code signed in with ${how} when the office meant your plan's login, so the turn was stopped before it spent anything more. Look for an env or apiKeyHelper in ~/.claude/settings.json (or the project's .claude/settings.json).`;
}

/** What the office does at startup with a turn it never saw end. */
export type Recovery =
  /** Nothing was in flight. */
  | { kind: 'none' }
  /** Pick the conversation back up with `prompt` (it goes in front of whatever else is waiting). */
  | { kind: 'resume'; turn: string; prompt: string; session: string }
  /** The turn's gone and the agent waits for the captain: `why` is their activity. */
  | { kind: 'wait'; turn: string; why: string };

/** What about the agent decides whether an interrupted turn carries on by itself. */
export interface RecoveryAgent {
  task: string;
  cloud?: unknown;
}

/** The tasks whose conversation carries on after a restart. QA starts each review afresh. */
const RESUMES: ReadonlySet<string> = new Set(['issue', 'fix', 'conflicts', 'brief', 'lead']);

export const RESUMED_NOTE =
  'Focus restarted while you were working, so your last turn was cut off part way. Check where you got to (git status, the files you were editing, anything you had running) and carry on from there.';

/**
 * What to do with a turn the journal says was in flight when Focus stopped. It carries on in the same conversation
 * when there's one to go back to, on this machine, for work that carries on (not QA's review, or a compaction); and on
 * your plan's login only: on the API key (`onKey`, as the office signs in now) the captain says whether it's worth it.
 * A turn Claude Code had (it reported the session) is told it was interrupted; one it never got is asked again.
 */
export function recovery(state: RunState, agent: RecoveryAgent, onKey: boolean): Recovery {
  const turn = state.open;
  if (!turn) return { kind: 'none' };
  // a turn that went back into no conversation was starting a new one: there's none of its own to carry on
  const session = turn.session ?? turn.resumes;
  if (turn.stopped) return { kind: 'wait', turn: turn.id, why: 'Stopped by the captain just before Focus shut down. Send a message to pick it back up.' };
  if (turn.kind === 'compact') return { kind: 'wait', turn: turn.id, why: 'Focus shut down while compacting the conversation. Send a message to carry on.' };
  if (!RESUMES.has(agent.task) || agent.cloud || !session) return { kind: 'wait', turn: turn.id, why: INTERRUPTED_ACTIVITY };
  if (turn.mismatch) return { kind: 'wait', turn: turn.id, why: 'Stopped for signing in with the API key. Send a message to pick it back up.' };
  if (onKey) return { kind: 'wait', turn: turn.id, why: 'Interrupted when Focus shut down. Picking it back up would be on your API key, so send a message when you want it to.' };
  return { kind: 'resume', turn: turn.id, prompt: turn.session ? resumedNote(turn.sent ?? []) : turn.prompt, session };
}

/** What a turn Claude Code had is told as it carries on: and the messages sent into it, in case they never arrived. */
export function resumedNote(sent: string[]): string {
  if (!sent.length) return RESUMED_NOTE;
  return `${RESUMED_NOTE}\n\nThese messages were sent to you during that turn, in case they didn't reach you before it was cut off:\n\n${sent.join('\n\n')}`;
}

export const INTERRUPTED_ACTIVITY = 'Interrupted when Focus shut down. Send a message to pick it back up.';

/** A journal entry as its line in the file. */
export function journalLine(entry: JournalEntry): string {
  return `${JSON.stringify(entry)}\n`;
}

/**
 * A journal file read back: its entries in order, and how many bytes of it are whole lines. A last line cut short
 * (Focus stopped part way through writing it) is left out, to be dropped; so is any line that doesn't parse.
 */
export function readJournal(text: string): { entries: JournalEntry[]; goodBytes: number } {
  const entries: JournalEntry[] = [];
  let goodBytes = 0;
  let offset = 0;
  const size = Buffer.byteLength(text);
  for (const line of text.split('\n')) {
    const end = offset + Buffer.byteLength(line) + 1;
    offset = end;
    if (end > size) break;
    goodBytes = end;
    if (!line) continue;
    try {
      entries.push(JSON.parse(line) as JournalEntry);
    } catch {
      // a damaged line tells nothing; the rest still do
    }
  }
  return { entries, goodBytes };
}
