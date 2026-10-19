// What the astrometrics plugin's server and browser parts share: its id, its state, and a machine laid out to draw.
import type { MachineRun, MachineState } from '../../plugin-api/shared';

export const ASTROMETRICS = 'astrometrics';

/** The id of the box the transitions taken from any state are drawn from. */
export const ANY_STATE = '*';

/** A state where the layout put it: a box, in the drawing's own coordinates (from its top left); `anywhere` is ANY_STATE's. */
export interface LaidState {
  id: string;
  key: string;
  kind: MachineState['kind'] | 'anywhere';
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A transition's arrow: the line it takes, and where its label goes (its events, and its guard). */
export interface LaidEdge {
  from: string;
  to: string;
  label: string;
  points: { x: number; y: number }[];
  at?: { x: number; y: number };
}

/** A machine laid out to draw (layout.ts): the same drawing for every run of it, with where each is drawn over it. */
export interface MachineLayout {
  id: string;
  title: string;
  about: string;
  runs: string;
  width: number;
  height: number;
  states: LaidState[];
  edges: LaidEdge[];
}

/** The plugin's state: each machine laid out, and where every run of them is now. */
export interface Astrometrics {
  layouts: MachineLayout[];
  runs: MachineRun[];
  /** Why the machines couldn't be laid out, when they couldn't. */
  error?: string;
}

export const freshAstrometrics = (): Astrometrics => ({ layouts: [], runs: [] });
