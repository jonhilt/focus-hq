import { describe, expect, it } from 'vitest';
import { autoQaFor, autoSendBackFor, qaProofFor, qaVideoFor, verdictBehindHead } from './qaRules';
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

describe('qaProofFor', () => {
  it('blocks only with proof unless the project switched it off', () => {
    expect(qaProofFor({})).toBe(true);
    expect(qaProofFor({ qaProof: false })).toBe(false);
  });
});

describe('qaVideoFor', () => {
  it('records QA’s browser only once the project switched it on', () => {
    expect(qaVideoFor({})).toBe(false);
    expect(qaVideoFor({ qaVideo: true })).toBe(true);
  });
});

describe('verdictBehindHead', () => {
  const ctx = { ours: true, autoQa: true };
  const moved = { headSha: 'fff0000aaa111' };

  it('sends Ops’ PR back to QA when its head moved past either verdict', () => {
    expect(verdictBehindHead(review(), moved, ctx)).toBe(true);
    expect(verdictBehindHead(review({ status: 'failed', followUp: { kind: 'needs-you', reason: 'stuck' } }), moved, ctx)).toBe(true);
  });

  it('leaves it when QA already has the head, or nothing to compare', () => {
    expect(verdictBehindHead(review(), { headSha: 'abc1234' }, ctx)).toBe(false);
    expect(verdictBehindHead(review({ sha: undefined }), moved, ctx)).toBe(false);
    expect(verdictBehindHead(review(), { headSha: '' }, ctx)).toBe(false);
    expect(verdictBehindHead(undefined, moved, ctx)).toBe(false);
  });

  it('leaves a teammate’s PR, a project without auto-QA, and a review under way or with an error', () => {
    expect(verdictBehindHead(review(), moved, { ...ctx, ours: false })).toBe(false);
    expect(verdictBehindHead(review(), moved, { ...ctx, autoQa: false })).toBe(false);
    for (const status of ['queued', 'testing', 'error'] as const) expect(verdictBehindHead(review({ status }), moved, ctx)).toBe(false);
  });

  it('leaves it to whoever is fixing it, or the operations officer looking, to hand back', () => {
    const fixes = { kind: 'qa' } as const;
    expect(verdictBehindHead(review({ status: 'failed', followUp: { kind: 'fixing', agentId: 'a', agentName: 'Ensign Ro', fixes } }), moved, ctx)).toBe(false);
    expect(verdictBehindHead(review({ status: 'failed', followUp: { kind: 'triaging', officer: 'Lt. Kim', activity: 'Reading' } }), moved, ctx)).toBe(false);
  });
});
