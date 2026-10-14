import type { CaptainReason, FlowState, LeadFlow } from './types';

// How an open goal's flow reads on its screens (docs/flow.md): what it's waiting on now and for how long, and where
// its time has gone so far. The server works the flow out (server/agents/flow.ts); this only words it.

/** Each state in a few words, as the goal board says what the goal is doing now. */
export const STATE_WORDS: Record<FlowState, string> = {
  working: 'At work',
  rework: 'Reworking after QA',
  background: 'Waiting on its own work',
  qa: 'Waiting on QA',
  review: 'Waiting for your merge',
  captain: 'Waiting on you',
  queued: 'Queued',
};

/** Why the lead is waiting on the captain, in a few words. */
export const REASON_WORDS: Record<CaptainReason, string> = {
  'go-ahead': 'asked leave to go on with what it proposed',
  question: 'asked you something',
  ask: 'asked you with pictures',
  'next-slice': 'a slice landed: waiting to hear what next',
  report: 'reported back',
  close: 'proposed closing the goal',
  'qa-failed': 'QA failed and it stopped',
};

/** The states in the order a bar of them runs: at work first, the waits after. */
export const STATE_ORDER: FlowState[] = ['working', 'rework', 'background', 'qa', 'review', 'captain', 'queued'];

/** How long, in a few characters: `<1 min`, `12 min`, `2.4 h`, `1.5 d`. */
export function howLong(ms: number): string {
  const m = ms / 60_000;
  if (m < 1) return '<1 min';
  if (m < 60) return `${Math.floor(m)} min`;
  if (m < 48 * 60) return `${(m / 60).toFixed(1)} h`;
  return `${(m / 1440).toFixed(1)} d`;
}

/** What the goal is doing now, for how long, and why when it's waiting on the captain. */
export function flowNow(flow: LeadFlow, now: number): { state: FlowState; words: string; for: string; why?: string } {
  const { state, since, reason } = flow.now;
  return { state, words: STATE_WORDS[state], for: howLong(Math.max(0, now - since)), ...(reason && state === 'captain' ? { why: REASON_WORDS[reason] } : {}) };
}

/** Where the goal's time has gone while someone was around, state by state in bar order, leaving out states it hasn't been in. */
export function flowShares(flow: LeadFlow): { state: FlowState; ms: number; share: number }[] {
  const total = STATE_ORDER.reduce((n, s) => n + flow.active[s], 0);
  return STATE_ORDER.filter((s) => flow.active[s] > 0).map((s) => ({ state: s, ms: flow.active[s], share: total ? flow.active[s] / total : 0 }));
}

/** One line on the goal's time so far: `2.4 h so far · at work 52% · QA 14% · your merge 12% · you 22%`. */
export function flowSummary(flow: LeadFlow): string {
  const shares = flowShares(flow);
  const total = shares.reduce((n, s) => n + s.ms, 0);
  const short: Record<FlowState, string> = { working: 'at work', rework: 'rework', background: 'own work', qa: 'QA', review: 'your merge', captain: 'you', queued: 'queued' };
  return [`${howLong(total)} so far`, ...shares.filter((s) => s.share >= 0.01).map((s) => `${short[s.state]} ${Math.round(s.share * 100)}%`)].join(' · ');
}
