// Where a goal's time goes (docs/flow.md): the states its time splits into, why the lead waits on the captain, and
// what an open goal carries of it for its screens (`LeadWork.flow`).

/** One state a goal's time is in: the lead at work, reworking, or between turns waiting on its own work, QA, a merge or the captain. */
export type FlowState = 'queued' | 'working' | 'rework' | 'background' | 'qa' | 'review' | 'captain';

/**
 * How the lead ended up handing a turn back: proposing the goal closes, asking with pictures (the ask tool), asking
 * leave to go on with what it proposed, asking something else, or just reporting.
 */
export type Said = 'close' | 'ask' | 'go-ahead' | 'question' | 'report';

/** Why the lead waited on the captain: how its last turn ended, or that QA had failed and it stopped. */
export type CaptainReason = Said | 'next-slice' | 'qa-failed';

/** The state a goal is in, since when, and why when it's waiting on the captain. */
export interface FlowNow {
  state: FlowState;
  since: number;
  reason?: CaptainReason;
}

/** An open goal's time so far, worked out on the server as its lead's turns start and end, QA reports and slices land. */
export interface LeadFlow {
  /** When it was worked out. */
  at: number;
  now: FlowNow;
  /** Time in each state so far, leaving out idle stretches of 4 hours or more (nights, days away). */
  active: Record<FlowState, number>;
}
