import { describe, expect, it } from 'vitest';
import { carryMergeable } from './board';
import type { PullRequest } from './types';

const pr = (mergeable: PullRequest['mergeable'], over: Partial<PullRequest> = {}): PullRequest => ({
  repo: 'acme/shop',
  number: 7,
  title: 'Fix checkout',
  url: 'https://github.com/acme/shop/pull/7',
  branch: 'focus/7-fix-checkout',
  headSha: 'abc123',
  baseBranch: 'main',
  isDraft: false,
  mergeable,
  checks: 'passing',
  failedChecks: [],
  closes: [],
  createdAt: '2026-01-07T00:00:00Z',
  ...over,
});

describe('carryMergeable', () => {
  it('keeps the last definite answer while GitHub says UNKNOWN on the same commit and base', () => {
    expect(carryMergeable([pr('CONFLICTING')], [pr('UNKNOWN')])[0].mergeable).toBe('CONFLICTING');
    expect(carryMergeable([pr('MERGEABLE')], [pr('UNKNOWN')])[0].mergeable).toBe('MERGEABLE');
  });

  it('lets UNKNOWN stand once the head commit or base branch has moved', () => {
    expect(carryMergeable([pr('CONFLICTING')], [pr('UNKNOWN', { headSha: 'def456' })])[0].mergeable).toBe('UNKNOWN');
    expect(carryMergeable([pr('CONFLICTING')], [pr('UNKNOWN', { baseBranch: 'develop' })])[0].mergeable).toBe('UNKNOWN');
  });

  it('takes a definite answer from GitHub over the previous one', () => {
    expect(carryMergeable([pr('CONFLICTING')], [pr('MERGEABLE')])[0].mergeable).toBe('MERGEABLE');
    expect(carryMergeable([pr('MERGEABLE')], [pr('CONFLICTING')])[0].mergeable).toBe('CONFLICTING');
  });

  it('leaves UNKNOWN for a new PR or one with no definite answer yet', () => {
    expect(carryMergeable([], [pr('UNKNOWN')])[0].mergeable).toBe('UNKNOWN');
    expect(carryMergeable([pr('CONFLICTING', { number: 8 })], [pr('UNKNOWN')])[0].mergeable).toBe('UNKNOWN');
    expect(carryMergeable([pr('CONFLICTING', { repo: 'acme/api' })], [pr('UNKNOWN')])[0].mergeable).toBe('UNKNOWN');
    expect(carryMergeable([pr('UNKNOWN')], [pr('UNKNOWN')])[0].mergeable).toBe('UNKNOWN');
  });
});
