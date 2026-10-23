import { describe, expect, it } from 'vitest';
import type { Agent } from '../../shared/types';
import { leadSystemAppend } from './lead';
import { systemAppend } from './prompts';

// The crew's system prompts, word for word, as they were before they moved out of the code into .focus/crew/: a
// crew file that renders any differently changes what an agent is told, and fails here. Changing a prompt on
// purpose, update its snapshot (`pnpm test -- -u`) and let the diff show the change.

const agent = (a: Partial<Agent> = {}): Agent => ({
  id: 'agent_ab12',
  name: 'Ensign Varga',
  avatar: { division: 'operations', rank: 'ensign', species: 'human', skin: '#f1c27d', hair: '#222', hairstyle: 'crop', accessory: 'none' },
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

const golden = (name: string) => `__golden__/${name}.md`;

describe('a lead’s system prompt', () => {
  it('is word for word what it was', async () => {
    await expect(leadSystemAppend({ name: 'Lt. Okafor' }, 'Focus', 2)).toMatchFileSnapshot(golden('lead'));
    await expect(leadSystemAppend({ name: 'Lt. Haddad' }, 'Acme Shop', 0)).toMatchFileSnapshot(golden('lead-acme'));
  });
});

describe('a desk agent’s system prompt', () => {
  const tasks = ['issue', 'conflicts', 'fix'] as const;
  for (const task of tasks) {
    for (const cloud of [false, true]) {
      it(`is word for word what it was, for ${task} ${cloud ? 'in the cloud' : 'here'}`, async () => {
        const a = agent({ task, cloud });
        await expect(systemAppend(a)).toMatchFileSnapshot(golden(`worker-${task}${cloud ? '-cloud' : ''}`));
      });
    }
  }

  it('is word for word what it was, on a plugin’s brief or one whose plugin is off', async () => {
    const briefed = agent({ task: 'brief', issue: { number: 0, title: 'Auditing', url: '' } });
    await expect(systemAppend(briefed, { assignment: 'You are the auditor.', summary: 'End with the findings.' })).toMatchFileSnapshot(golden('worker-brief'));
    await expect(systemAppend(briefed)).toMatchFileSnapshot(golden('worker-brief-unknown'));
  });
});
