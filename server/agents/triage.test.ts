import { describe, expect, it } from 'vitest';
import type { PullRequestDetail } from '../github/provider';
import { parseTriage, triagePrompt, triageSystemPrompt } from './triage';

const pr: PullRequestDetail = {
  number: 12,
  title: 'Save items for later',
  body: 'Adds a saved-for-later list.\n\nCloses #7',
  url: 'https://github.com/acme/shop/pull/12',
  branch: 'focus/7-save-for-later-ab12',
  baseBranch: 'main',
  headSha: 'abc1234def5678',
  linkedIssues: [7],
};

const report = (summary: string) => ({ verdict: 'fail' as const, summary, checks: [{ name: 'Empty cart', result: 'fail' as const, details: 'Page goes blank' }], commands: [], captions: [] });

describe('parseTriage', () => {
  it('takes one of the five actions with a note', () => {
    expect(parseTriage({ action: 'retry-qa', note: ' QA tested the old build ' })).toEqual({ action: 'retry-qa', note: 'QA tested the old build' });
  });

  it('rejects anything else, so the PR goes to the manager', () => {
    expect(parseTriage({ action: 'merge', note: 'looks fine' })).toBeNull();
    expect(parseTriage({ action: 'close', note: '  ' })).toBeNull();
    expect(parseTriage(undefined)).toBeNull();
  });
});

describe('triage prompts', () => {
  const req = {
    repo: 'acme/shop',
    pr,
    reason: 'it failed QA 3 times',
    review: { sha: 'fed9876543', failedRounds: 3, report: report('Still blank when empty.'), lastRound: { sha: '0123456789', report: report('Blank when empty.') } },
    checks: [{ name: 'CI / e2e', url: 'https://github.com/acme/shop/actions/runs/77/job/2', runId: 77 }],
    diff: '+ if (!items) return [];',
    issues: [{ repo: 'acme/shop', number: 7, title: 'Save for later', body: '- [ ] survives a reload', url: '', labels: [], createdAt: '', comments: [] }],
  };

  it('name the officer and all five actions', () => {
    const text = triageSystemPrompt({ officer: { name: 'Lt. Haddad', avatar: {} as never }, projectName: 'Shop', pr });
    expect(text).toContain('# You are Lt. Haddad, operations officer for Shop');
    for (const action of ['retry-qa', 'send-back', 'rerun-checks', 'close', 'escalate']) expect(text).toContain(`\`${action}\``);
  });

  it('hand over why it is stuck, both QA rounds, the checks, the issue and the diff', () => {
    const text = triagePrompt(req);
    expect(text).toContain('Pull request #12 in acme/shop is stuck: it failed QA 3 times.');
    expect(text).toContain("QA's latest report (fail, commit fed9876):\nStill blank when empty.");
    expect(text).toContain('The round before (fail, commit 0123456):\nBlank when empty.');
    expect(text).toContain("GitHub's failing checks:\n- CI / e2e (https://github.com/acme/shop/actions/runs/77/job/2)");
    expect(text).toContain('Issue #7: Save for later');
    expect(text).toContain('+ if (!items) return [];');
    expect(text).not.toContain('looked at it once before');
  });

  it('remind the officer what they tried last time', () => {
    const text = triagePrompt({ ...req, review: { ...req.review, triage: { officer: 'Lt. Haddad', action: 'retry-qa', note: 'QA ran the old build', at: 0 } } });
    expect(text).toContain('You looked at it once before and chose retry-qa: QA ran the old build');
  });
});
