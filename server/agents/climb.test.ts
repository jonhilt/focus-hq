import { describe, expect, it } from 'vitest';
import type { LedgerEvent } from '../../shared/ledger';
import { freshClimb, type Agent, type Climb } from '../../shared/types';
import { climbBrief, climbHome, climbPullRequest, climbStep, githubRepo, openRetroIssues } from './climb';

const REPO = 'jonhilt/focus';
let seq = 0;
const event = (e: Record<string, unknown>, at = 1000): LedgerEvent => ({ at, projectId: 'p', seq: seq++, ...e }) as LedgerEvent;

describe('climbStep', () => {
  const on: Climb = { ...freshClimb(), keepClimbing: true };
  const climber = (a: Partial<Agent>) => ({ status: 'working' as const, activity: 'Fixing', ...a });

  it('starts a climb when climbing is on and none is open, and does nothing when it’s off', () => {
    expect(climbStep(on, undefined)).toEqual({ kind: 'start' });
    expect(climbStep(freshClimb(), undefined)).toEqual({ kind: 'idle' });
  });

  it('starts the next climb with the same engineer once they’ve finished the last, and waits while they’re still busy with it', () => {
    expect(climbStep(on, climber({ status: 'done' }))).toEqual({ kind: 'start' });
    expect(climbStep(on, climber({ status: 'error' }))).toEqual({ kind: 'start' });
    expect(climbStep(on, climber({ status: 'working' }))).toEqual({ kind: 'wait' });
    expect(climbStep(freshClimb(), climber({ status: 'working' }))).toEqual({ kind: 'idle' });
  });

  it('waits while the climber works, and while their pull request is open, even after they’ve gone home', () => {
    expect(climbStep({ ...on, agentId: 'a' }, climber({}))).toEqual({ kind: 'wait' });
    expect(climbStep({ ...on, agentId: 'a' }, climber({ status: 'done', pr: { number: 4, url: 'u' } }))).toEqual({ kind: 'wait' });
    expect(climbStep({ ...on, pr: { number: 4, url: 'u' } }, undefined)).toEqual({ kind: 'wait' });
  });

  it('stops climbing, saying why, when the last climb ended without a pull request', () => {
    expect(climbStep({ ...on, agentId: 'a' }, climber({ status: 'done', activity: 'Finished without committing changes' })))
      .toEqual({ kind: 'stop', outcome: 'nothing', why: 'The last climb found nothing to change: Finished without committing changes' });
    expect(climbStep({ ...on, agentId: 'a' }, climber({ status: 'error', error: 'Usage limit reached' })))
      .toEqual({ kind: 'stop', outcome: 'failed', why: 'The last climb failed: Usage limit reached' });
    expect(climbStep({ ...on, agentId: 'a' }, undefined)).toMatchObject({ kind: 'stop', outcome: 'failed' });
  });

  it('waits for a climb already under way even once climbing is switched off', () => {
    expect(climbStep({ ...freshClimb(), agentId: 'a' }, climber({}))).toEqual({ kind: 'wait' });
  });
});

describe('climbPullRequest', () => {
  it('takes the title from the write-up’s first line and the rest as the body', () => {
    expect(climbPullRequest('# Narrow the board’s lookups\n\n**Problem**\n\nSix `!`s.')).toEqual({ title: 'Narrow the board’s lookups', body: '**Problem**\n\nSix `!`s.' });
  });

  it('falls back on a title of its own when the climber didn’t give one', () => {
    expect(climbPullRequest('**Problem**\n\nSlow.')).toEqual({ title: 'Climb: one step up the scorecard', body: '**Problem**\n\nSlow.' });
  });
});

describe('openRetroIssues', () => {
  it('lists the accepted retro issues in the repo that no merge has closed', () => {
    const events = [
      event({ kind: 'retro-decision', title: 'Give each demo its own port', signatures: [], accepted: true, issue: { repo: REPO, number: 12 } }),
      event({ kind: 'retro-decision', title: 'Rejected', signatures: [], accepted: false }),
      event({ kind: 'retro-decision', title: 'Elsewhere', signatures: [], accepted: true, issue: { repo: 'acme/shop', number: 3 } }),
      event({ kind: 'retro-decision', title: 'Already fixed', signatures: [], accepted: true, issue: { repo: REPO, number: 13 } }),
      event({ kind: 'merged', repo: REPO, pr: 20, by: 'captain', qa: 'passed', failedRounds: 0, triages: 0, closes: [13] }),
    ];
    expect(openRetroIssues(events, REPO)).toEqual([{ number: 12, title: 'Give each demo its own port' }]);
  });
});

describe('climbBrief', () => {
  const agent = { repo: REPO, baseBranch: 'main', branch: 'focus/climb-abc123' };

  it('starts from the scorecard and lists the retro’s open issues, with the rules', () => {
    const brief = climbBrief(agent, [event({ kind: 'retro-decision', title: 'Give each demo its own port', signatures: [], accepted: true, issue: { repo: REPO, number: 12 } })], 2000);
    expect(brief).toMatch(/^Climb jonhilt\/focus one step/);
    expect(brief).toContain('`pnpm run scorecard --no-save` before you change anything');
    expect(brief).toContain('  - #12 Give each demo its own port');
    expect(brief).toContain('Change a dependency version.');
  });

  it('says so when there are no frictions or retro issues to weigh', () => {
    const brief = climbBrief(agent, [], 2000);
    expect(brief).toContain('none came up in 3 or more sessions lately');
    expect(brief).toContain('the retro\'s accepted issues: none are open.');
  });
});

describe('githubRepo', () => {
  it('reads owner/repo from either form of a GitHub remote, and nothing from another host', () => {
    expect(githubRepo('https://github.com/jonhilt/focus.git\n')).toBe(REPO);
    expect(githubRepo('git@github.com:jonhilt/focus.git')).toBe(REPO);
    expect(githubRepo('https://github.com/jonhilt/focus')).toBe(REPO);
    expect(githubRepo('https://gitlab.com/jonhilt/focus.git')).toBeUndefined();
  });
});

describe('climbHome', () => {
  const projects = [{ id: 'shop', repos: ['acme/shop'] }, { id: 'focus', repos: ['acme/api', REPO] }];

  it('is the project with the office’s own repo', () => {
    expect(climbHome(projects, REPO, false)).toEqual({ projectId: 'focus', repo: REPO });
  });

  it('is nowhere when no project has it, except in the demo, which climbs its first repo', () => {
    expect(climbHome(projects, 'other/repo', false)).toBeUndefined();
    expect(climbHome(projects, undefined, true)).toEqual({ projectId: 'shop', repo: 'acme/shop' });
  });
});
