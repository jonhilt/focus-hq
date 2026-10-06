import { describe, expect, it } from 'vitest';
import type { Agent, AgentStatus } from '../../shared/types';
import { LEAD_DESK, QA_DESK } from '../../shared/types';
import { fitDesks, offTheFloor, pickDesk } from './desks';

const agent = (id: string, desk: number, status: AgentStatus, over: Partial<Agent> = {}) =>
  ({ id, desk, status, task: 'issue', projectId: 'p1', startedAt: 0, ...over }) as Agent;

describe('pickDesk', () => {
  it('takes a free desk, whoever else is in the room', () => {
    expect(pickDesk([agent('a', 0, 'working'), agent('lead', LEAD_DESK, 'done', { task: 'lead' }), agent('qa', QA_DESK, 'done', { task: 'review' })])).toEqual({ desk: 1 });
  });

  it('sends home whoever finished first when the desks are full, a failed one before one with a PR open', () => {
    const done = agent('done', 0, 'done', { finishedAt: 1 });
    const failed = agent('failed', 1, 'error', { finishedAt: 5 });
    expect(pickDesk([done, failed])).toEqual({ desk: 1, evict: failed });
    expect(pickDesk([done, agent('busy', 1, 'working')])).toEqual({ desk: 0, evict: done });
  });

  it('never sends a goal’s lead or QA home for a desk, and waits when everyone at a desk is at work', () => {
    const lead = agent('lead', LEAD_DESK, 'done', { task: 'lead' });
    const qa = agent('qa', QA_DESK, 'done', { task: 'review' });
    expect(pickDesk([agent('a', 0, 'working'), agent('b', 1, 'testing'), lead, qa, agent('off', 4, 'stopped')])).toBeUndefined();
  });
});

describe('fitDesks', () => {
  it('moves agents from desks the room no longer has to its free ones, unfinished work first', () => {
    const agents = [
      agent('kept', 0, 'done'),
      agent('pr-open', 3, 'done', { finishedAt: 9 }),
      agent('stopped', 5, 'stopped', { finishedAt: 2 }),
      agent('other-room', 4, 'stopped', { projectId: 'p2' }),
    ];
    expect(fitDesks(agents)).toEqual(new Map([['stopped', 1], ['other-room', 0]]));
    expect(offTheFloor(agents[1])).toBe(true);
    expect(offTheFloor(agent('lead', LEAD_DESK, 'done', { task: 'lead' }))).toBe(false);
  });
});
