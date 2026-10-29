import { describe, expect, it } from 'vitest';
import { compactRefusal } from './sessionRules';

describe('compactRefusal', () => {
  const agent = { name: 'Lt. Rhee', task: 'issue', sessionId: 's1', status: 'done' } as const;

  it('compacts a conversation here between turns', () => {
    for (const status of ['done', 'stopped', 'error'] as const) expect(compactRefusal({ ...agent, status }, false)).toBeUndefined();
  });

  it('refuses QA, whose reviews each start afresh, first', () => {
    expect(compactRefusal({ ...agent, task: 'review', sessionId: undefined, status: 'working' }, true)).toBe('QA starts each review afresh, so there’s nothing to compact');
  });

  it('refuses an agent with no conversation yet', () => {
    expect(compactRefusal({ ...agent, sessionId: undefined }, false)).toBe('Lt. Rhee has no conversation here to compact');
  });

  it('refuses while a turn is under way, whatever their status says', () => {
    expect(compactRefusal({ ...agent, status: 'working' }, false)).toBe('Lt. Rhee is working: compact once their turn ends');
    expect(compactRefusal(agent, true)).toBe('Lt. Rhee is working: compact once their turn ends');
  });
});
