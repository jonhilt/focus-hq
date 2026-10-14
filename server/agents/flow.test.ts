import { describe, expect, it } from 'vitest';
import type { LedgerEvent } from '../../shared/ledger';
import type { ArchivedGoal } from '../../shared/types';
import { endsWith, flowLines, flowReport, goalFlow, LONG_WAIT_MS, percentile, span, transcriptMoments } from './flow';

const T0 = Date.parse('2026-10-08T12:00:00.000Z');
const min = (m: number) => T0 + m * 60_000;
let n = 0;
const line = (type: string, content: unknown, minute: number, extra: object = {}) =>
  JSON.stringify({ type, uuid: `u${++n}`, timestamp: new Date(min(minute)).toISOString(), message: { role: type, content }, ...extra });
const said = (text: string, minute: number) => line('user', text, minute);
const work = (minute: number) => line('assistant', [{ type: 'text', text: 'working on it' }], minute);
const ship = (id: string, minute: number) => line('assistant', [{ type: 'tool_use', id, name: 'mcp__office__ship', input: { title: 't' } }], minute);
const shipped = (id: string, text: string, minute: number, is_error = false) => line('user', [{ type: 'tool_result', tool_use_id: id, is_error, content: [{ type: 'text', text }] }], minute);

let seq = 0;
const ev = (e: object, minute: number) => ({ ...e, at: min(minute), projectId: 'p', seq: ++seq }) as LedgerEvent;
const verdict = (v: 'pass' | 'fail', minute: number) => ev({ kind: 'qa-verdict', repo: 'o/r', pr: 1, verdict: v, reviewer: 'Lt. Q', checks: { pass: 1, fail: v === 'fail' ? 1 : 0, skip: 0 }, failedRounds: 0 }, minute);
const merged = (minute: number, qa = 'passed') => ev({ kind: 'merged', repo: 'o/r', pr: 1, by: 'captain', qa, failedRounds: 0, triages: 0 }, minute);

const goal = (closeMinute: number, openMinute = 0): ArchivedGoal => ({
  id: 'lead_p_1',
  title: 'Faster goals',
  slices: 1,
  prs: [{ repo: 'o/r', number: 1, url: 'u', outcome: 'merged', slice: 1 }],
  leadName: 'Lt. L',
  sessionId: 's',
  openedAt: min(openMinute),
  closedAt: min(closeMinute),
  projectId: 'p',
});

/** A slice from brief to merge: work, ship, QA fails, rework, ship again, QA passes, a merge, the captain, background work. */
const story = () => {
  n = 0;
  return [
    said('Your workspace, with every repo of the project checked out side by side', 0),
    work(5),
    ship('s1', 9),
    shipped('s1', 'Opened o/r#1: https://github.com/o/r/pull/1', 10),
    work(11),
    said('[QA officer Lt. Q] QA failed o/r#1: the tests fail', 20),
    work(23),
    ship('s2', 24),
    shipped('s2', 'Updated o/r#1', 25),
    work(26),
    said('[QA officer Lt. Q] QA passed o/r#1', 30),
    work(31),
    said('looks great, merged it. Can you make the doors quieter?', 50),
    line('user', 'This session is being continued from a previous conversation', 52),
    work(55),
    said('<task-notification>\n<task-id>w1</task-id>', 60),
    work(62),
  ].join('\n');
};
const ledger = () => [verdict('fail', 20), verdict('pass', 30), merged(40)];

describe('transcriptMoments', () => {
  it('reads who started each turn, the lead at work, and the pull requests each ship opened', () => {
    const moments = transcriptMoments(story());
    expect(moments.filter((m) => m.kind === 'message').map((m) => m.kind === 'message' && m.from)).toEqual(['office', 'office', 'office', 'captain', 'background']);
    expect(moments.filter((m) => m.kind === 'ship')).toEqual([
      { at: min(10), kind: 'ship', prs: [{ repo: 'o/r', pr: 1 }] },
      { at: min(25), kind: 'ship', prs: [{ repo: 'o/r', pr: 1 }] },
    ]);
  });

  it('counts a ship that failed as the lead at work, and skips the harness’s own messages and lines without a time', () => {
    n = 0;
    const jsonl = [ship('s1', 1), shipped('s1', 'Could not push o/r#1', 2, true), said('<system-reminder>hi</system-reminder>', 3), JSON.stringify({ type: 'user', message: { content: 'no time' } })].join('\n');
    expect(transcriptMoments(jsonl)).toEqual([
      { at: min(1), kind: 'activity' },
      { at: min(2), kind: 'activity' },
    ]);
  });
});

describe('goalFlow', () => {
  it('puts every minute from opening to closing in one state', () => {
    const f = goalFlow(goal(62), transcriptMoments(story()), ledger());
    expect(f.ms).toEqual({
      queued: 0,
      // 0–11, 25–26 (once it had shipped again), 30–31, 50–55 and 60–62
      working: (11 + 1 + 1 + 5 + 2) * 60_000,
      // 20–25: from QA failing until the lead shipped again
      rework: 5 * 60_000,
      background: 5 * 60_000,
      // 11–20 waiting on QA's first verdict, 26–30 on its second
      qa: (9 + 4) * 60_000,
      // 31–40: QA passed, waiting on the merge
      review: 9 * 60_000,
      // 40–50: merged, nothing waiting on QA: the captain's turn
      captain: 10 * 60_000,
    });
    expect(Object.values(f.ms).reduce((a, b) => a + b, 0)).toBe(f.leadMs);
    expect(f.activeMs).toBe(f.leadMs);
    expect(f.captainWaits).toEqual([10 * 60_000]);
  });

  it('counts a long stretch after the last turn as away, as well as in its state', () => {
    const f = goalFlow({ ...goal(0), closedAt: min(62) + LONG_WAIT_MS }, transcriptMoments(story()), ledger());
    expect(f.away.captain).toBe(LONG_WAIT_MS);
    expect(f.ms.captain).toBe(10 * 60_000 + LONG_WAIT_MS);
    expect(f.activeMs).toBe(62 * 60_000);
  });

  it('counts the time before the lead’s first line as queued, and a wait on the captain under a minute as no wait', () => {
    n = 0;
    const jsonl = [said('Your workspace, with every repo', 10), work(12), said('ok', 12.5), work(14)].join('\n');
    const f = goalFlow(goal(14), transcriptMoments(jsonl), []);
    expect(f.ms.queued).toBe(10 * 60_000);
    expect(f.ms.captain).toBe(30_000);
    expect(f.captainWaits).toEqual([]);
  });

  it('waits on QA again once the lead ships a new commit after QA passed', () => {
    n = 0;
    const jsonl = [said('Your workspace', 0), ship('s1', 1), shipped('s1', 'Opened o/r#1', 1), said('[QA officer Lt. Q] QA passed', 5), ship('s2', 6), shipped('s2', 'Updated o/r#1', 6), said('Slice 2 starts on fresh code.', 20)].join('\n');
    const f = goalFlow(goal(20), transcriptMoments(jsonl), [verdict('pass', 5), merged(20, 'stale')]);
    expect(f.ms.qa).toBe((4 + 14) * 60_000);
    expect(f.ms.review).toBe(0);
  });
});

describe('the state a goal is in now', () => {
  it('is the last stretch’s, since it began, with why when the captain is the one being waited on', () => {
    expect(goalFlow(goal(80), transcriptMoments(story()), ledger()).now).toEqual({ state: 'captain', since: min(62), reason: 'report' });
  });

  it('is the lead at work while it’s in the middle of a turn, however long since its last line', () => {
    expect(goalFlow(goal(80), transcriptMoments(story()), ledger(), true).now).toEqual({ state: 'working', since: min(60) });
  });

  it('is waiting on QA while a shipped pull request has no verdict yet', () => {
    n = 0;
    const jsonl = [said('Your workspace', 0), ship('s1', 1), shipped('s1', 'Opened o/r#1', 2), work(3)].join('\n');
    expect(goalFlow(goal(20), transcriptMoments(jsonl), []).now).toEqual({ state: 'qa', since: min(3) });
  });
});

describe('endsWith', () => {
  it('tells asking leave from asking something else, from asking nothing', () => {
    expect(endsWith('Slice 2 is small. Shall I go ahead?')).toBe('go-ahead');
    expect(endsWith('I’d do 1 and 2 together.\n\nDo you want it next, or idea 1?**')).toBe('go-ahead');
    expect(endsWith('Shall I start? Which way would you lean on doorways: softer, or fewer effects?')).toBe('question');
    expect(endsWith('Shipped as #12. QA is on it.')).toBe('report');
  });
});

describe('why the lead waited on the captain', () => {
  const said = (text: string, minute: number) => line('assistant', [{ type: 'text', text }], minute);
  it('goes by how the turn before ended: a landed slice, the ask or close tool, a question, or a report', () => {
    n = 0;
    const jsonl = [
      line('user', 'Your workspace, with every repo', 0),
      said('Built it. Shall I carry on with the board?', 1),
      line('user', 'yes', 11),
      line('assistant', [{ type: 'tool_use', id: 'a1', name: 'mcp__office__ask', input: {} }, { type: 'text', text: 'Options are on your screen.' }], 12),
      line('user', 'B', 20),
      said('Done with B.', 21),
      line('user', 'Slice 2 starts on fresh code. Your repos are now:', 30),
      said('Next I’d do the chart. Shall I?', 31),
      line('user', 'go', 41),
      line('assistant', [{ type: 'tool_use', id: 'c1', name: 'mcp__office__propose_close', input: {} }], 42),
    ].join('\n');
    const f = goalFlow(goal(50), transcriptMoments(jsonl), []);
    const by = Object.fromEntries(Object.entries(f.captainBy).map(([k, v]) => [k, v.ms / 60_000]));
    expect(by).toEqual({ 'go-ahead': 10, question: 0, ask: 8, 'next-slice': 10, report: 9, close: 8, 'qa-failed': 0 });
    expect(f.captainBy['next-slice'].waits).toEqual([10 * 60_000]);
  });

  it('puts a lead stopped after QA failed down to the failure', () => {
    n = 0;
    const jsonl = [line('user', 'Your workspace', 0), ship('s1', 1), shipped('s1', 'Opened o/r#1', 1), said('Shipped. Shall I wait?', 2), line('user', '[QA officer Lt. Q] QA failed o/r#1', 5), said('QA found a bug.', 6), line('user', 'fix it', 16)].join('\n');
    const f = goalFlow(goal(16), transcriptMoments(jsonl), [verdict('fail', 5)]);
    expect(f.captainBy['qa-failed'].ms).toBe(10 * 60_000);
    expect(f.ms.qa).toBe(3 * 60_000);
  });
});

describe('percentile', () => {
  it('takes the nearest rank', () => {
    expect(percentile([5, 1, 4, 2, 3], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.85)).toBe(9);
    expect(percentile([], 0.5)).toBe(0);
  });
});

describe('flowReport', () => {
  it('sums the goals up, with the quality guards over their pull requests', () => {
    const g = goal(62);
    const events = [...ledger(), merged(41, 'stale'), ev({ kind: 'conflicts', repo: 'o/r', pr: 1, resolved: 'agent' }, 35), ev({ kind: 'merged', repo: 'o/other', pr: 9, by: 'captain', qa: 'none', failedRounds: 0, triages: 0 }, 45)];
    const r = flowReport([goalFlow(g, transcriptMoments(story()), events)], [g], events);
    expect(r.guards).toEqual({ merged: 2, mergedWithoutPass: 1, reviewed: 1, passedFirstTime: 0, qaFails: 1, agentConflicts: 1 });
    expect(r.leadP50).toBe(62 * 60_000);
    expect(r.totals.review).toBe(9 * 60_000);
    const lines = flowLines(r).join('\n');
    expect(lines).toContain('Biggest wait while around: qa');
    expect(lines).toContain('merged 2 · 1 without a current QA pass (50%)');
  });
});

describe('span', () => {
  it('reads in minutes, hours or days', () => {
    expect([span(45 * 60_000), span(5.7 * 3_600_000), span(3 * 86_400_000)]).toEqual(['45m', '5.7h', '3.0d']);
  });
});
