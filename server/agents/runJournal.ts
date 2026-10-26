import { assign, setup, type StateValue, transition } from 'xstate';
import type { ReplayStep, RunView } from '../../shared/types';
import type { Target } from './runMachine';

// An agent's run journal, pure: the facts Ops records about a run (data/runs/<agent>.jsonl) and what they add up
// to; what Ops does with them after a restart is runJournalRules.ts's. The journal is the truth for the run's turns
// and its inbox: each fact is on disk before Ops acts on it (`Store.journal`), so a crash loses nothing it had decided. What
// the facts add up to is a state machine's (`journalMachine`): each fact an event, the run's phase its state, so a run
// is rebuilt by replaying its journal through it (`fold`).

/**
 * Where a message waits in the inbox: heard next (`end`, or `front` before the rest), or once the turn in hand ends
 * (`later`). A `note` is news for a goal's lead (QA's verdict, a slice landing): it waits for the next message they hear,
 * whoever's, and goes with it, but never starts a turn or carries one on by itself.
 */
export type QueuedAt = 'end' | 'front' | 'later' | 'note';

/** What a turn was for: the agent's work, or Ops compacting their conversation. */
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
  /** The notes waiting went into turn `turn`'s session, which was listening, ahead of a message (`sent`, next). */
  | { kind: 'notes-sent'; turn: string }
  /** The captain stopped turn `turn`: it's not one to pick back up after a restart. */
  | { kind: 'stop-requested'; turn: string }
  /** The agent was sent home: a new run starts from nothing (an id comes back for a reopened goal, QA's next review). */
  | { kind: 'reset' }
  /** Found at startup: messages taken for a turn that was never requested go back in the inbox, first. */
  | { kind: 'restored' }
  /** Every message waiting was dropped, unheard. */
  | { kind: 'cleared' }
  /** Ops is about to start a turn: written before Claude Code starts, so a crash finds it. */
  | { kind: 'turn-requested'; turn: string; turnKind: TurnKind; prompt: string; resumes?: string }
  /** How Ops signed the turn's session in: your API key, or your plan's login. */
  | { kind: 'signed-in'; turn: string; onKey: boolean }
  /** Claude Code has the turn: its session, and where it says its credential came from (`apiKeySource`). */
  | { kind: 'turn-started'; turn: string; session: string; keySource?: string }
  | { kind: 'turn-ended'; turn: string; outcome: TurnEnding }
  /** Claude Code signed in some other way than Ops meant, at a cost: the turn is stopped. */
  | { kind: 'sign-in-mismatch'; turn: string; observed: string }
  /** Found at startup: a turn Ops started and never saw end. */
  | { kind: 'interrupted'; turn: string }
  /** Waiting for a free slot to start (or pick their conversation back up). */
  | { kind: 'waiting' }
  /** Setting up to work: a checkout, its dependencies, the task. */
  | { kind: 'setting-up' }
  /**
   * What follows turn `turn`, as the run's machine took it (`runMachine`): when that's delivering its work, with its pull
   * request's description, so a restart before the delivery's journaled still delivers it.
   */
  | { kind: 'decided'; turn: string; target: Target; summary?: string }
  /** Turn `turn`'s work is going onto GitHub, its pull request's description `summary`: written first, so a restart finishes it. */
  | { kind: 'delivering'; turn: string; summary: string }
  /** Turn `turn`'s branch is on GitHub (pushed, or a cloud session's found there). */
  | { kind: 'pushed'; turn: string }
  /** Turn `turn`'s work is delivered: its pull request open (or updated), or there was nothing to deliver. */
  | { kind: 'delivered'; turn: string; outcome: Delivered; pr?: number }
  /** Turn `turn`'s work couldn't be delivered. */
  | { kind: 'delivery-failed'; turn: string; error: string }
  /** The agent raised their hand in turn `turn`: approval for `summary` (a `tool` call). */
  | { kind: 'asked'; turn: string; tool: string; summary: string }
  /** The captain answered (or the turn ended first, `dropped`). */
  | { kind: 'answered'; turn: string; allow: boolean; dropped?: boolean }
  /** On hold until `until`, when your plan's usage limit resets: what's in their inbox waits for then. */
  | { kind: 'held'; until: number }
  /** Off hold: the limit reset, the captain sent a message, or stopped them. */
  | { kind: 'unheld' };

/** How a delivery ended: a pull request, or nothing to put in one (no commits, or a fix that fixed nothing). */
export type Delivered = 'pr' | 'no-commits' | 'nothing-fixed';

/** A turn's work going onto GitHub, as the journal tells it. */
export interface Delivery {
  turn: string;
  /** Its pull request's description. */
  summary: string;
  pr?: number;
  outcome?: Delivered;
  error?: string;
}

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

/** What an agent's journal adds up to, besides its phase: the machine's context. */
export interface JournalContext {
  /** Messages for the agent's next turn, in order. */
  inbox: string[];
  /** Messages waiting for the turn in hand to end. */
  later: string[];
  /** Notes for the next message the lead hears, whoever's: they go ahead of it, and never wake the lead by themselves. */
  notes: string[];
  /** Messages taken for a turn's prompt, until that turn is requested. */
  owed: string[];
  /** The turn Ops started and hasn't seen end. */
  open?: JournalTurn;
  /** The last turn that ended, how, and what followed it (`target`, once decided). */
  last?: JournalTurn & { outcome: TurnEnding; target?: Target; summary?: string };
  /** The latest session Claude Code reported. */
  session?: string;
  /** How many turns of work the run has asked for. */
  turns: number;
  /** The latest turn's work going onto GitHub. */
  delivery?: Delivery;
  /** The approval the turn in hand is waiting for. */
  asking?: { tool: string; summary: string };
  /** When the hold for your plan's usage limit ends. */
  heldUntil?: number;
}

/** What an agent's journal adds up to: the run's phase (the machine's state), what it holds, and the last fact's number. */
export interface RunState extends JournalContext {
  phase: StateValue;
  seq: number;
}

const START: JournalContext = { inbox: [], later: [], notes: [], owed: [], turns: 0 };
export const EMPTY_RUN: RunState = { ...START, phase: 'idle', seq: 0 };

/** A fact as the machine's event: its kind is its type. */
type JournalEvent = { [K in RunFact['kind']]: Extract<RunFact, { kind: K }> & { type: K } }[RunFact['kind']];

/** The inbox with a message queued `at` where it waits. */
function queuedAt(context: JournalContext, at: QueuedAt, text: string): Partial<JournalContext> {
  switch (at) {
    case 'later':
      return { later: [...context.later, text] };
    case 'note':
      return { notes: [...context.notes, text] };
    case 'front':
      return { inbox: [text, ...context.inbox] };
    case 'end':
      return { inbox: [...context.inbox, text] };
  }
}

/**
 * The notes once the open turn's over: a turn the captain stopped may never have read what went into its session, so
 * that goes with the next message they hear, as a note (it doesn't start a turn), in case. A restart picks a turn it cut
 * off back up with them for the same reason (`resumedNote`), so a stop loses no more than a restart does.
 */
function unheardAfterStop(context: JournalContext): string[] {
  const sent = context.open?.stopped ? (context.open.sent ?? []) : [];
  return sent.length ? [...context.notes, stoppedNote(sent)] : context.notes;
}

/** What an agent hears, with their next message, of what went into a turn the captain stopped. */
export function stoppedNote(sent: readonly string[]): string {
  return `[Ops] These messages were sent to you during the turn the captain stopped, in case they didn't reach you before it was stopped:\n\n${sent.join('\n\n')}`;
}

/** The open turn, changed. */
const onOpen = (context: JournalContext, f: (t: JournalTurn) => JournalTurn): Partial<JournalContext> => (context.open ? { open: f(context.open) } : {});

/**
 * What a run's journal adds up to, as a state machine: each fact is an event, and the run's phase is its state. A run
 * is `idle`, `waiting` for a free slot, `setting-up`, in a `turn` (`requested` until Claude Code has it, `started`, or
 * `stopping` once the captain or a sign-in mismatch stopped it), `ended` (with what followed, once `decided`), or
 * `interrupted` (found at startup). The inbox's facts change what it holds in any phase. Facts about a turn that isn't
 * the open one change nothing. Pure: `evolve` takes one fact with XState's `transition`, and nothing runs.
 */
export const journalMachine = setup({
  types: {
    context: {} as JournalContext,
    events: {} as JournalEvent,
  },
  guards: {
    'this turn': ({ context, event }) => 'turn' in event && event.turn !== undefined && event.turn === context.open?.id,
    'the last turn': ({ context, event }) => 'turn' in event && event.turn === context.last?.id,
    'this delivery': ({ context, event }) => 'turn' in event && event.turn === context.delivery?.turn,
  },
}).createMachine({
  id: 'journal',
  context: START,
  initial: 'idle',
  on: {
    queued: { actions: assign(({ context, event }) => queuedAt(context, event.at, event.text)) },
    released: { actions: assign(({ context }) => ({ inbox: [...context.inbox, ...context.later], later: [] })) },
    // the notes go with what's taken, ahead of it
    taken: [
      // into the session of the turn in hand: heard in it
      { guard: 'this turn', actions: assign(({ context }) => ({ ...onOpen(context, (t) => ({ ...t, sent: [...(t.sent ?? []), ...context.notes, ...context.inbox] })), inbox: [], notes: [] })) },
      // into a prompt: owed until its turn is asked for
      { actions: assign(({ context, event }) => ({ inbox: [], notes: [], owed: event.turn ? context.owed : [...context.owed, ...context.notes, ...context.inbox] })) },
    ],
    sent: { guard: 'this turn', actions: assign(({ context, event }) => onOpen(context, (t) => ({ ...t, sent: [...(t.sent ?? []), event.text] }))) },
    'notes-sent': { guard: 'this turn', actions: assign(({ context }) => ({ ...onOpen(context, (t) => ({ ...t, sent: [...(t.sent ?? []), ...context.notes] })), notes: [] })) },
    restored: { actions: assign(({ context }) => ({ inbox: [...context.owed, ...context.inbox], owed: [] })) },
    cleared: { actions: assign({ inbox: [], later: [], notes: [], owed: [] }) },
    reset: { target: '.idle', actions: assign(() => ({ ...START, open: undefined, last: undefined, session: undefined, delivery: undefined, asking: undefined, heldUntil: undefined })) },
    held: { target: '.held', actions: assign(({ event }) => ({ heldUntil: event.until })) },
    // the last turn's work, onto GitHub (a cloud agent's nudge to push may have come between)
    delivering: { guard: 'the last turn', target: '.delivering', actions: assign(({ event }) => ({ delivery: { turn: event.turn, summary: event.summary } })) },
    waiting: '.waiting',
    'setting-up': '.setting-up',
    'turn-requested': {
      target: '.turn',
      actions: assign(({ context, event }) => ({
        asking: undefined,
        owed: event.turnKind === 'work' ? [] : context.owed,
        turns: context.turns + (event.turnKind === 'work' ? 1 : 0),
        open: { id: event.turn, kind: event.turnKind, prompt: event.prompt, resumes: event.resumes },
      })),
    },
  },
  states: {
    idle: {},
    waiting: {},
    'setting-up': {},
    turn: {
      initial: 'requested',
      on: {
        'signed-in': { guard: 'this turn', actions: assign(({ context, event }) => onOpen(context, (t) => ({ ...t, onKey: event.onKey }))) },
        'turn-started': {
          guard: 'this turn',
          target: '.started',
          actions: assign(({ context, event }) => ({ ...onOpen(context, (t) => ({ ...t, session: event.session, keySource: event.keySource })), session: event.session })),
        },
        'stop-requested': { guard: 'this turn', target: '.stopping', actions: assign(({ context }) => onOpen(context, (t) => ({ ...t, stopped: true }))) },
        'sign-in-mismatch': { guard: 'this turn', target: '.stopping', actions: assign(({ context, event }) => onOpen(context, (t) => ({ ...t, mismatch: event.observed }))) },
        'turn-ended': {
          guard: 'this turn',
          target: 'ended',
          actions: assign(({ context, event }) => ({ open: undefined, asking: undefined, last: context.open && { ...context.open, outcome: event.outcome }, notes: unheardAfterStop(context) })),
        },
        interrupted: {
          guard: 'this turn',
          target: 'interrupted',
          actions: assign(({ context }) => ({ open: undefined, last: context.open && { ...context.open, outcome: { ok: false, error: INTERRUPTED_ERROR } }, notes: unheardAfterStop(context) })),
        },
      },
      states: {
        requested: {},
        started: {
          on: { asked: { guard: 'this turn', target: 'asking', actions: assign(({ event }) => ({ asking: { tool: event.tool, summary: event.summary } })) } },
        },
        // the hand's up: the captain's answer (or the turn's end) puts it down
        asking: {
          on: { answered: { guard: 'this turn', target: 'started', actions: assign({ asking: undefined }) } },
        },
        // a stop doesn't undo itself when Claude Code says more
        stopping: { on: { 'turn-started': { guard: 'this turn', actions: assign(({ context, event }) => onOpen(context, (t) => ({ ...t, session: event.session, keySource: event.keySource }))) } } },
      },
    },
    ended: {
      on: {
        decided: { guard: 'the last turn', actions: assign(({ context, event }) => ({ last: context.last && { ...context.last, target: event.target, ...(event.summary !== undefined && { summary: event.summary }) } })) },
        // its delivery failed before it was journaled (looking for what they left, say): it's over
        'delivery-failed': { guard: 'the last turn', target: 'failed', actions: assign(({ context, event }) => ({ delivery: { turn: event.turn, summary: context.last?.summary ?? '', error: event.error } })) },
      },
    },
    interrupted: {},
    delivering: {
      initial: 'pushing',
      on: {
        delivered: { guard: 'this delivery', target: 'delivered', actions: assign(({ context, event }) => ({ delivery: context.delivery && { ...context.delivery, outcome: event.outcome, pr: event.pr } })) },
        'delivery-failed': { guard: 'this delivery', target: 'failed', actions: assign(({ context, event }) => ({ delivery: context.delivery && { ...context.delivery, error: event.error } })) },
      },
      states: {
        pushing: { on: { pushed: { guard: 'this delivery', target: 'opening' } } },
        opening: {},
      },
    },
    delivered: {},
    failed: {},
    held: {
      on: { unheld: { target: 'idle', actions: assign({ heldUntil: undefined }) } },
    },
  },
});

/** The run after one more fact. */
export function evolve(state: RunState, entry: RunFact & { seq?: number }): RunState {
  const { phase, seq, ...context } = state;
  const [next] = transition(journalMachine, journalMachine.resolveState({ value: phase, context }), { ...entry, type: entry.kind } as JournalEvent);
  return { ...next.context, phase: next.value, seq: entry.seq ?? seq + 1 };
}

/** A machine's state as a dotted path: `turn.started`. */
function dotted(value: StateValue): string {
  if (typeof value === 'string') return value;
  return Object.entries(value).map(([k, v]) => (v ? `${k}.${dotted(v)}` : k)).join(',');
}

/** Where the run is, for the agent's panel. */
export function runView(state: RunState): RunView {
  return {
    phase: dotted(state.phase),
    turns: state.turns,
    seq: state.seq,
    ...(state.last?.target && !state.open && { target: state.last.target }),
    ...(state.delivery?.pr && { pr: state.delivery.pr }),
  };
}

/** The run its journal tells, from the start. */
export function fold(entries: readonly (RunFact & { seq?: number })[]): RunState {
  return entries.reduce(evolve, EMPTY_RUN);
}

export const INTERRUPTED_ERROR = 'Focus shut down during this turn';

/** What the agent is told when its turn stopped for signing in with the key. */
export function mismatchError(observed: string): string {
  const how = observed === 'apiKeyHelper' ? 'an apiKeyHelper' : 'ANTHROPIC_API_KEY';
  return `Claude Code signed in with ${how} when Ops meant your plan's login, so the turn was stopped before it spent anything more. Look for an env or apiKeyHelper in ~/.claude/settings.json (or the project's .claude/settings.json).`;
}

export const RESUMED_NOTE =
  'Focus restarted while you were working, so your last turn was cut off part way. Check where you got to (git status, the files you were editing, anything you had running) and carry on from there.';

/** What a turn Claude Code had is told as it carries on: and the messages sent into it, in case they never arrived. */
export function resumedNote(sent: string[]): string {
  if (!sent.length) return RESUMED_NOTE;
  return `${RESUMED_NOTE}\n\nThese messages were sent to you during that turn, in case they didn't reach you before it was cut off:\n\n${sent.join('\n\n')}`;
}

export const INTERRUPTED_ACTIVITY = 'Interrupted when Focus shut down. Send a message to pick it back up.';

/** A journal entry as its line in the file. */
export function journalLine(entry: { v: 1; seq: number; t: number }): string {
  return `${JSON.stringify(entry)}\n`;
}

/**
 * A journal file read back: its entries in order, and how many bytes of it are whole lines. A last line cut short
 * (Focus stopped part way through writing it) is left out, to be dropped; so is any line that doesn't parse.
 */
export function readJournal<E = JournalEntry>(text: string): { entries: E[]; goodBytes: number } {
  const entries: E[] = [];
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
      entries.push(JSON.parse(line) as E);
    } catch {
      // a damaged line tells nothing; the rest still do
    }
  }
  return { entries, goodBytes };
}

/** A line of text cut to `n` characters, on one line. */
const brief = (text: string, n = 120): string => {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > n ? `${line.slice(0, n - 1)}…` : line;
};

/** How a turn ended, in words. */
const ending = (o: TurnEnding): string =>
  o.ok ? 'Turn ended' : o.limited ? "Turn stopped by your plan's usage limit" : o.aborted ? 'Turn stopped' : `Turn failed: ${brief(o.error ?? 'no reason given')}`;

/** Each fact, in words, for a replay. */
const FACT_LINES: { [K in RunFact['kind']]: (fact: Extract<RunFact, { kind: K }>) => string } = {
  queued: (f) => (f.at === 'note' ? `Note for them, heard with their next message: ${brief(f.text)}` : `Message for them${f.at === 'later' ? ', once the turn ends' : f.at === 'front' ? ', first' : ''}: ${brief(f.text)}`),
  released: () => 'What waited for the turn to end joins the inbox',
  taken: (f) => (f.turn ? 'Messages sent into the turn' : 'Messages taken into the next prompt'),
  sent: (f) => `Sent into the turn: ${brief(f.text)}`,
  'notes-sent': () => 'Notes sent into the turn, ahead of a message',
  'stop-requested': () => 'The captain stopped the turn',
  reset: () => 'Sent home: a new run starts from nothing',
  restored: () => 'Messages put back in the inbox after a restart',
  cleared: () => 'Messages dropped, unheard',
  'turn-requested': (f) => `${f.turnKind === 'compact' ? 'Compaction' : 'Turn'} asked for, ${f.resumes ? 'in the same conversation' : 'in a new conversation'}: ${brief(f.prompt)}`,
  'signed-in': (f) => `Signs in with ${f.onKey ? 'your API key' : 'your plan'}`,
  'turn-started': (f) => `Claude Code has it: session ${f.session.slice(0, 8)}${f.keySource ? `, credential from ${f.keySource}` : ''}`,
  'turn-ended': (f) => ending(f.outcome),
  'sign-in-mismatch': (f) => `Claude Code signed in with ${f.observed} when Ops meant your plan: stopped`,
  interrupted: () => 'Found cut off when Focus started again',
  waiting: () => 'Waiting for a free slot',
  'setting-up': () => 'Setting up',
  decided: (f) => `What follows: ${f.target}`,
  delivering: () => 'Putting the work on GitHub',
  pushed: () => 'The branch is on GitHub',
  delivered: (f) => (f.pr ? `Pull request #${f.pr} ready` : f.outcome === 'nothing-fixed' ? 'Nothing to deliver: the fix changed nothing' : 'Nothing to deliver: no commits'),
  'delivery-failed': (f) => `Couldn't put the work on GitHub: ${brief(f.error)}`,
  asked: (f) => `Hand up: approval for ${brief(f.summary)}`,
  answered: (f) => (f.dropped ? 'Hand down: the turn ended first' : f.allow ? 'The captain approved' : 'The captain declined'),
  held: () => "On hold until your plan's usage limit resets",
  unheld: () => 'Off hold',
};

/** A fact, in words. */
export function factLine(fact: RunFact): string {
  return (FACT_LINES[fact.kind] as (f: RunFact) => string)(fact);
}

/** A run's journal replayed: each fact in words, and where the run was after it (folded through `journalMachine`). */
export function replay(entries: readonly JournalEntry[]): ReplayStep[] {
  let state = EMPTY_RUN;
  return entries.map((entry) => {
    state = evolve(state, entry);
    return { seq: entry.seq, t: entry.t, kind: entry.kind, fact: factLine(entry), run: runView(state) };
  });
}
