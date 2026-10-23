import { describe, expect, it } from 'vitest';
import { leadSystemAppend } from './lead';
import { qaPlaybook } from './qa';
import { LANES, raisedSaid } from '../../shared/mergeLane';
import { type MergeTrial, mergeVerdict, refusalComment } from '../../shared/mergeCheck';
import { stuckClosedComment } from '../../shared/triage';
import { leadPrBody } from './lead';
import { plannerSystemPrompt } from './planner';
import { pullRequestBody } from './prompts';
import { qaComment } from './qa';
import { recapMarkdown } from './recap';
import { carriedComment } from './retest';
import { triageSystemPrompt } from './triage';
import { PUBLIC_WORDS_RULE, SHIP_WORDS } from '../../shared/wording';

describe('PUBLIC_WORDS_RULE', () => {
  it("keeps the ship's terms for people out of what others read", () => {
    expect(PUBLIC_WORDS_RULE).toContain('pull request');
    expect(PUBLIC_WORDS_RULE).toContain('never "the captain"');
  });

  it('is in QA’s and the leads’ prompts', () => {
    expect(qaPlaybook('Odo', { name: 'Shop', repos: ['acme/shop'] }, []).prompt).toContain(PUBLIC_WORDS_RULE);
    expect(leadSystemAppend({ name: 'Ivanova' }, 'Shop', 0)).toContain(PUBLIC_WORDS_RULE);
  });

  it('is in the prompts of whoever writes issues or a closing comment: the planner and triage', () => {
    const officer = { name: 'Lt. Haddad', avatar: {} as never };
    expect(plannerSystemPrompt({ planner: officer, projectName: 'Shop', repos: ['acme/shop'] })).toContain(PUBLIC_WORDS_RULE);
    expect(triageSystemPrompt({ officer, projectName: 'Shop', pr: { number: 12 } as never })).toContain(PUBLIC_WORDS_RULE);
  });
});

describe('what Ops itself writes on GitHub', () => {
  const trials: MergeTrial[] = [
    { kind: 'checked', base: 'b1', head: 'h1', merge: 'm1', results: [{ command: 'pnpm test', ok: false, output: '1 failed' }] },
    { kind: 'conflicts', base: 'b1', head: 'h1', files: ['a.ts'] },
    { kind: 'broken', reason: 'git fetch failed' },
  ];
  const recap = { primitives: [{ id: 'cart', group: 'shop', impact: 'adds' as const, change: 'new', paths: ['a.ts'] }], map: [{ from: 'cart', to: 'api', label: 'saves', backed: false }] };
  const report = {
    verdict: 'fail' as const, advisory: true, summary: 'Saving breaks.', checks: [], commands: [], captions: [], fixInstructions: 'Fix it.',
    proofs: [{ finding: 'Saving breaks', kind: 'test' as const, file: 'a.test.ts', command: 'pnpm test', outcome: 'passed' as const }],
  };
  const texts = [
    ...LANES.flatMap((from) => LANES.map((to) => raisedSaid(from, to))),
    ...LANES.map((lane) => recapMarkdown({ ...recap, lane })),
    recapMarkdown(recap),
    ...trials.map((t) => { const v = mergeVerdict(t); return refusalComment(t, v.kind === 'refuse' ? v.reason : ''); }),
    qaComment(report, { officer: 'Odo', sha: 'abc1234' }, [], false),
    carriedComment('main', 'abc1234', 'def5678', ['pnpm test']),
    stuckClosedComment('the approach can’t work.', [7]),
    leadPrBody('Adds saving.', { name: 'Ivanova' }, ['acme/api'], false),
    pullRequestBody({ name: 'Ada', issue: { number: 7 } }, 'Adds saving.', false),
  ];

  it.each(texts.map((t, i) => [i, t]))('keeps the ship’s words out (%i)', (_, text) => {
    expect(text).not.toMatch(SHIP_WORDS);
  });
});
