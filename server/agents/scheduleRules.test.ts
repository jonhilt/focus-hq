import { describe, expect, it } from 'vitest';
import type { Agent, AgentStatus, AgentTask } from '../../shared/types';
import { whoStarts } from './scheduleRules';

const agent = (id: string, task: AgentTask, status: AgentStatus, projectId = 'p1', startedAt = 0) => ({ id, task, status, projectId, startedAt }) as Agent;
const rooms = [{ id: 'p1', name: 'Shop', maxAgents: 2 }, { id: 'p2', name: 'Game', maxAgents: 1 }];
const ids = (r: ReturnType<typeof whoStarts>) => ({ start: r.start.map((a) => a.id), wait: r.wait.map((w) => `${w.agent.id}: ${w.why}`) });

describe('whoStarts', () => {
  it('starts QA first, then whoever was queued first, up to Focus’s limit', () => {
    const agents = [agent('dev1', 'issue', 'queued', 'p1', 1), agent('qa', 'review', 'queued', 'p1', 5), agent('dev2', 'issue', 'queued', 'p1', 2)];
    expect(ids(whoStarts(agents, rooms, 2))).toEqual({ start: ['qa', 'dev1'], wait: ['dev2: Waiting for a free slot (2 agents busy)'] });
  });

  it('keeps a room’s desk agents within its limit, but not its QA or leads', () => {
    const agents = [
      agent('busy', 'issue', 'working', 'p2'),
      agent('dev', 'issue', 'queued', 'p2', 1),
      agent('lead', 'lead', 'queued', 'p2', 2),
      agent('qa', 'review', 'queued', 'p2', 3),
    ];
    expect(ids(whoStarts(agents, rooms, 10))).toEqual({ start: ['qa', 'lead'], wait: ['dev: Waiting – Game allows 1 at once'] });
  });

  it('counts the agents it starts against the room as it goes', () => {
    const agents = [agent('a', 'issue', 'queued', 'p1', 1), agent('b', 'issue', 'queued', 'p1', 2), agent('c', 'issue', 'queued', 'p1', 3)];
    expect(ids(whoStarts(agents, rooms, 10))).toEqual({ start: ['a', 'b'], wait: ['c: Waiting – Shop allows 2 at once'] });
  });

  it('counts everyone working towards Focus’s limit, and passes over agents of a room that’s gone', () => {
    const agents = [agent('qa', 'review', 'testing', 'p1'), agent('lead', 'lead', 'setting-up', 'p2'), agent('lost', 'issue', 'queued', 'gone'), agent('dev', 'issue', 'queued', 'p1', 4)];
    expect(ids(whoStarts(agents, rooms, 3))).toEqual({ start: ['dev'], wait: [] });
    expect(ids(whoStarts(agents, rooms, 2)).wait).toEqual(['lost: Waiting for a free slot (2 agents busy)', 'dev: Waiting for a free slot (2 agents busy)']);
  });
});
