import { describe, expect, it } from 'vitest';
import { autoQaFor, autoSendBackFor, filesCovered, pullUrl, qaBadge, qaProofFor, qaVideoFor, sameCommit, spotCheckUrl, verdictBehindHead } from './qa';
import type { QaReport, QaReview } from './types';

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
    expect(qaBadge(review(), { headSha: 'abc1234def5678' })).toEqual({ state: 'passed', label: 'QA passed' });
    expect(qaBadge(review({ status: 'failed' }), { headSha: 'abc1234def5678' })).toEqual({ state: 'failed', label: 'QA failed' });
  });

  it('says a pass came with advice: QA failed it, but no proof held', () => {
    const report: QaReport = { verdict: 'pass', advisory: true, summary: '', checks: [], commands: [], captions: [] };
    expect(qaBadge(review({ report }), { headSha: 'abc1234def5678' })).toEqual({ state: 'passed', label: 'QA passed with advice' });
  });

  it('marks a verdict on an older commit stale, whichever way it went', () => {
    expect(qaBadge(review(), { headSha: 'fff0000aaa' }).state).toBe('stale');
    expect(qaBadge(review({ status: 'failed' }), { headSha: 'fff0000aaa' })).toEqual({ state: 'stale', label: 'QA failed an older commit' });
  });

  it('says while the operations officer looks into a stuck PR', () => {
    const triaging = review({ status: 'failed', followUp: { kind: 'triaging', officer: 'Lt. Varga', activity: 'Reading the diff' } });
    expect(qaBadge(triaging, { headSha: 'abc1234def5678' })).toEqual({ state: 'triaging', label: 'Lt. Varga is looking' });
  });

  it('says who a failed PR went back to, or that it needs you', () => {
    const fixing = review({ status: 'failed', followUp: { kind: 'fixing', agentId: 'a1', agentName: 'Ada', fixes: { kind: 'qa' } } });
    expect(qaBadge(fixing, { headSha: 'abc1234def5678' })).toEqual({ state: 'fixing', label: 'QA failed: back with Ada' });
    const stuck = review({ status: 'failed', followUp: { kind: 'needs-you', reason: 'it failed QA 3 times' } });
    expect(qaBadge(stuck, { headSha: 'abc1234def5678' })).toEqual({ state: 'needs-you', label: 'QA failed: needs you' });
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

  it('says QA ended without a verdict, for the captain, when the reviewer’s session was over with none', () => {
    expect(qaBadge(review({ status: 'error', noVerdict: true, error: 'Finished without a QA report.' }), { headSha: 'x' })).toEqual({ state: 'needs-you', label: 'QA ended without a verdict' });
  });

  it('says QA couldn’t finish for any other end without a verdict: stopped, shut down, an error', () => {
    for (const error of ['Stopped by the captain', 'Interrupted when Focus shut down. Send it to QA again.', 'Credit balance is too low']) {
      expect(qaBadge(review({ status: 'error', error }), { headSha: 'x' })).toEqual({ state: 'error', label: 'QA couldn’t finish' });
    }
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

describe('spot-check links', () => {
  it('open the pull request’s changed files at the file and line, or just its changed files for an older one', () => {
    const pr = pullUrl('acme/shop', 9);
    expect(pr).toBe('https://github.com/acme/shop/pull/9');
    expect(spotCheckUrl(pr, { anchor: 'diff-abcR12' })).toBe('https://github.com/acme/shop/pull/9/files#diff-abcR12');
    expect(spotCheckUrl(pr, {})).toBe('https://github.com/acme/shop/pull/9/files');
  });
});

describe('filesCovered', () => {
  const report = (files: QaReport['files']): QaReport => ({ verdict: 'pass', summary: '', checks: [], commands: [], captions: [], files });
  const files = [
    { file: 'server/gate.ts', tests: 'gate.test.ts', checked: 'read it' },
    { file: 'scripts/plant.ts', tests: 'None', checked: 'read it' },
    { file: 'docs/qa.md', tests: 'none', checked: 'read it' },
  ];
  it('puts untested code QA never opened first and what needn’t be opened last, and counts the gaps', () => {
    const c = filesCovered(report(files), { changed: ['docs/qa.md', 'server/gate.ts', 'scripts/plant.ts', 'shared/x.json'], opened: ['server/gate.ts'], sentBack: 1 });
    expect(c?.rows.map((r) => [r.file, r.opened, r.untested])).toEqual([
      ['scripts/plant.ts', 'no', true],
      ['shared/x.json', 'no', true],
      ['server/gate.ts', 'yes', false],
      ['docs/qa.md', 'na', false],
    ]);
    expect(c).toMatchObject({ evidence: true, code: 3, opened: 1, untested: 2, missing: 1, sentBack: 1 });
  });

  it('says opened is unknown without the evidence, takes the report’s files when Ops has none, and is undefined with no files', () => {
    const c = filesCovered(report(files), undefined);
    expect(c?.evidence).toBe(false);
    expect(c?.rows.map((r) => r.opened)).toEqual(['unknown', 'unknown', 'na']);
    expect(filesCovered(report(undefined), { changed: [] })).toBeUndefined();
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
