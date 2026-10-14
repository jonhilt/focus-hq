import { describe, expect, it } from 'vitest';
import { flowNow, flowShares, flowSoFar, flowSummary, flowText, flowTitle, howLong } from './flow';
import type { LeadFlow } from './types';

const MIN = 60_000;
const flow = (now: LeadFlow['now'], active: Partial<LeadFlow['active']> = {}): LeadFlow => ({
  at: 0,
  now,
  active: { queued: 0, working: 0, rework: 0, background: 0, qa: 0, review: 0, captain: 0, ...active },
});

describe('howLong', () => {
  it('reads in minutes, hours or days', () => {
    expect([howLong(30_000), howLong(12.7 * MIN), howLong(2.44 * 60 * MIN), howLong(36 * 60 * MIN), howLong(72 * 60 * MIN)]).toEqual(['<1 min', '12 min', '2.4 h', '36.0 h', '3.0 d']);
  });
});

describe('flowNow', () => {
  it('says what the goal waits on, for how long from when it began, and why when it’s the captain', () => {
    expect(flowNow(flow({ state: 'captain', since: 0, reason: 'go-ahead' }), 12 * MIN)).toEqual({ state: 'captain', words: 'Waiting on you', for: '12 min', why: 'asked leave to go on with what it proposed' });
    expect(flowNow(flow({ state: 'qa', since: 5 * MIN }), 8 * MIN)).toEqual({ state: 'qa', words: 'Waiting on QA', for: '3 min' });
  });
});

describe('flowShares and flowSummary', () => {
  it('share the time while around out by state, in bar order, leaving out the empty ones', () => {
    const f = flow({ state: 'working', since: 0 }, { captain: 22 * MIN, working: 52 * MIN, qa: 14 * MIN, review: 12 * MIN });
    expect(flowShares(f, 0).map((s) => [s.state, s.share])).toEqual([['working', 0.52], ['qa', 0.14], ['review', 0.12], ['captain', 0.22]]);
    expect(flowSummary(f, 0)).toBe('1.7 h so far · at work 52% · QA 14% · your merge 12% · you 22%');
  });
});

describe('flowText and flowTitle', () => {
  it('put what the goal waits on in a line, and why and where its time went in the tooltip', () => {
    const f = flow({ state: 'captain', since: 0, reason: 'next-slice' }, { working: 30 * MIN, captain: 10 * MIN });
    expect(flowText(f, 10 * MIN)).toBe('Waiting on you · 10 min');
    // worked out when the wait began: the wait's 10 minutes so far count, up to now
    expect(flowTitle(f, 10 * MIN)).toBe('A slice landed: waiting to hear what next. 50 min so far · at work 60% · you 40%');
    expect(flowTitle({ ...flow({ state: 'qa', since: 0 }, { qa: MIN }), at: MIN }, MIN)).toBe('1 min so far · QA 100%');
  });
});

describe('flowSoFar', () => {
  it('carries the state the goal is in on to now, from when the office last worked it out', () => {
    const f = { ...flow({ state: 'qa', since: 2 * MIN }, { working: 10 * MIN, qa: MIN }), at: 3 * MIN };
    expect(flowSoFar(f, 8 * MIN)).toMatchObject({ working: 10 * MIN, qa: 6 * MIN });
  });

  it('stops counting a wait that has run to a stretch away, as the office would', () => {
    const f = flow({ state: 'captain', since: 0 }, { working: 10 * MIN });
    expect(flowSoFar(f, 5 * 60 * MIN).captain).toBe(0);
    expect(flowSoFar(flow({ state: 'working', since: 0 }), 5 * 60 * MIN).working).toBe(5 * 60 * MIN);
  });
});
