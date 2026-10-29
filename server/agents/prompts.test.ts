import { describe, expect, it } from 'vitest';
import type { Agent } from '../../shared/types';
import { conflictsPrompt, pullRequestBody, systemAppend } from './prompts';
import { PUBLIC_WORDS_RULE } from '../../shared/wording';

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
  it('keeps the ship’s terms for people out of an agent’s pull requests and commits', () => {
    expect(systemAppend(agent())).toContain(PUBLIC_WORDS_RULE);
  });

  it('keeps an agent from pushing and points them at Focus’s browser tools', () => {
    const text = systemAppend(agent());
    expect(text).toContain('Do NOT push');
    expect(text).toContain('mcp__browser__');
  });

  it('has an agent wait with focus-wait, which only their PATH has', () => {
    expect(systemAppend(agent())).toContain('focus-wait --until');
  });

  it('tells an agent on a plugin’s brief what the brief says of the work, or that it’s in their first message once the plugin’s off', () => {
    const briefed = agent({ task: 'brief', issue: { number: 0, title: 'Auditing', url: '' } });
    const text = systemAppend(briefed, { assignment: 'You are the auditor.', summary: 'End with the findings.' });
    expect(text).toContain('You are the auditor.');
    expect(text).toContain('End with the findings.');
    expect(systemAppend(briefed)).toContain('it\'s in your first message');
  });
});

describe('conflictsPrompt', () => {
  it('has whoever resolves the conflicts commit the merge, and leaves the push to Ops', () => {
    expect(conflictsPrompt(agent({ task: 'conflicts' }))).toContain('4. Commit the merge.');
    expect(conflictsPrompt(agent({ task: 'conflicts' }))).not.toContain('git push');
  });
});

describe('pullRequestBody', () => {
  it('closes the issue and signs the work by default', () => {
    const body = pullRequestBody(agent(), 'Adds a cart.', true);
    expect(body).toContain('Adds a cart.\n\nCloses #7');
    expect(body).toContain('_Built by **Ada** aboard the Focus with Claude Code._');
  });

  it('leaves out the agent and Focus when attribution is off', () => {
    expect(pullRequestBody(agent(), 'Adds a cart.', false)).toBe('Adds a cart.\n\nCloses #7');
  });

  it('closes no issue of its own for a plugin’s brief, which has none', () => {
    expect(pullRequestBody(agent({ task: 'brief', issue: { number: 0, title: 'Climbing', url: '' } }), '**Problem**\n\nSlow.', false)).toBe('**Problem**\n\nSlow.');
  });
});
