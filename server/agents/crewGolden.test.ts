import { describe, expect, it } from 'vitest';
import type { Agent } from '../../shared/types';
import type { PullRequestDetail } from '../github/provider';
import { leadSystemAppend } from './lead';
import { qaPlaybook, qaSystemAppend } from './qa';
import { crewSession } from './claudeCrew';
import { goalTitleSystemPrompt } from './goalTitles';
import { plannerSystemPrompt } from './planner';
import { qaChatSystemPrompt } from './qaChat';
import { triageSystemPrompt } from './triage';
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
    await expect(leadSystemAppend({ name: 'Lt. Okafor' }, 'Focus', {})).toMatchFileSnapshot(golden('lead'));
    await expect(leadSystemAppend({ name: 'Lt. Haddad' }, 'Acme Shop', {})).toMatchFileSnapshot(golden('lead-acme'));
  });

  it('shapes the goal with the captain first when they started it that way', async () => {
    await expect(leadSystemAppend({ name: 'Lt. Okafor' }, 'Focus', { shaping: true })).toMatchFileSnapshot(golden('lead-shaping'));
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

describe('the QA officer’s system prompt', () => {
  const pr: PullRequestDetail = {
    number: 42,
    title: 'Save items for later',
    body: '',
    url: 'https://github.com/acme/shop/pull/42',
    branch: 'focus/7-save-items-for-later-ab12',
    baseBranch: 'main',
    headSha: '0123456789abcdef',
    linkedIssues: [7],
  };
  const qa = { name: 'Lt. Nakamura' };
  const shop = { name: 'Acme Shop' };
  const checks = ['pnpm run typecheck', 'pnpm test'];
  const siblings = [
    { repo: 'acme/api', number: 43, folder: 'api', sha: 'fedcba9876543210' },
    { repo: 'acme/docs', number: 44, folder: 'docs' },
    { repo: 'acme/app', number: 45, folder: 'app', error: 'the branch is gone' },
  ];

  it('is word for word what it was, with proof mode on (the default) or off', async () => {
    await expect(qaSystemAppend(qa, shop, pr, pr.headSha)).toMatchFileSnapshot(golden('qa'));
    await expect(qaSystemAppend(qa, { ...shop, qaProof: false }, pr, pr.headSha)).toMatchFileSnapshot(golden('qa-no-proof'));
  });

  it('is word for word what it was, with the repo’s checks, a brief, a recording and the slice’s other pull requests', async () => {
    const project = { ...shop, qaBrief: '  Check the basket survives a reload.\nAnd the totals.  ', qaVideo: true };
    await expect(qaSystemAppend(qa, project, pr, pr.headSha, siblings, checks)).toMatchFileSnapshot(golden('qa-everything'));
    await expect(qaSystemAppend(qa, { ...project, qaProof: false }, pr, pr.headSha, siblings, checks)).toMatchFileSnapshot(golden('qa-everything-no-proof'));
  });

  it('lists the same steps at the Playbook', async () => {
    const repos = [{ repo: 'acme/shop', cloned: true, packageJson: true, claudeMd: false, commands: checks }];
    const steps = (proof: boolean) => qaPlaybook('Lt. Nakamura', { ...shop, repos: ['acme/shop'], qaProof: proof, qaVideo: true }, repos).steps.map((s) => `## ${s.title}\n\n${s.text}`).join('\n\n');
    await expect(steps(true)).toMatchFileSnapshot(golden('qa-playbook-steps'));
    await expect(steps(false)).toMatchFileSnapshot(golden('qa-playbook-steps-no-proof'));
  });
});

describe('the read-only crew’s system prompts', () => {
  const officer = { name: 'Lt. Varga', avatar: agent().avatar };

  it('are word for word what they were: the planner, with one repo or several', async () => {
    await expect(plannerSystemPrompt({ planner: officer, projectName: 'Acme Shop', repos: ['acme/shop'] })).toMatchFileSnapshot(golden('planner'));
    await expect(plannerSystemPrompt({ planner: officer, projectName: 'Acme Shop', repos: ['acme/shop', 'acme/api', 'other/shop'] })).toMatchFileSnapshot(golden('planner-repos'));
  });

  it('are word for word what they were: triage, the QA chat and the goal titler', async () => {
    const pr = { number: 42, title: 'Save items for later', body: '', url: '', branch: 'b', baseBranch: 'main', headSha: '0123456', linkedIssues: [] };
    await expect(triageSystemPrompt({ officer, projectName: 'Acme Shop', pr })).toMatchFileSnapshot(golden('triage'));
    await expect(qaChatSystemPrompt({ officer: 'Lt. Nakamura', projectName: 'Acme Shop' })).toMatchFileSnapshot(golden('qa-chat'));
    await expect(goalTitleSystemPrompt()).toMatchFileSnapshot(golden('goal-title'));
  });
});

describe('the read-only crew’s sessions', () => {
  // what claudeCrew.ts gave each before they moved: TITLE_MODEL, maxTurns and timeoutMs by hand, or runReadOnly's defaults
  it('run on the same model, for as many turns and as long as they did', () => {
    expect(crewSession('goal-title')).toEqual({ model: 'claude-haiku-4-5-20251001', maxTurns: 2, timeoutMs: 60_000 });
    expect(crewSession('qa-chat')).toEqual({ maxTurns: 3, timeoutMs: 3 * 60_000 });
    expect(crewSession('planner')).toEqual({ maxTurns: 40, timeoutMs: 8 * 60_000 });
    expect(crewSession('triage')).toEqual({ maxTurns: 40, timeoutMs: 8 * 60_000 });
  });
});
