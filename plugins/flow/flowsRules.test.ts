import { describe, expect, it } from 'vitest';
import type { Agent, LedgerEvent } from '../../plugin-api/shared';
import { goalMoved, withFlow, withoutClosed } from './flowsRules';
import type { LeadFlow } from './shared';

describe('goalMoved', () => {
  const lead = { id: 'lead_1', task: 'lead', lead: { prs: [{ repo: 'o/web', number: 4 }] } } as Agent;
  const event = (kind: string, pr = 4) => ({ kind, repo: 'o/web', pr, at: 1, projectId: 'p', seq: 1 }) as LedgerEvent;

  it('finds the goal a verdict or landing in the ledger moves on, by its pull request', () => {
    expect(goalMoved(event('qa-verdict'), [lead])).toBe('lead_1');
    expect(goalMoved(event('merged'), [lead])).toBe('lead_1');
    expect(goalMoved(event('closed'), [lead])).toBe('lead_1');
  });

  it('leaves alone what doesn’t move a goal, and pull requests that aren’t a goal’s', () => {
    expect(goalMoved(event('conflicts'), [lead])).toBeUndefined();
    expect(goalMoved(event('qa-verdict', 5), [lead])).toBeUndefined();
    expect(goalMoved(event('qa-verdict'), [{ ...lead, task: 'issue', lead: undefined }])).toBeUndefined();
  });
});

describe('withFlow', () => {
  const flow = (at: number): LeadFlow => ({ at, now: { state: 'qa', since: at }, active: { queued: 0, working: at, rework: 0, background: 0, qa: 0, review: 0, captain: 0 } });

  it('puts the goal’s new flow in, and leaves out goals that have closed', () => {
    expect(withFlow({ a: flow(1), b: flow(2) }, 'a', flow(3), (id) => id !== 'b')).toEqual({ a: flow(3) });
    expect(withFlow({ a: flow(1) }, 'c', flow(3), () => true)).toEqual({ a: flow(1), c: flow(3) });
  });
});

describe('withoutClosed', () => {
  const flow = (at: number): LeadFlow => ({ at, now: { state: 'qa', since: at }, active: { queued: 0, working: at, rework: 0, background: 0, qa: 0, review: 0, captain: 0 } });

  it('leaves out goals that have closed, and says so only when one has', () => {
    expect(withoutClosed({ a: flow(1), b: flow(2) }, (id) => id !== 'b')).toEqual({ a: flow(1) });
    expect(withoutClosed({ a: flow(1) }, () => true)).toBeUndefined();
    expect(withoutClosed({}, () => false)).toBeUndefined();
  });
});
