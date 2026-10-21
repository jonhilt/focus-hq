// Ops' state machines as data (server/agents/machines.ts): each one's states and transitions, read from its
// XState definition so a drawing of it is never out of date with its code, and where each run of it is now.

/** A state of a machine: its dotted id under the machine (`turn.started`), and the compound state it's in. */
export interface MachineState {
  id: string;
  /** Its own name, the last part of its id. */
  key: string;
  /** The compound state it's in, by id: none for one at the top. */
  parent?: string;
  /** A compound state holds others; a final one ends the machine. */
  kind: 'atomic' | 'compound' | 'final';
  /** Its parent's (or the machine's) initial state. */
  initial?: boolean;
}

/** A transition: the event that takes it, from a state to another (or the same one), and the named guard it needs. */
export interface MachineTransition {
  from: string;
  to: string;
  event: string;
  guard?: string;
}

/** A machine, as data: its states in the order its definition gives them, parents before their children. */
export interface MachineGraph {
  id: string;
  title: string;
  /** What it decides, in a sentence. */
  about: string;
  /** What one run of it is: an agent's run, a goal's slices, a pull request's review. */
  runs: string;
  states: MachineState[];
  transitions: MachineTransition[];
}

/** A run of a machine and where it is now: an agent's run, a goal's slices, a pull request's review. */
export interface MachineRun {
  machine: string;
  /** Which run, within its machine: an agent's id, a pull request's key. */
  key: string;
  /** Whose or what it is, in a few words. */
  label: string;
  projectId?: string;
  /** The state it's in, by id (a leaf). */
  state: string;
  /** Its journal's last fact's number. */
  seq: number;
}

/** A step on a run's path through its machine (`PluginHost.machinePath`): the state it went into, and when. */
export interface MachineStep {
  state: string;
  /** The journal's fact that took it there. */
  seq: number;
  t: number;
}
