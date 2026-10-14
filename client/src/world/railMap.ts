import type { Workflow, WorkflowAgent, WorkflowRollEntry } from '../../../shared/types';
import { type LcarsColour, phaseColour, plannedPhases } from './workflowRooms';

// A workflow drawn as a rail map, from its roll (every agent it has queued, each one's label, phase and status): its
// phases are stations, in order, and each item it works on gets a track of its own through them. Claude Code doesn't say
// which agent follows which, so an item is the part of a label after its first colon, as scripts name them
// (`review:perf` then `verify:perf`): a phase that shares items with the one before carries their tracks on; one that
// doesn't starts a section of its own, the tracks before merging into one line and fanning out again. A section of more
// than BUNDLE items runs as one thick line, a bundle, with a count, rather than a track each. Pure: railMapScreen.ts
// draws it.

/** More items than this in a section and they run as one bundle rather than a track each. */
export const BUNDLE = 8;

export type StopState = 'none' | 'queued' | 'working' | 'done' | 'failed';

/** A track's stop at one station: the agents there for its item (or the bundle's), and how they stand. */
export interface RailStop {
  state: StopState;
  /** How each of its agents stands, in the order they were queued: a bundle shows one dot each. */
  agents: WorkflowAgent['status'][];
}

export interface RailTrack {
  /** The item it carries (perf), or for a bundle how many it carries. */
  item: string;
  bundle: boolean;
  /** A stop at each of its section's stations. */
  stops: RailStop[];
  /** The station its item failed at, where its track stops; -1 when it hasn't. */
  failedAt: number;
  /** Whether it has come through every station of its section. */
  through: boolean;
}

export interface RailSection {
  stations: { index: number; title: string; colour: LcarsColour }[];
  tracks: RailTrack[];
}

export interface RailMap {
  sections: RailSection[];
  status: Workflow['status'];
}

/** The item an agent works on: its label after the first colon, or the whole label when it has none. */
export function itemOf(label: string): string {
  const i = label.indexOf(':');
  return i < 0 ? label : label.slice(i + 1);
}

/** How the agents at a stop stand, taken together: failed if any failed, at work while any are, done once all are. */
export function stopState(agents: WorkflowAgent['status'][]): StopState {
  if (!agents.length) return 'none';
  if (agents.includes('failed')) return 'failed';
  if (agents.includes('working')) return 'working';
  if (agents.every((s) => s === 'done')) return 'done';
  return 'queued';
}

/** The rail map of a workflow: its stations, in sections, each with its tracks. */
export function railMap(wf: Pick<Workflow, 'phases' | 'plan' | 'roll' | 'status'>): RailMap {
  const phases = plannedPhases(wf).filter((p) => p.index > 0 || wf.roll.some((a) => a.phase === 0)).sort((a, b) => a.index - b.index);
  const at = new Map<number, WorkflowRollEntry[]>(phases.map((p) => [p.index, wf.roll.filter((a) => a.phase === p.index)]));
  const sections: { phases: typeof phases; items: string[] }[] = [];
  for (const phase of phases) {
    const items = [...new Set(at.get(phase.index)?.map((a) => itemOf(a.label)))];
    const last = sections.at(-1);
    if (last && items.some((i) => last.items.includes(i))) {
      last.phases.push(phase);
      for (const i of items) if (!last.items.includes(i)) last.items.push(i);
    } else sections.push({ phases: [phase], items });
  }
  return {
    status: wf.status,
    sections: sections.map(({ phases: ps, items }) => {
      const bundle = items.length > BUNDLE;
      const lines = bundle ? [{ item: String(items.length), carries: () => true }] : items.map((item) => ({ item, carries: (label: string) => itemOf(label) === item }));
      return {
        stations: ps.map((p) => ({ index: p.index, title: p.title.replace(/^▸\s*/, ''), colour: phaseColour(p) })),
        tracks: lines.map(({ item, carries }) => track(item, bundle, ps.map((p) => (at.get(p.index) ?? []).filter((a) => carries(a.label)).map((a) => a.status)), wf.status)),
      };
    }),
  };
}

function track(item: string, bundle: boolean, agents: WorkflowAgent['status'][][], status: Workflow['status']): RailTrack {
  const stops = agents.map((a) => ({ state: stopState(a), agents: a }));
  // a bundle carries on past an item's failure, counting it; an item's own track stops there
  const failedAt = bundle ? -1 : stops.findIndex((s) => s.state === 'failed');
  const reached = stops.filter((s) => s.state !== 'none');
  // through once every station has seen it done, or, once the workflow's over, every one it reached
  const through = failedAt < 0 && reached.length > 0 && reached.every((s) => s.state === 'done') && (status !== 'running' || reached.length === stops.length);
  return { item, bundle, stops, failedAt, through };
}
