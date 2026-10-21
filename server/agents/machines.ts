import type { AnyStateMachine, AnyStateNode, StateValue } from 'xstate';
import type { MachineGraph, MachineRun, MachineState, MachineStep, MachineTransition } from '../../shared/machines';
import type { Agent, Project } from '../../shared/types';
import { Journals } from '../journals';
import { EMPTY_REVIEW, evolveReview, reviewMachine, type ReviewFact, type ReviewState } from './reviewJournal';
import { EMPTY_RUN, evolve, journalMachine, type RunFact, type RunState } from './runJournal';
import { runMachine } from './runMachine';
import { EMPTY_SLICE, evolveSlice, sliceMachine, type SliceFact, type SliceState } from './sliceJournal';

// Focus's state machines (docs/agents.md), each as data a drawing is made from (`machineGraph`), and where each
// run of one is now (`machineRuns`): an agent's run, what followed their last turn, a goal's slices, a pull request's
// review, each read from its journal. The plugins get both (`PluginHost.machines`), and hear as a journal steps
// (`machineStepped`).

/** A state's id under its machine: its path, dotted (`turn.started`). */
const idOf = (node: AnyStateNode): string => node.path.join('.');

const childrenOf = (node: AnyStateNode): AnyStateNode[] => Object.values(node.states);

/**
 * The machine as data: its states, nested as they are, and each transition that moves it (to another state or back
 * into the same one) with its event and named guard. A transition taken from the machine itself (any state) is `from`
 * the empty id; one with no target only changes the machine's context, and isn't drawn.
 */
export function machineGraph(machine: AnyStateMachine, about: Pick<MachineGraph, 'id' | 'title' | 'about' | 'runs'>): MachineGraph {
  const states: MachineState[] = [];
  const transitions: MachineTransition[] = [];
  const visit = (node: AnyStateNode): void => {
    const from = idOf(node);
    for (const [event, ts] of node.transitions) {
      for (const t of ts) {
        for (const target of t.target ?? []) transitions.push({ from, to: idOf(target), event, ...(typeof t.guard === 'string' && { guard: t.guard }) });
      }
    }
    const initial = node.initial?.target[0];
    for (const child of childrenOf(node)) {
      const kids = childrenOf(child);
      states.push({
        id: idOf(child),
        key: child.key,
        ...(node.parent && { parent: from }),
        kind: child.type === 'final' ? 'final' : kids.length ? 'compound' : 'atomic',
        ...(child === initial && { initial: true }),
      });
      visit(child);
    }
  };
  visit(machine.root);
  return { ...about, states, transitions };
}

/** A machine's state value as the id of the leaf it's in (`{ turn: 'started' }` is `turn.started`). */
export function leafOf(value: StateValue): string {
  if (typeof value === 'string') return value;
  const [[key, inner] = ['', undefined]] = Object.entries(value);
  return inner ? `${key}.${leafOf(inner)}` : key;
}

/** Focus's machines, drawn: the order they're shown in. */
export const MACHINES: readonly MachineGraph[] = [
  machineGraph(journalMachine, { id: 'run', title: 'A crew member’s run', about: 'Where an agent’s run is, from its journal: waiting, setting up, in a turn, delivering, held.', runs: 'crew member' }),
  machineGraph(runMachine, { id: 'turn', title: 'What follows a turn', about: 'What Ops does once a turn ends, by where it ran and how it ended.', runs: 'crew member' }),
  machineGraph(sliceMachine, { id: 'slice', title: 'A goal’s slices', about: 'A goal’s slice of work: shipped, reviewed, landed, and on to the next.', runs: 'goal' }),
  machineGraph(reviewMachine, { id: 'review', title: 'QA’s review', about: 'A pull request’s review by QA: queued, checked, tested, reported.', runs: 'pull request' }),
];

/** What Focus has that the machines' runs are read from (`Store.machineRuns`). */
export interface RunSources {
  agents: readonly Agent[];
  projects: readonly Project[];
  /** A goal's slices, by its lead's id. */
  slice(leadId: string): { phase: StateValue; seq: number };
  /** The pull requests QA has reviews of on the boards, by prKey (`owner/repo#n`), each with its journal. */
  reviews: readonly { key: string; phase: StateValue; seq: number }[];
}

/**
 * Where every run of each machine is now: each agent's run (its journal's phase) and what followed their last turn
 * (once it's decided; while a turn's open, where it runs), each goal's slices, and each review on the boards.
 */
export function machineRuns(from: RunSources): MachineRun[] {
  const runs: MachineRun[] = [];
  for (const agent of from.agents) {
    const who = { key: agent.id, label: agent.name, projectId: agent.projectId };
    if (!agent.run) continue;
    runs.push({ machine: 'run', ...who, state: agent.run.phase, seq: agent.run.seq });
    runs.push({ machine: 'turn', ...who, state: agent.run.target ?? (agent.cloud ? 'turn.cloud.running' : 'turn.local'), seq: agent.run.seq });
    if (agent.lead) {
      const slice = from.slice(agent.id);
      runs.push({ machine: 'slice', ...who, label: agent.lead.title || agent.name, state: leafOf(slice.phase), seq: slice.seq });
    }
  }
  for (const review of from.reviews) {
    const repo = review.key.slice(0, review.key.lastIndexOf('#'));
    const projectId = from.projects.find((p) => p.repos.includes(repo))?.id;
    runs.push({ machine: 'review', key: review.key, label: review.key, ...(projectId && { projectId }), state: leafOf(review.phase), seq: review.seq });
  }
  return runs;
}

/** How many of its last steps a run's path keeps: enough to read a goal's whole story, not every turn of a long-lived crew member. */
export const PATH_MAX = 60;

/**
 * A run's path through its machine, from its journal: the state it started in, then each state a fact moved it into
 * (a fact that leaves it where it is adds nothing), its last `PATH_MAX` steps.
 */
export function pathOf<S extends { phase: StateValue }, E extends { seq: number; t: number }>(entries: readonly E[], evolve: (state: S, entry: E) => S, empty: S): MachineStep[] {
  let state = empty;
  const steps: MachineStep[] = [{ state: leafOf(empty.phase), seq: 0, t: entries[0]?.t ?? 0 }];
  for (const entry of entries) {
    state = evolve(state, entry);
    const leaf = leafOf(state.phase);
    if (leaf !== steps[steps.length - 1].state) steps.push({ state: leaf, seq: entry.seq, t: entry.t });
  }
  return steps.slice(-PATH_MAX);
}

/** What followed each of an agent's turns, from their run journal: the target each was decided to, in order. */
export function turnPath(entries: readonly { kind: string; seq: number; t: number; target?: string }[]): MachineStep[] {
  return entries.flatMap((e) => (e.kind === 'decided' && e.target ? [{ state: e.target, seq: e.seq, t: e.t }] : [])).slice(-PATH_MAX);
}

/** A run's path through machine `machine` (`key` an agent's id, or a pull request's key), from the journal it's kept in: none for a machine it isn't. */
export function machinePath(
  machine: string,
  key: string,
  journals: { runs: Journals<RunFact, RunState>; slices: Journals<SliceFact, SliceState>; reviews: Journals<ReviewFact, ReviewState> },
): MachineStep[] {
  if (machine === 'run') return pathOf(journals.runs.entries(key), evolve, EMPTY_RUN);
  if (machine === 'turn') return turnPath(journals.runs.entries(key));
  if (machine === 'slice') return pathOf(journals.slices.entries(key), evolveSlice, EMPTY_SLICE);
  if (machine === 'review') return pathOf(journals.reviews.entries(key), evolveReview, EMPTY_REVIEW);
  return [];
}
