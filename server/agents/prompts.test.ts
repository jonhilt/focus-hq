import { describe, expect, it } from 'vitest';
import type { Agent } from '../../shared/types';
import { carryOnPrompt, conflictsPrompt, pullRequestBody, pushNudge, systemAppend } from './prompts';

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
  activity: '',
  branch: 'focus/7-save-items-for-later-ab12',
  baseBranch: 'main',
  costUsd: 0,
  startedAt: 0,
  ...a,
});

describe('systemAppend', () => {
  it('keeps a local agent from pushing and points them at the office browser', () => {
    const text = systemAppend(agent());
    expect(text).toContain('Do NOT push');
    expect(text).toContain('mcp__browser__');
  });

  it('has a local agent wait with focus-wait, which only their PATH has', () => {
    expect(systemAppend(agent())).toContain('focus-wait --until');
    expect(systemAppend(agent({ cloud: true }))).not.toContain('focus-wait');
  });

  it('has a cloud agent push their own branch, and only that one', () => {
    const text = systemAppend(agent({ cloud: true }));
    expect(text).toContain('git push origin HEAD:focus/7-save-items-for-later-ab12');
    expect(text).toContain('Never push to any other branch');
    expect(text).not.toContain('Do NOT push');
    expect(text).not.toContain('mcp__browser__');
    // screenshots only reach the laptop screen when they come back through a tool result
    expect(text).toContain('Read tool');
  });
});

describe('cloud follow-ups', () => {
  it('asks a cloud agent resolving conflicts to push the merge', () => {
    expect(conflictsPrompt(agent({ task: 'conflicts', cloud: true }))).toContain('git push origin HEAD:focus/7-save-items-for-later-ab12');
    expect(conflictsPrompt(agent({ task: 'conflicts' }))).not.toContain('git push');
  });

  it('nudges for the branch and the reply the office still needs', () => {
    expect(pushNudge(agent({ cloud: true }))).toContain('pull request description');
    expect(pushNudge(agent({ cloud: true, task: 'fix' }))).toContain('summary for the manager');
  });

  it('hands a new session the task, the branch and the manager’s message', () => {
    const text = carryOnPrompt(agent({ cloud: true }), 'Also handle the empty cart');
    expect(text).toContain('issue #7');
    expect(text).toContain('git log origin/main..HEAD');
    expect(text.endsWith('Also handle the empty cart')).toBe(true);
  });
});

describe('pullRequestBody', () => {
  it('closes the issue and signs the work by default', () => {
    const body = pullRequestBody(agent(), 'Adds a cart.', true);
    expect(body).toContain('Adds a cart.\n\nCloses #7');
    expect(body).toContain('_Built by **Ada** in the Focus office with Claude Code._');
  });

  it('leaves out the agent and Focus when attribution is off', () => {
    expect(pullRequestBody(agent(), 'Adds a cart.', false)).toBe('Adds a cart.\n\nCloses #7');
  });

  it('closes no issue of its own for a climb, which has none', () => {
    expect(pullRequestBody(agent({ task: 'climb', issue: { number: 0, title: 'Climbing', url: '' } }), '**Problem**\n\nSlow.', false)).toBe('**Problem**\n\nSlow.');
  });
});
