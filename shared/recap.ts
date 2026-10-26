import type { Lane } from './mergeLaneRules';

// A slice's system recap, as the lead ships it (docs/goals.md#the-system-recap): its shape, shared so the browser and
// plugins can read the one a lead last shipped (`LeadWork.recap`). What's done with it is server/agents/recap.ts's.

export const IMPACTS = ['composes', 'extends', 'adds'] as const;
export type Impact = (typeof IMPACTS)[number];

/** One building block of the system the slice touches. */
export interface RecapPrimitive {
  /** Its name, short, lowercase with dashes (`cos-verdict`): the same one from slice to slice. */
  id: string;
  /** What part of the system it belongs to, in a word or two (`chief of staff`). */
  group: string;
  impact: Impact;
  /** What the slice does to it, in a line. */
  change: string;
  /** Where it is, as the lead's workspace has it: files, or folders ending in `/` (`focus/plugins/chief-of-staff/`). */
  paths: string[];
}

/** One step between two primitives (or anything else the slice talks to): what the slice sends along it. */
export interface RecapStep {
  from: string;
  to: string;
  label: string;
  /** On a map's arrow between two primitives, set by Ops: whether an import backs it (recapImports.ts). */
  backed?: boolean;
}

export interface SliceRecap {
  primitives: RecapPrimitive[];
  /** The promises the slice could break, in plain words. */
  invariants?: string[];
  /** How the touched primitives connect: the system map. */
  map?: RecapStep[];
  /** What happens, in order: the change flow, as a sequence. */
  flow?: RecapStep[];
  /** How the lead would have it merge once QA passes it (shared/mergeLaneRules.ts): none is Ask. */
  lane?: Lane;
}
