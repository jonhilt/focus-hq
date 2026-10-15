import { describe, expect, it } from 'vitest';
import type { LedgerEvent } from '../../shared/ledger';
import type { Agent } from '../../shared/types';
import type { Scorecard } from '../scorecard/types';
import type { PastPullRequest } from '../../server/github/provider';
import { freshClimb, type Climb } from './shared';
import { climbBrief, climbHome, climbLog, climbLogText, climbPullRequest, climbStep, climbTarget, gapScore, openRetroIssues, ownWords, ranked, section, shortlistOf } from './climb';

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

const pr = (over: Partial<PastPullRequest>): PastPullRequest => ({
  number: 1, title: 'A climb', body: '', url: 'u', branch: 'focus/climb-aaaaaa', state: 'MERGED', createdAt: '2026-10-01T10:00:00Z', closedAt: '2026-10-01T12:00:00Z', comments: [], ...over,
});

describe('reading a climb’s pull request', () => {
  const body = '## Hypothesis\nThe board’s lookups assert six times.\nTarget: `fence.nonNull` 130 → 124\n\n**Problem**\nSix `x!`.\n\n**Solution**\nNarrow.';

  it('finds a section by its heading, in either style the climbers wrote', () => {
    expect(section(body, 'Hypothesis')).toBe('The board’s lookups assert six times.\nTarget: `fence.nonNull` 130 → 124');
    expect(section(body, 'Problem')).toBe('Six `x!`.');
    expect(section(body, 'After')).toBeUndefined();
  });

  it('reads the target line, with or without code marks and thousands separators', () => {
    expect(climbTarget(body)).toEqual({ key: 'fence.nonNull', before: 130, after: 124 });
    expect(climbTarget('Target: tests.total 1,150 -> 1,162')).toEqual({ key: 'tests.total', before: 1150, after: 1162 });
    expect(climbTarget('Target: none, the scorecard can’t see it')).toBeUndefined();
  });

  it('keeps the captain’s own words, not the office’s reports posted from the same account, nor a bot’s', () => {
    const comments = [
      { author: 'jonhilt', body: '## 🔍 QA report: ✅ Passed\nAll good.' },
      { author: 'jonhilt', body: '🧭 Lt. Abara, the Focus office’s operations officer, closed this pull request: stuck.' },
      { author: 'qodo-code-review', body: '<!-- qodo:billing-blocked -->\nTrial ended.' },
      { author: 'someone-bot', body: 'Beep.' },
      { author: 'jonhilt', body: 'Not this: the fence matters less than the gate’s time right now.' },
    ];
    expect(ownWords(comments, 'jonhilt')).toEqual(['Not this: the fence matters less than the gate’s time right now.']);
    expect(ownWords(comments, undefined)).toEqual(['Not this: the fence matters less than the gate’s time right now.']);
  });
});

describe('the shortlist', () => {
  const body = [
    '**Shortlist**',
    '| # | Gap | Harm | Distance | Size | Score |',
    '|---|---|:-:|:-:|---|---|',
    '| 1 | Ledger counts merges twice | 4 | 3 | S | 11 |',
    '| 2 | Test the merge loop | 3 | 4 | L | 10 |',
    '| 3 | Narrow the board | 2 | 3 | small | 7 |',
    '| 4 | Not scored | ? | 3 | S | ? |',
    '',
    '**Hypothesis**',
    'Fewer merges counted.',
  ].join('\n');

  it('scores harm double, then distance, and breaks a tie with the smaller change', () => {
    expect(gapScore({ harm: 4, distance: 3 })).toBe(11);
    const tie = [{ gap: 'big', harm: 3, distance: 4, size: 'L' as const }, { gap: 'small', harm: 4, distance: 2, size: 'S' as const }];
    expect(ranked(tie).map((e) => e.gap)).toEqual(['small', 'big']);
  });

  it('reads the table from a pull request, best first, skipping a row it can’t score', () => {
    expect(shortlistOf(body)).toEqual([
      { gap: 'Ledger counts merges twice', harm: 4, distance: 3, size: 'S' },
      { gap: 'Test the merge loop', harm: 3, distance: 4, size: 'L' },
      { gap: 'Narrow the board', harm: 2, distance: 3, size: 'S' },
    ]);
    expect(shortlistOf('**Problem**\nNo table here.')).toEqual([]);
  });

  it('puts what a climb passed over in the log, so the next one sees the runners-up', () => {
    const [record] = climbLog([pr({ number: 12, body })], [], 'jonhilt');
    expect(record.passedOver?.map((e) => e.gap)).toEqual(['Test the merge loop', 'Narrow the board']);
    expect(climbLogText([record])).toContain('Passed over: Test the merge loop (10); Narrow the board (7)');
  });

  it('asks for the scored table before the choice, and scores a turned-down gap with nothing new at no harm', () => {
    const brief = climbBrief({ repo: REPO, baseBranch: 'main', branch: 'focus/climb-x' }, [], 0);
    expect(brief).toContain('Score = 2 × Harm + Distance');
    expect(brief).toContain('`| # | Gap | Harm | Distance | Size | Score |`');
    expect(brief).toContain('A gap a closed climb took, with nothing changed since, scores Harm 0.');
  });
});

describe('climbLog', () => {
  const metric = (value: number) => ({ section: 'fence' as const, key: 'fence.nonNull', label: 'Non-null assertions (x!)', value, better: 'lower' as const, format: 'count' as const });
  const main = (at: number, value: number, over: Partial<Scorecard> = {}): Scorecard => ({ v: 1, at, commit: `c${at}`, branch: 'main', dirty: false, metrics: [metric(value)], frictions: [], notes: [], ...over });
  const merged = pr({ number: 7, title: 'Narrow the board’s lookups', body: '**Hypothesis**\nSix asserts go.\nTarget: fence.nonNull 130 → 124' });
  const mergedAt = Date.parse('2026-10-01T12:00:00Z');

  it('lists every climb newest first: pull requests in any state, and the climbs that ended without one', () => {
    const closed = pr({ number: 9, state: 'CLOSED', closedAt: '2026-10-03T00:00:00Z', comments: [{ author: 'jonhilt', body: 'Wrong gap.' }] });
    const log = climbLog([closed, merged], [{ at: Date.parse('2026-10-02T00:00:00Z'), outcome: 'nothing', why: 'The last climb found nothing to change' }], 'jonhilt');
    expect(log.map((r) => [r.pr, r.outcome])).toEqual([[9, 'closed'], [undefined, 'nothing'], [7, 'merged']]);
    expect(log[0].words).toEqual(['Wrong gap.']);
    expect(log[2]).toMatchObject({ hypothesis: 'Six asserts go. Target: fence.nonNull 130 → 124', target: { key: 'fence.nonNull', after: 124 } });
  });

  it('falls back to the problem for a climb from before hypotheses', () => {
    expect(climbLog([pr({ body: '**Problem**\nThe gate is red.\n\n**Solution**\nFix.' })], [], 'jonhilt')[0].hypothesis).toBe('The gate is red.');
  });

  it('says whether a merged gain has held on main, from clean main scorecards measured after it merged', () => {
    const held = climbLog([merged], [], 'jonhilt', [main(mergedAt - 1, 140), main(mergedAt + 1, 124)])[0];
    expect(held.since).toMatchObject({ held: true, now: 124 });
    const slipped = climbLog([merged], [], 'jonhilt', [main(mergedAt + 1, 124), main(mergedAt + 2, 129)])[0];
    expect(slipped.since).toMatchObject({ held: false, now: 129 });
    // nothing measured on main since, or only a branch or uncommitted changes: nothing to say yet
    expect(climbLog([merged], [], 'jonhilt', [main(mergedAt - 1, 129), main(mergedAt + 1, 129, { branch: 'x' }), main(mergedAt + 2, 129, { dirty: true })])[0].since).toBeUndefined();
  });
});

describe('the brief’s memory', () => {
  const agent = { repo: REPO, baseBranch: 'main', branch: 'focus/climb-abc123' };

  it('lists past climbs with the captain’s words, and asks for a hypothesis with a target before any change', () => {
    const log = climbLog([pr({ number: 9, title: 'Split the manager', state: 'CLOSED', comments: [{ author: 'jonhilt', body: 'Too big to review.' }] })], [], 'jonhilt');
    const brief = climbBrief(agent, [], 2000, log);
    expect(brief).toContain('#9 Split the manager (CLOSED UNMERGED by the captain)');
    expect(brief).toContain('The captain said: “Too big to review.”');
    expect(brief).toContain("don't take its gap again unless your **Hypothesis** says what has changed since");
    expect(brief).toContain('`Target: <metric key> <before> → <expected after>`');
    expect(brief.indexOf('## Hypothesis')).toBeLessThan(brief.indexOf('## 3. Fix'));
  });

  it('gives the noise floor when there is one, and how to take one when there isn’t', () => {
    const noise = { v: 1 as const, at: 0, commit: 'abcdef123', runs: 5, spread: { 'gate.seconds': { min: 100, max: 118.2 }, 'fence.nonNull': { min: 130, max: 130 } } };
    expect(climbBrief(agent, [], 2000, [], noise)).toContain('noise floor of 5 runs on abcdef12, and marks a change ▲ or ▼ only past it. Claim a gain only where it does. What wobbled: gate.seconds ±9.1.');
    expect(climbBrief(agent, [], 2000)).toContain('`pnpm run scorecard --repeat 3 --no-save`');
    expect(climbBrief(agent, [], 2000)).toContain('This is your first climb.');
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
