import { describe, expect, it } from 'vitest';
import { randomAvatar } from '../shared/crew';
import type { Agent, LeadWork } from '../shared/types';
import { agentAfterRestart, upgradeLead } from './agentRestartRules';

const agent = (a: Partial<Agent> = {}): Agent => ({
  id: 'agent_ab12',
  name: 'Ada',
  avatar: { division: 'command', rank: 'ensign', species: 'human', skin: '#f1c27d', hair: '#222', hairstyle: 'crop', accessory: 'none' },
  projectId: 'p1',
  repo: 'acme/shop',
  task: 'issue',
  issue: { number: 7, title: 'Save items for later', url: 'https://github.com/acme/shop/issues/7' },
  desk: 0,
  status: 'working',
  activity: 'Fixing it',
  branch: 'focus/7-save-items-for-later-ab12',
  baseBranch: 'main',
  costUsd: 0,
  startedAt: 0,
  ...a,
});

const work: LeadWork = {
  station: 1,
  title: 'Saved items',
  repos: [
    { repo: 'acme/web', folder: 'web', baseBranch: 'main' },
    { repo: 'acme/api', folder: 'api', baseBranch: 'develop' },
  ],
  slice: 2,
  prs: [
    { repo: 'acme/web', number: 12, url: 'u12', outcome: 'merged' },
    { repo: 'acme/api', number: 7, url: 'u7' },
  ],
};

describe('agentAfterRestart', () => {
  it('stops an agent who was at work, and drops a permission they were asking for', () => {
    const after = agentAfterRestart(agent({ status: 'working', permission: { id: 'x', tool: 'Bash', summary: 'rm', at: 0 } }), 'Shop', randomAvatar);
    expect(after).toMatchObject({ status: 'stopped', activity: expect.stringMatching(/Interrupted when Focus shut down/) });
    expect(after.permission).toBeUndefined();
  });

  it('stops a queued agent too, but leaves one who had finished as they were', () => {
    expect(agentAfterRestart(agent({ status: 'queued' }), 'Shop', randomAvatar).status).toBe('stopped');
    expect(agentAfterRestart(agent({ status: 'done', activity: 'PR opened' }), 'Shop', randomAvatar)).toMatchObject({ status: 'done', activity: 'PR opened' });
  });

  it('keeps an agent waiting for their cloud session waiting, and stops watching the terminal opened for it', () => {
    const after = agentAfterRestart(agent({ status: 'working', handover: { since: 1, fresh: true, terminalAt: 5 } }), 'Shop', randomAvatar);
    expect(after).toMatchObject({ status: 'waiting', activity: 'Waiting for a cloud session', handover: { since: 1, fresh: true } });
    expect(after.handover?.terminalAt).toBeUndefined();
  });

  it('hands one held for the plan’s usage limit to the captain', () => {
    const after = agentAfterRestart(agent({ status: 'done', held: { until: 9 } }), 'Shop', randomAvatar);
    expect(after.held).toBeUndefined();
    expect(after.activity).toMatch(/usage limit when Focus shut down/);
  });

  it('forgets a lead’s subagents, workflows and background work, which don’t outlive Focus', () => {
    const after = agentAfterRestart(agent({ status: 'done', helpers: [], workflows: [], background: [] }), 'Shop', randomAvatar);
    expect(after).not.toHaveProperty('helpers', expect.anything());
    expect(after).not.toHaveProperty('workflows', expect.anything());
    expect(after).not.toHaveProperty('background', expect.anything());
  });

  it('gives an agent saved before tasks an issue task, and one saved before uniforms a uniform', () => {
    const old = agent({ status: 'done', avatar: { skin: '#fff' } as never });
    delete (old as Partial<Agent>).task;
    const after = agentAfterRestart(old, 'Shop', randomAvatar);
    expect(after.task).toBe('issue');
    expect(after.avatar).toHaveProperty('division');
  });

  it('dresses an old QA officer as their room’s QA officer', () => {
    const after = agentAfterRestart(agent({ status: 'done', task: 'review', avatar: { skin: '#fff' } as never }), 'Shop', randomAvatar);
    expect(after.avatar).toHaveProperty('division');
  });

  it('names a lead saved before goals for its project', () => {
    const lead = agent({ status: 'done', task: 'lead', lead: { title: '' } as never });
    expect(agentAfterRestart(lead, 'Shop', randomAvatar).lead).toEqual({ title: 'Shop’s first goal' });
  });

  it('leaves what it was given alone', () => {
    const saved = agent({ status: 'working', held: { until: 9 } });
    agentAfterRestart(saved, 'Shop', randomAvatar);
    expect(saved).toMatchObject({ status: 'working', held: { until: 9 } });
  });
});

describe('upgradeLead', () => {
  it('turns the project’s one lead, saved before goals, into a goal, and leaves one that has a goal, with a station or none, alone', () => {
    const old = { id: 'lead_p1', task: 'lead', issue: { number: 0, title: 'Shop’s lead', url: '' }, lead: { repos: [], slice: 3, prs: [] } } as unknown as Agent;
    const upgraded = upgradeLead(old, 'Shop');
    expect(upgraded.lead).toEqual({ title: 'Shop’s first goal', repos: [], slice: 3, prs: [] });
    expect(upgraded.issue.title).toBe('Shop’s first goal');
    const current = { ...old, lead: work } as Agent;
    expect(upgradeLead(current, 'Shop')).toBe(current);
    const stationless = { ...old, lead: { ...work, station: undefined } } as Agent;
    expect(upgradeLead(stationless, 'Shop')).toBe(stationless);
    const developer = { id: 'agent_x', task: 'issue' } as Agent;
    expect(upgradeLead(developer, 'Shop')).toBe(developer);
  });
});
