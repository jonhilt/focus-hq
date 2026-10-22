import { describe, expect, it } from 'vitest';
import { higherLane, laneFloor, laneProblem } from './mergeLane';

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
