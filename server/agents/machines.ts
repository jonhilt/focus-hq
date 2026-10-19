import type { AnyStateMachine, AnyStateNode, StateValue } from 'xstate';
import type { MachineGraph, MachineRun, MachineState, MachineTransition } from '../../shared/machines';
import type { Agent, Project } from '../../shared/types';
import { reviewMachine } from './reviewJournal';
import { journalMachine } from './runJournal';
import { runMachine } from './runMachine';
import { sliceMachine } from './sliceJournal';

// The office's state machines (docs/agents.md), each as data a drawing is made from (`machineGraph`), and where each
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

/** The office's machines, drawn: the order they're shown in. */
export const MACHINES: readonly MachineGraph[] = [
  machineGraph(journalMachine, { id: 'run', title: 'A crew member’s run', about: 'Where an agent’s run is, from its journal: waiting, setting up, in a turn, delivering, held.', runs: 'crew member' }),
  machineGraph(runMachine, { id: 'turn', title: 'What follows a turn', about: 'What the office does once a turn ends, by where it ran and how it ended.', runs: 'crew member' }),
  machineGraph(sliceMachine, { id: 'slice', title: 'A goal’s slices', about: 'A goal’s slice of work: shipped, reviewed, landed, and on to the next.', runs: 'goal' }),
  machineGraph(reviewMachine, { id: 'review', title: 'QA’s review', about: 'A pull request’s review by QA: queued, checked, tested, reported.', runs: 'pull request' }),
];

/** What the office has that the machines' runs are read from (`Store.machineRuns`). */
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
