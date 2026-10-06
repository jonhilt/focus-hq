import { describe, expect, it } from 'vitest';
import { goalEpicBody, issueRef, stepBody, stepLine, stepPrGone, stepPullRequest, stepState, trackStep } from './goals';
import { type Brief, EMPTY_BRIEF, type GoalStep, type PullRequest, type QaReport } from './types';

const step: GoalStep = { repo: 'acme/shop', number: 41, title: 'Save an item for later', url: 'u41', filedAt: 0 };
const pr = (number: number, more: Partial<PullRequest> = {}) => ({ repo: 'acme/shop', number, url: `u${number}`, branch: 'feature', closes: [], ...more }) as PullRequest;
const report = (verdict: QaReport['verdict'], summary: string) => ({ report: { verdict, summary } as QaReport });
const none = () => undefined;

describe('stepState', () => {
  it('is building until a PR turns up, then open, then whatever became of it', () => {
    expect(stepState(step)).toBe('building');
    expect(stepState({ ...step, pr: { number: 42, url: '' } })).toBe('open');
    expect(stepState({ ...step, pr: { number: 42, url: '' }, outcome: 'merged' })).toBe('merged');
    expect(stepState({ ...step, pr: { number: 42, url: '' }, outcome: 'closed' })).toBe('closed');
  });
});

describe('stepPullRequest', () => {
  it('finds the PR that closes the step’s issue, or sits on the branch the office cut for it', () => {
    expect(stepPullRequest(step, [pr(40), pr(42, { closes: [41] })])?.number).toBe(42);
    expect(stepPullRequest(step, [pr(43, { branch: 'focus/41-save-for-later-ab12' })])?.number).toBe(43);
  });

  it('ignores other repos, and branches for an issue whose number merely starts the same', () => {
    expect(stepPullRequest(step, [pr(42, { repo: 'acme/api', closes: [41] })])).toBeUndefined();
    expect(stepPullRequest(step, [pr(42, { branch: 'focus/410-other' })])).toBeUndefined();
  });

  it('sticks with the PR it already has', () => {
    expect(stepPullRequest({ ...step, pr: { number: 42, url: '' } }, [pr(43, { closes: [41] }), pr(42)])?.number).toBe(42);
  });
});

describe('trackStep', () => {
  it('picks up the PR once it’s on the board', () => {
    expect(trackStep(step, [pr(42, { closes: [41] })], none)).toEqual({ ...step, pr: { number: 42, url: 'u42' } });
  });

  it('keeps QA’s latest verdict on that PR', () => {
    const tracked = trackStep({ ...step, pr: { number: 42, url: 'u42' } }, [pr(42)], (n) => (n === 42 ? report('fail', 'Totals include saved items') : undefined));
    expect(tracked.qa).toEqual({ verdict: 'fail', summary: 'Totals include saved items' });
  });

  it('returns the same step when nothing changed, so the caller saves nothing', () => {
    const tracked = { ...step, pr: { number: 42, url: 'u42' }, qa: { verdict: 'pass' as const, summary: 'Works' } };
    expect(trackStep(tracked, [pr(42)], () => report('pass', 'Works'))).toBe(tracked);
    expect(trackStep(step, [pr(50)], none)).toBe(step);
  });

  it('keeps the verdict once the review has gone, and leaves a finished step alone', () => {
    const tracked = { ...step, pr: { number: 42, url: 'u42' }, qa: { verdict: 'pass' as const, summary: 'Works' } };
    expect(trackStep(tracked, [], none)).toBe(tracked);
    const merged = { ...tracked, outcome: 'merged' as const };
    expect(trackStep(merged, [pr(42)], () => report('fail', 'Late'))).toBe(merged);
  });
});

describe('stepPrGone', () => {
  it('is true only for a step whose open PR left the board', () => {
    const open = { ...step, pr: { number: 42, url: '' } };
    expect(stepPrGone(open, [])).toBe(true);
    expect(stepPrGone(open, [pr(42)])).toBe(false);
    expect(stepPrGone(open, [pr(42, { repo: 'acme/api' })])).toBe(true);
    expect(stepPrGone(step, [])).toBe(false);
    expect(stepPrGone({ ...open, outcome: 'merged' }, [])).toBe(false);
  });
});

describe('stepLine', () => {
  it('says what the step was and how it went', () => {
    expect(stepLine(step, 0)).toBe('Step 1: acme/shop#41 “Save an item for later”, no PR yet');
    expect(stepLine({ ...step, pr: { number: 42, url: '' }, outcome: 'merged', qa: { verdict: 'pass', summary: 'Works on a phone' } }, 1)).toBe(
      'Step 2: acme/shop#41 “Save an item for later”, PR #42 merged; QA passed it: Works on a phone',
    );
  });
});

describe('goalEpicBody', () => {
  const brief: Brief = {
    ...EMPTY_BRIEF,
    summary: 'Shoppers can save items for later',
    why: 'Shoppers lose track of things they meant to buy.',
    who: 'Returning shoppers.',
    acceptance: ['A saved item is still there next visit'],
    openQuestions: ['Can the cart model hold it?'],
    scope: ['Never shown'],
  };

  it('holds the destination and the unknowns, and no plan', () => {
    const body = goalEpicBody(brief, 'save for later');
    expect(body).toContain('## Goal\n\nShoppers can save items for later');
    expect(body).toContain('Shoppers lose track of things they meant to buy. It\'s for returning shoppers.');
    expect(body).toContain('## Done when\n\n- [ ] A saved item is still there next visit');
    expect(body).toContain('## Unknowns\n\n- Can the cart model hold it?');
    expect(body).not.toContain('Never shown');
  });

  it('falls back on the idea, and leaves out what wasn’t agreed', () => {
    const body = goalEpicBody(EMPTY_BRIEF, 'save for later');
    expect(body).toMatch(/^## Goal\n\nsave for later\n\n---/);
  });
});

describe('stepBody and issueRef', () => {
  const epic = { repo: 'acme/shop', number: 40, title: 'Save for later', url: '' };

  it('links each step to its goal, briefly within the repo and in full from another', () => {
    expect(stepBody('## Testing\n\nx\n', epic, 'acme/shop', 2)).toBe('Step 2 toward #40: Save for later\n\n## Testing\n\nx');
    expect(stepBody('body', epic, 'acme/api', 1)).toBe('Step 1 toward acme/shop#40: Save for later\n\nbody');
    expect(issueRef(epic)).toBe('acme/shop#40');
  });
});
