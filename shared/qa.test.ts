import { describe, expect, it } from 'vitest';
import { autoQaFor, autoSendBackFor, qaBadge, sameCommit } from './qa';
import type { QaReview } from './types';

const review = (r: Partial<QaReview> = {}): QaReview => ({
  projectId: 'p',
  repo: 'acme/shop',
  number: 12,
  title: 'Save for later',
  status: 'passed',
  sha: 'abc1234def5678',
  requestedAt: 0,
  ...r,
});

describe('qaBadge', () => {
  it('says not tested when QA never looked at the PR', () => {
    expect(qaBadge(undefined, { headSha: 'abc1234' }).state).toBe('none');
  });

  it('shows a verdict on the PR’s head commit', () => {
    expect(qaBadge(review(), { headSha: 'abc1234def5678' })).toEqual({ state: 'passed', label: '✅ QA passed' });
    expect(qaBadge(review({ status: 'failed' }), { headSha: 'abc1234def5678' })).toEqual({ state: 'failed', label: '❌ QA failed' });
  });

  it('marks a verdict on an older commit stale, whichever way it went', () => {
    expect(qaBadge(review(), { headSha: 'fff0000aaa' }).state).toBe('stale');
    expect(qaBadge(review({ status: 'failed' }), { headSha: 'fff0000aaa' })).toEqual({ state: 'stale', label: 'QA failed an older commit' });
  });

  it('says who a failed PR went back to, or that it needs you', () => {
    const fixing = review({ status: 'failed', followUp: { kind: 'fixing', agentId: 'a1', agentName: 'Ada' } });
    expect(qaBadge(fixing, { headSha: 'abc1234def5678' })).toEqual({ state: 'fixing', label: '🔧 QA failed: back with Ada' });
    const stuck = review({ status: 'failed', followUp: { kind: 'needs-you', reason: 'it failed QA 3 times' } });
    expect(qaBadge(stuck, { headSha: 'abc1234def5678' })).toEqual({ state: 'needs-you', label: '🙋 QA failed: needs you' });
  });

  it('trusts the verdict when either side doesn’t know the commit', () => {
    expect(qaBadge(review({ sha: undefined }), { headSha: 'fff0000aaa' }).state).toBe('passed');
    expect(qaBadge(review(), { headSha: undefined }).state).toBe('passed');
  });

  it('shows queued, testing and errors as they are', () => {
    expect(qaBadge(review({ status: 'queued' }), { headSha: 'x' }).state).toBe('queued');
    expect(qaBadge(review({ status: 'testing' }), { headSha: 'x' }).state).toBe('testing');
    expect(qaBadge(review({ status: 'error' }), { headSha: 'x' }).state).toBe('error');
  });
});

describe('sameCommit', () => {
  it('matches a short SHA against the full one, ignoring case', () => {
    expect(sameCommit('ABC1234', 'abc1234def5678')).toBe(true);
    expect(sameCommit('abc1234def5678', 'abc1234def5678')).toBe(true);
  });

  it('refuses prefixes too short to mean anything', () => {
    expect(sameCommit('abc', 'abcdef0123')).toBe(false);
  });

  it('tells different commits apart', () => {
    expect(sameCommit('abc1234', 'abc1235')).toBe(false);
  });
});

describe('autoQaFor', () => {
  it('is on unless the project switched it off', () => {
    expect(autoQaFor({})).toBe(true);
    expect(autoQaFor({ autoQa: true })).toBe(true);
    expect(autoQaFor({ autoQa: false })).toBe(false);
  });
});

describe('autoSendBackFor', () => {
  it('is on unless the project switched it off', () => {
    expect(autoSendBackFor({})).toBe(true);
    expect(autoSendBackFor({ autoSendBack: false })).toBe(false);
  });
});
