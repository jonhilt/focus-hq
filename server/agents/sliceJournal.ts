import { assign, setup, type StateValue, transition } from 'xstate';
import type { LeadPr } from '../../shared/types';

// A goal's slices, as the lead's slice journal tells them, pure: the facts the office records as a slice ships, lands
// and moves on to fresh code (data/runs/slices/<lead>.jsonl), what they add up to, and what the office does with them
// after a restart. Each fact is on disk before the office acts on it, and what they add up to is a state machine's
// (`sliceMachine`): each fact an event, the slice's phase its state. A ship and a move both happen on GitHub and on
// disk, where a crash can cut them off part way: the journal says how far they got, and both are safe to do again.

/** A slice's move to fresh code, as decided before anything moves: enough to finish it from. */
export interface Moving {
  /** The slice it moves on to, and its branch. */
  slice: number;
  branch: string;
  /** The branch the slice that landed was on. */
  from: string;
  /** Each repo's checkout, which goes. */
  repos: { repo: string; folder: string }[];
  /** The commits that never shipped, by repo, to bring over onto the new branch. */
  carry: { repo: string; commits: string[] }[];
}

/** One fact about a goal's slices. */
export type SliceFact =
  /** The goal's first slice, on `branch`. */
  | { kind: 'started'; slice: number; branch: string }
  /** The lead shipped (`title`, `summary`): written before anything's pushed, so a restart finishes it. */
  | { kind: 'shipping'; title: string; summary: string }
  /** A repo's pull request for the slice is open (or updated) at `sha`. */
  | { kind: 'pr'; repo: string; number: number; url: string; sha: string; branch: string }
  /** The ship's done: its pull requests are open, and with QA. */
  | { kind: 'shipped' }
  /** The ship ended without shipping (nothing new, uncommitted changes, an error). */
  | { kind: 'ship-ended'; error?: string }
  /** One of the slice's pull requests merged or closed. */
  | { kind: 'landed'; repo: string; number: number; merged: boolean }
  /** The slice landed and its repos move on to fresh code: written before any checkout goes. */
  | ({ kind: 'moving' } & Moving)
  /** Every repo's on the new branch, with what never shipped brought over. */
  | { kind: 'moved' };

/** A slice's pull request, as the journal tells it. */
export type SlicePr = Pick<LeadPr, 'repo' | 'number' | 'url' | 'sha' | 'branch' | 'outcome'>;

export interface SliceContext {
  slice: number;
  branch?: string;
  /** The slice's pull requests. */
  prs: SlicePr[];
  /** The ship under way. */
  ship?: { title: string; summary: string };
  /** The move under way. */
  moving?: Moving;
}

export interface SliceState extends SliceContext {
  phase: StateValue;
  seq: number;
}

const START: SliceContext = { slice: 0, prs: [] };
export const EMPTY_SLICE: SliceState = { ...START, phase: 'working', seq: 0 };

type SliceEvent = { [K in SliceFact['kind']]: Extract<SliceFact, { kind: K }> & { type: K } }[SliceFact['kind']];

const same = (p: { repo: string; number: number }, q: { repo: string; number: number }) => p.repo === q.repo && p.number === q.number;

/** The slice's pull requests with one that landed marked. */
const marked = ({ context, event }: { context: SliceContext; event: Extract<SliceEvent, { type: 'landed' }> }) => ({
  prs: context.prs.map((p) => (same(p, event) ? { ...p, outcome: event.merged ? ('merged' as const) : ('closed' as const) } : p)),
});

/**
 * What a lead's slice journal adds up to, as a state machine. A slice is `working` until the lead ships it, `shipping`
 * while the office pushes and opens its pull requests, then `in-review` until every one has `landed` (merged or closed),
 * when it's `moving` on to fresh code, and `working` on the next slice once it's `moved`. A ship that ships nothing goes
 * back to where it was; shipping again from review updates the pull requests.
 */
export const sliceMachine = setup({
  types: {
    context: START,
    events: {} as SliceEvent,
  },
  guards: {
    'pull requests open': ({ context }) => context.prs.length > 0,
    'every one landed': ({ context, event }) => context.prs.length > 0 && context.prs.every((p) => p.outcome || ('repo' in event && 'number' in event && same(p, event))),
  },
}).createMachine({
  id: 'slice',
  context: START,
  initial: 'working',
  on: {
    started: { target: '.working', actions: assign(({ event }) => ({ slice: event.slice, branch: event.branch, prs: [], ship: undefined, moving: undefined })) },
    // a pull request can land in any phase (the captain merges while the lead ships the rest)
    landed: { actions: assign(marked) },
    // the office moves on once every pull request it knows of has landed: from a journal that started before slices had one too
    moving: { target: '.moving', actions: assign(({ event: { type: _, kind: __, ...moving } }) => ({ moving })) },
  },
  states: {
    working: { on: { shipping: { target: 'shipping', actions: assign(({ event }) => ({ ship: { title: event.title, summary: event.summary } })) } } },
    shipping: {
      on: {
        pr: { actions: assign(({ context, event: { type: _, kind: __, ...pr } }) => ({ prs: [...context.prs.filter((p) => !same(p, pr)), pr] })) },
        // every one landed while the ship was under way (the captain merged as it pushed): the slice has landed
        shipped: [{ guard: 'every one landed', target: 'landed', actions: assign({ ship: undefined }) }, { target: 'in-review', actions: assign({ ship: undefined }) }],
        'ship-ended': [
          { guard: 'every one landed', target: 'landed', actions: assign({ ship: undefined }) },
          { guard: 'pull requests open', target: 'in-review', actions: assign({ ship: undefined }) },
          { target: 'working', actions: assign({ ship: undefined }) },
        ],
      },
    },
    'in-review': {
      on: {
        shipping: { target: 'shipping', actions: assign(({ event }) => ({ ship: { title: event.title, summary: event.summary } })) },
        landed: [{ guard: 'every one landed', target: 'landed', actions: assign(marked) }, { actions: assign(marked) }],
      },
    },
    landed: {},
    moving: {
      on: {
        moved: { target: 'working', actions: assign(({ context }) => ({ slice: context.moving?.slice ?? context.slice + 1, branch: context.moving?.branch, prs: [], moving: undefined })) },
      },
    },
  },
});

/** The slices after one more fact. */
export function evolveSlice(state: SliceState, entry: SliceFact & { seq?: number }): SliceState {
  const { phase, seq, ...context } = state;
  const [next] = transition(sliceMachine, sliceMachine.resolveState({ value: phase, context }), { ...entry, type: entry.kind } as SliceEvent);
  return { ...next.context, phase: next.value, seq: entry.seq ?? seq + 1 };
}

/** The slices their journal tells, from the start. */
export function foldSlice(entries: readonly (SliceFact & { seq?: number })[]): SliceState {
  return entries.reduce(evolveSlice, EMPTY_SLICE);
}

/** What the office does at startup with a slice its journal says was part way through something. */
export type SliceRecovery =
  | { kind: 'none' }
  /** A ship was cut off: the office ships it again (pushing, finding or opening each pull request, asking QA), no Claude turn needed. */
  | { kind: 'ship'; title: string; summary: string }
  /** A move to fresh code was cut off: the office finishes it from what was decided. */
  | { kind: 'move'; moving: Moving };

export function sliceRecovery(state: SliceState): SliceRecovery {
  if (state.phase === 'shipping' && state.ship) return { kind: 'ship', ...state.ship };
  if (state.phase === 'moving' && state.moving) return { kind: 'move', moving: state.moving };
  return { kind: 'none' };
}

/**
 * The lead's pull requests as the journal has them: any the saved state lost (a crash before it was saved) put back, and
 * any that landed marked, so the office keeps watching every one of them. Ones the journal doesn't know are left as they are.
 */
export function reconciledPrs(lead: LeadPr[], journal: SlicePr[]): LeadPr[] {
  const known = lead.map((p) => {
    const told = journal.find((j) => same(j, p));
    return told?.outcome && !p.outcome ? { ...p, outcome: told.outcome } : p;
  });
  return [...known, ...journal.filter((j) => !lead.some((p) => same(p, j)))];
}
