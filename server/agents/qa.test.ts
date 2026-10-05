import { describe, expect, it } from 'vitest';
import type { QaReport } from '../../shared/types';
import type { PullRequestDetail } from '../github/provider';
import { fixPrompt, parseQaReport, qaComment, qaPrompt, qaSystemAppend } from './qa';

const report = (r: Partial<QaReport> = {}): QaReport => ({
  verdict: 'pass',
  summary: 'Saving for later works and survives a reload.',
  checks: [{ name: 'Item moves to Saved for later', result: 'pass', details: 'Clicked "Save for later" on the cart' }],
  commands: [{ command: 'npm test', result: '42 passed' }],
  ...r,
});

const pr: PullRequestDetail = {
  number: 12,
  title: 'Save items for later',
  body: 'Adds a saved-for-later list.\n\nCloses #7',
  url: 'https://github.com/acme/shop/pull/12',
  branch: 'focus/7-save-for-later-ab12',
  baseBranch: 'main',
  headSha: 'abc1234def5678',
  author: 'jon',
  linkedIssues: [7],
};

describe('parseQaReport', () => {
  it('takes the SDK’s structured output', () => {
    expect(parseQaReport(report())).toEqual(report());
  });

  it('falls back to the last fenced JSON in the final message', () => {
    const text = `Done.\n\n\`\`\`json\n{"verdict":"fail","summary":"old"}\n\`\`\`\n\nFinal:\n\`\`\`json\n${JSON.stringify(report({ verdict: 'fail', fixInstructions: 'Handle the empty cart' }))}\n\`\`\``;
    const parsed = parseQaReport(undefined, text);
    expect(parsed?.verdict).toBe('fail');
    expect(parsed?.summary).toBe(report().summary);
    expect(parsed?.fixInstructions).toBe('Handle the empty cart');
  });

  it('reads bare JSON too', () => {
    expect(parseQaReport(null, `Here you go: ${JSON.stringify(report())}`)?.verdict).toBe('pass');
  });

  it('gives up without a valid verdict', () => {
    expect(parseQaReport({ verdict: 'maybe', summary: 'hmm' })).toBeNull();
    expect(parseQaReport(undefined, 'I ran out of time.')).toBeNull();
    expect(parseQaReport(undefined, '{not json')).toBeNull();
  });

  it('cleans up loose fields', () => {
    const parsed = parseQaReport({ verdict: 'pass', checks: [{ name: ' A ', result: 'weird' }, null, 'x'], commands: 'nope', fixInstructions: 'ignored on a pass' });
    expect(parsed).toEqual({ verdict: 'pass', summary: '', checks: [{ name: 'A', result: 'pass', details: '' }], commands: [], fixInstructions: undefined });
  });
});

describe('qaComment', () => {
  it('leads with the verdict, the tester and the commit', () => {
    const body = qaComment(report(), { officer: 'Lt. Varga', sha: 'abc1234def5678' });
    expect(body.split('\n')[0]).toBe('## 🔍 QA report: ✅ Passed');
    expect(body).toContain('Lt. Varga');
    expect(body).toContain('`abc1234`');
    expect(body).toContain('| ✅ | Item moves to Saved for later |');
    expect(body).not.toContain('What needs fixing');
  });

  it('adds the fix instructions on a fail', () => {
    const body = qaComment(report({ verdict: 'fail', fixInstructions: 'Guard the empty cart in cart.ts' }), { officer: 'Lt. Varga' });
    expect(body).toContain('❌ Failed');
    expect(body).toContain('### 🔧 What needs fixing\n\nGuard the empty cart in cart.ts');
  });

  it('keeps pipes and line breaks from breaking the table', () => {
    const body = qaComment(report({ checks: [{ name: 'a | b', result: 'fail', details: 'line 1\nline 2' }] }), { officer: 'X' });
    expect(body).toContain('| ❌ | a \\| b | line 1<br>line 2 |');
  });
});

describe('QA instructions', () => {
  it('include the project’s QA brief only when there is one', () => {
    expect(qaSystemAppend({ name: 'Lt. Varga' }, { name: 'Shop', qaBrief: '- Check the phone layout' }, pr, pr.headSha)).toContain('- Check the phone layout');
    expect(qaSystemAppend({ name: 'Lt. Varga' }, { name: 'Shop' }, pr, pr.headSha)).not.toContain('from the manager');
  });

  it('diff against the PR’s base and name the commit under test', () => {
    const text = qaSystemAppend({ name: 'Lt. Varga' }, { name: 'Shop' }, { ...pr, baseBranch: 'develop' }, pr.headSha);
    expect(text).toContain('git diff origin/develop...HEAD');
    expect(text).toContain('commit abc1234');
  });

  it('hand over the linked issues, or say there are none', () => {
    const issue = { repo: 'acme/shop', number: 7, title: 'Save for later', body: '- [ ] survives a reload', url: '', labels: [], createdAt: '', comments: [] };
    expect(qaPrompt('acme/shop', pr, [issue])).toContain('Linked issue #7: Save for later\n- [ ] survives a reload');
    expect(qaPrompt('acme/shop', pr, [])).toContain('No linked issue');
  });
});

const failed = report({
  verdict: 'fail',
  summary: 'The cart breaks when it is empty.',
  checks: [
    { name: 'Saves for later', result: 'pass', details: 'ok' },
    { name: 'Empty cart', result: 'fail', details: 'Page goes blank' },
  ],
  fixInstructions: 'Guard the empty cart in cart.ts',
});

describe('re-test', () => {
  it('tells QA last round’s findings and diffs from the commit it tested', () => {
    const text = qaPrompt('acme/shop', pr, [], { sha: 'fed9876543', report: failed });
    expect(text).toContain('Last round you failed it at commit fed9876');
    expect(text).toContain('- Empty cart: Page goes blank');
    expect(text).not.toContain('- Saves for later');
    expect(text).toContain('Guard the empty cart in cart.ts');
    expect(text).toContain('`git diff fed9876..HEAD`');
    expect(text).toContain('smoke test');
  });

  it('is a full review the first time round', () => {
    expect(qaPrompt('acme/shop', pr, [])).not.toContain('re-test');
  });
});

describe('fixPrompt', () => {
  it('hands the developer QA’s summary, failed checks and fix instructions', () => {
    const text = fixPrompt(pr, { sha: 'fed9876543', report: failed });
    expect(text.split('\n')[0]).toBe('QA failed pull request #12 (commit fed9876) and sent it back to you. Please fix it.');
    expect(text).toContain('The cart breaks when it is empty.');
    expect(text).toContain('- Empty cart: Page goes blank');
    expect(text).toContain('What needs fixing:\nGuard the empty cart in cart.ts');
    expect(text).toContain('`focus/7-save-for-later-ab12`');
  });
});
