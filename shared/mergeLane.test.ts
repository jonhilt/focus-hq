import { describe, expect, it } from 'vitest';
import { higherLane, laneFloor, laneProblem, raisedPrs, raisedSaid } from './mergeLane';

describe('the lowest lane a slice may take', () => {
  it('is set by its rollup: composing may Ship, extending Show, adding only Ask', () => {
    expect([laneFloor('composes'), laneFloor('extends'), laneFloor('adds')]).toEqual(['ship', 'show', 'ask']);
  });

  it('lets the lead pick it or any higher, never lower', () => {
    expect(laneProblem('ship', 'composes')).toBeUndefined();
    expect(laneProblem('ask', 'composes')).toBeUndefined();
    expect(laneProblem('show', 'extends')).toBeUndefined();
    expect(laneProblem('ship', 'extends')).toBe('A slice that extends existing primitives goes in Show or higher, not Ship: lanes are only ever raised');
    expect(laneProblem('show', 'adds')).toBe('A slice that adds a primitive goes in Ask or higher, not Show: lanes are only ever raised');
  });
});

describe('the higher of two lanes', () => {
  it('is the one asking more of the captain, whichever way round', () => {
    expect(higherLane('ship', 'show')).toBe('show');
    expect(higherLane('ask', 'show')).toBe('ask');
    expect(higherLane('ship', 'ship')).toBe('ship');
  });
});

describe('raising the lane of a lead’s pull requests', () => {
  const by = { by: 'chief-of-staff', why: 'It changes a card.' };

  it('takes each open one in a lower lane up, with who and why, and leaves the rest', () => {
    const prs = [{ n: 1, lane: 'ship' as const }, { n: 2, lane: 'ask' as const }, { n: 3, lane: 'ship' as const, outcome: 'merged' }];
    const { prs: next, from } = raisedPrs(prs, 'show', by);
    expect(next).toEqual([{ n: 1, lane: 'show', raised: { lane: 'show', ...by } }, prs[1], prs[2]]);
    expect([...from.values()]).toEqual(['ship']);
  });

  it('lowers none', () => {
    expect(raisedPrs([{ lane: 'ask' as const }], 'ship', by).from.size).toBe(0);
  });

  it('says so on the pull request', () => {
    expect(raisedSaid('ship', 'ask')).toBe('⬆ This pull request\'s merge lane was raised from Ship to Ask: it waits for a maintainer to merge it.');
  });
});
