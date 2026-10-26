import { describe, expect, it } from 'vitest';
import type { Agent } from '../../plugin-api/server';
import { climbHome, climbStep, gapScore, ranked } from './climbRules';
import { freshClimb, type Climb } from './shared';

const REPO = 'jonhilt/focus';

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

describe('the shortlist', () => {
  it('scores harm double, then distance, and breaks a tie with the smaller change', () => {
    expect(gapScore({ harm: 4, distance: 3 })).toBe(11);
    const tie = [{ gap: 'big', harm: 3, distance: 4, size: 'L' as const }, { gap: 'small', harm: 4, distance: 2, size: 'S' as const }];
    expect(ranked(tie).map((e) => e.gap)).toEqual(['small', 'big']);
  });
});

describe('climbHome', () => {
  const projects = [{ id: 'shop', repos: ['acme/shop'] }, { id: 'focus', repos: ['acme/api', REPO] }];

  it('is the project with Focus’s own repo', () => {
    expect(climbHome(projects, REPO, false)).toEqual({ projectId: 'focus', repo: REPO });
  });

  it('is nowhere when no project has it, except in the demo, which climbs its first repo', () => {
    expect(climbHome(projects, 'other/repo', false)).toBeUndefined();
    expect(climbHome(projects, undefined, true)).toEqual({ projectId: 'shop', repo: 'acme/shop' });
  });
});
