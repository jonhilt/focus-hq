import { describe, expect, it } from 'vitest';
import type { LedgerEvent, SessionFacts } from './ledger';
import { byDay, groupCounts, ledgerLog, ledgerRow, ledgerWindow, MAX_DAYS, SHOWN_AT_FIRST, trace } from './ledgerReview';

const REPO = 'jonhilt/focus';
const GOAL = 'Engineering deck';
let seq = 0;
const at = (minute: number) => Date.UTC(2026, 9, 9, 10, minute);
const ev = (e: Record<string, unknown>, minute: number): LedgerEvent => ({ projectId: 'p1', seq: ++seq, at: at(minute), ...e }) as LedgerEvent;
const facts = (f: Partial<SessionFacts> = {}): SessionFacts => ({
  minutes: 10, turns: 20, toolCalls: 12, failedCalls: 0, refusedCalls: 0, repeatedCalls: 0, wastedCalls: 0, captainMessages: 0, nudges: 0,
  officeMessages: 0, compactions: 0, qaFails: 0, conflicts: 0, costUsd: 1, ...f,
});
const verdict = (pr: number, v: 'pass' | 'fail', failedRounds: number, minute: number, goal: string | undefined = GOAL) =>
  ev({ kind: 'qa-verdict', repo: REPO, pr, goal, verdict: v, reviewer: 'Lt. Oyelaran', checks: v === 'pass' ? { pass: 7, fail: 0, skip: 0 } : { pass: 5, fail: 2, skip: 0 }, failedRounds }, minute);
const digest = (key: string, pr: number, minute: number, f: Partial<SessionFacts> = {}, goal?: string) =>
  ev({ kind: 'session-digest', key, sessionId: key, agentId: 'a', agent: 'Lt. Nakamura', task: 'lead', prs: [{ repo: REPO, pr }], toUuid: 'u', goal, facts: facts(f) }, minute);

describe('ledgerRow', () => {
  it('says how a QA verdict went, and which fail it was', () => {
    expect(ledgerRow(verdict(236, 'fail', 2, 1)).title).toBe('focus #236 · 2 of 7 checks failed · fail 2');
    expect(ledgerRow(verdict(236, 'pass', 2, 1)).title).toBe('focus #236 · 7 checks passed · after 2 failed rounds');
    expect(ledgerRow(verdict(236, 'pass', 0, 1))).toMatchObject({ tag: 'QA pass', tone: 'ok', title: 'focus #236 · 7 checks passed · first time', pr: { repo: REPO, pr: 236 } });
  });

  it('says how a scorer graded one of QA’s reports, under QA', () => {
    const graded = (label: string, score: number) => ev({ kind: 'qa-score', repo: REPO, pr: 236, goal: 'Shop', sha: 'abc', label, score, passed: score === 1, why: 'Leans on the suite.', scorer: 'qa-report-1a2b3c4d', model: 'haiku' }, 3);
    expect(ledgerRow(graded('shallow', 0.5))).toMatchObject({ group: 'qa', tag: 'Scored', tone: 'warn', title: "focus #236 · QA's report graded shallow (0.5)", detail: 'Leans on the suite. · Shop', pr: { repo: REPO, pr: 236 } });
    expect([ledgerRow(graded('thorough', 1)).tone, ledgerRow(graded('wrong', 0)).tone]).toEqual(['ok', 'bad']);
  });

  it('says who merged a pull request and whether QA had passed it', () => {
    const merged = ev({ kind: 'merged', repo: REPO, pr: 199, by: 'captain', qa: 'stale', failedRounds: 0, triages: 0 }, 2);
    expect(ledgerRow(merged)).toMatchObject({ tag: 'Merged', tone: 'warn', title: 'focus #199 · by the captain · without a QA pass (QA stale)' });
    const clean = ev({ kind: 'merged', repo: REPO, pr: 237, by: 'office', qa: 'passed', failedRounds: 0, triages: 0, closes: [226] }, 2);
    expect(ledgerRow(clean)).toMatchObject({ tone: 'ok', title: 'focus #237 · by Ops · QA passed first time', detail: ' · closed #226' });
  });

  it('says how conflicts were settled, and which files', () => {
    const row = ledgerRow(ev({ kind: 'conflicts', repo: REPO, pr: 233, resolved: 'agent', files: ['a.ts', 'b.md'] }, 3));
    expect(row).toMatchObject({ tone: 'bad', title: 'focus #233 · an agent resolved them · 2 files', detail: 'a.ts, b.md' });
  });

  it('says what a goal is after, and where a decision on it stands', () => {
    expect(ledgerRow(ev({ kind: 'intent', goalId: 'g1', goal: 'G', by: 'Lt. A', what: 'Typed decisions', constraints: ['no new UI'] }, 5))).toMatchObject({ group: 'goals', tag: 'Intent', title: 'Typed decisions', detail: 'no new UI · Lt. A · G', goal: 'G' });
    expect(ledgerRow(ev({ kind: 'intent', by: 'threads', what: 'Ship small', constraints: [] }, 5)).detail).toBe('threads · the project');
    const decision = { kind: 'decision', id: 'd1', goalId: 'g1', goal: 'G', owner: 'Lt. A', by: 'Lt. A', question: 'JSON or markdown?', options: ['JSON', 'markdown'] } as const;
    expect(ledgerRow(ev({ ...decision, status: 'open', proposed: 'JSON' }, 6))).toMatchObject({ tone: 'warn', title: 'Open: JSON or markdown? (proposed: JSON)' });
    expect(ledgerRow(ev({ ...decision, status: 'decided', chosen: 'JSON', rationale: 'overwritten less', by: 'captain', supersedes: 'd0' }, 7))).toMatchObject({ tone: 'info', title: 'Decided: JSON or markdown? → JSON', detail: 'overwritten less · replaces d0 · captain · G' });
    expect(ledgerRow(ev({ ...decision, status: 'superseded', chosen: 'JSON' }, 8)).title).toBe('Superseded: JSON or markdown?');
  });

  it('sums up a session span: who, how long, cost and waste', () => {
    const row = ledgerRow(digest('s1', 236, 4, { minutes: 48, costUsd: 3.1, wastedCalls: 3, nudges: 1 }));
    expect(row).toMatchObject({ group: 'sessions', title: 'Lt. Nakamura (lead) · 48 min · $3.10 · 3 wasted calls', detail: 'focus #236 · 1 nudge' });
  });

  it('quotes the frictions found in a session', () => {
    const row = ledgerRow(ev({ kind: 'session-frictions', key: 's1', sessionId: 's1', reader: 'retro', frictions: [{ kind: 'demo-env', signature: 'demo port in use', quote: 'EADDRINUSE' }] }, 5));
    expect(row).toMatchObject({ title: '1 friction found in a session', detail: 'demo-env', quotes: ['demo port in use: “EADDRINUSE”'] });
  });

  it('says where the chief of staff would have sent a lead’s turn, and what it would have said', () => {
    const cos = (route: number, message?: string) => ev({ kind: 'cos-verdict', sessionId: 's1', agent: 'Cmdr. Vale', goal: GOAL, turnUuid: 'u', route, why: 'It can check.', message, model: 'claude-haiku-4-5', version: 'v5' }, 6);
    expect(ledgerRow(cos(4, 'Run the tests.'))).toMatchObject({ group: 'sessions', tag: 'CoS', tone: 'info', title: 'CoS: back to the lead — It can check.', detail: 'Cmdr. Vale · Engineering deck', quotes: ['To the lead: “Run the tests.”'], goal: GOAL });
    expect(ledgerRow(cos(3, 'Production needs your sign-off.'))).toMatchObject({ tone: 'warn', title: 'CoS: interrupt — It can check.', quotes: ['To the captain: “Production needs your sign-off.”'] });
    expect(ledgerRow(cos(2)).quotes).toBeUndefined();
  });

  it('says when a lane was raised, by whom and why, among the merges', () => {
    const raised = ev({ kind: 'lane-raised', repo: REPO, pr: 236, goal: GOAL, from: 'ship', to: 'ask', by: 'chief-of-staff', why: 'It changes a card.' }, 6);
    expect(ledgerRow(raised)).toMatchObject({ group: 'merged', tag: 'Lane', tone: 'warn', title: 'focus #236 · raised from ship to ask by the chief of staff', detail: 'It changes a card. · Engineering deck', pr: { repo: REPO, pr: 236 }, goal: GOAL });
  });

  it('says what the chief of staff made of a ship’s lane, kept, raised or unread', () => {
    const read = (to: string, failed?: string) => ev({ kind: 'cos-lane', agent: 'Cmdr. Vale', goal: GOAL, prs: [{ repo: REPO, pr: 236, sha: 'abc' }], from: 'ship', to, why: 'Safe.', model: 'haiku', version: 'lane-v1', failed }, 6);
    expect(ledgerRow(read('ship'))).toMatchObject({ group: 'sessions', tag: 'Lane', tone: 'info', title: 'Kept Cmdr. Vale’s ship in ship', detail: 'Safe. · Engineering deck', pr: { repo: REPO, pr: 236 } });
    expect(ledgerRow(read('show')).title).toBe('Raised Cmdr. Vale’s ship from ship to show');
    expect(ledgerRow(read('ask', 'Haiku is down'))).toMatchObject({ tone: 'bad', detail: 'Haiku is down · Engineering deck' });
  });

  it('says what the captain decided, for whom, and when it came through the API', () => {
    const decided = (via: string) => ev({ kind: 'captain-decision', agent: 'Cmdr. Vale', goal: GOAL, item: { id: 'turn:a:1', kind: 'turn', what: 'Waiting for your reply' }, answer: 'Ship it', via }, 7);
    expect(ledgerRow(decided('office'))).toMatchObject({ group: 'sessions', tag: 'Captain', tone: 'info', title: 'Decided: Waiting for your reply → Ship it', detail: 'Cmdr. Vale · Engineering deck', goal: GOAL });
    expect(ledgerRow(decided('api')).detail).toBe('Cmdr. Vale · Engineering deck · via the API');
  });

  it('says what a plugin alerted the captain of, about whom, among the goals shown at first', () => {
    const alert = ev({ kind: 'alert', by: 'scheduler', agent: 'Lt. Quintero', goal: GOAL, text: 'Lt. Quintero hasn’t answered the 15:07 check (sch-2) after 20 min.' }, 8);
    expect(ledgerRow(alert)).toEqual({
      seq: alert.seq, at: alert.at, projectId: 'p1', group: 'goals', tag: 'Alert', tone: 'bad',
      title: 'Lt. Quintero hasn’t answered the 15:07 check (sch-2) after 20 min.', detail: 'Lt. Quintero · Engineering deck · from the scheduler', goal: GOAL,
    });
    expect(SHOWN_AT_FIRST).toContain('goals');
    expect(trace([alert], { kind: 'goal', title: GOAL }).steps.map((s) => s.tag)).toEqual(['Alert']);
    expect(trace([alert], { kind: 'pr', repo: REPO, pr: 236 }).steps).toEqual([]);
  });

  it('says where the captain decided a loose thread ends, and the goal it was spun off as', () => {
    const thread = (e: Record<string, unknown>) => ev({ kind: 'thread-decided', goalId: 'g1', goal: GOAL, contact: 'c2', text: 'Firm #2 gaps', ...e }, 8);
    expect(ledgerRow(thread({ as: 'parked', note: 'until the first login' }))).toMatchObject({ group: 'goals', tag: 'Thread', title: 'Parked: Firm #2 gaps', detail: 'until the first login · Engineering deck', goal: GOAL });
    expect(ledgerRow(thread({ as: 'next', spunOff: { goal: 'a9', title: 'Firm #2 gaps' } }))).toMatchObject({ title: 'Spun off as a goal: Firm #2 gaps', detail: '“Firm #2 gaps” · Engineering deck' });
    expect(ledgerRow(thread({ as: 'dropped', note: 'stale', proposed: true })).detail).toBe('stale · as proposed · Engineering deck');
  });

  it('says what a sort of a project’s threads proposed, of how many, on what and at what cost, or why it failed', () => {
    const sorted = (e: Record<string, unknown>) => ev({ kind: 'thread-proposals', asked: 5, model: 'sonnet', ...e }, 9);
    const p = (as: string) => ({ goalId: 'g1', contact: 'c1', as, note: 'why' });
    expect(ledgerRow(sorted({ proposals: [p('dropped'), p('dropped'), p('next')], costUsd: 0.042 }))).toMatchObject({
      group: 'goals', tag: 'Threads', tone: 'info', title: 'Proposed ends for 3 of 5 threads', detail: '1 taken on, 2 dropped · sonnet · $0.04',
    });
    expect(ledgerRow(sorted({ proposals: [], failed: 'timed out' }))).toMatchObject({ tone: 'warn', title: 'Sorting 5 threads failed: timed out', detail: 'sonnet' });
    expect(trace([sorted({ proposals: [] })], { kind: 'goal', title: GOAL }).steps).toEqual([]);
  });

  it('says a closed pull request was closed, never merged', () => {
    const closed = ev({ kind: 'closed', repo: REPO, pr: 240, by: 'officer', qa: 'passed', failedRounds: 1, triages: 2, goal: GOAL, closes: [226] }, 8);
    expect(ledgerRow(closed)).toMatchObject({ group: 'merged', tag: 'Closed', tone: 'warn', title: 'focus #240 · by the operations officer · QA passed after 1 failed round', detail: 'Engineering deck · 2 triages' });
  });

  it('says how Ops’ merge check went, and on which commits', () => {
    const check = (outcome: string, more: Record<string, unknown> = {}) => ev({ kind: 'merge-check', repo: REPO, pr: 241, outcome, by: 'office', ...more }, 9);
    expect(ledgerRow(check('passed', { head: 'abcdef1234', base: '1234567890' }))).toMatchObject({ tag: 'Merge check', tone: 'ok', title: 'focus #241 · merge checked by Ops · abcdef1 onto 1234567', pr: { repo: REPO, pr: 241 } });
    expect(ledgerRow(check('failed', { failed: 'pnpm test', goal: GOAL }))).toMatchObject({ tone: 'bad', title: 'focus #241 · merge refused, a check failed by Ops', detail: 'pnpm test · Engineering deck' });
    expect(ledgerRow(check('overridden', { by: 'captain' }))).toMatchObject({ tone: 'warn', title: 'focus #241 · merged past the check by the captain' });
    expect(ledgerRow(check('broken')).tone).toBe('warn');
    expect(ledgerRow(check('unchecked', { head: 'abcdef1234' }))).toMatchObject({ tone: 'warn', title: 'focus #241 · merged without the check (off for this project) by Ops · abcdef1' });
  });

  it('says which failing checks went back, and what the operations officer did', () => {
    expect(ledgerRow(ev({ kind: 'checks-sent-back', repo: REPO, pr: 242, checks: ['lint', 'test'], goal: GOAL }, 10))).toMatchObject({ group: 'qa', tag: 'Sent back', tone: 'warn', title: 'focus #242 · failing checks sent back: lint, test', detail: GOAL, goal: GOAL });
    const triage = (action: string) => ev({ kind: 'triage', repo: REPO, pr: 243, officer: 'Lt. Cho', action, note: 'Flaky' }, 11);
    expect(ledgerRow(triage('retry-qa'))).toMatchObject({ tag: 'Triage', tone: 'warn', title: 'focus #243 · Lt. Cho ran QA again', detail: 'Flaky' });
    expect(ledgerRow(triage('escalate'))).toMatchObject({ tone: 'bad', title: 'focus #243 · Lt. Cho asked the captain' });
  });

  it('says how long a closed goal was open, and what it took', () => {
    const goal = (days: number) => ev({ kind: 'goal-closed', goal: { id: 'g1', title: GOAL, leadName: 'Cmdr. Vale', slices: 3, prs: [{ repo: REPO, pr: 1 }], openedAt: at(0), closedAt: at(0) + days * 86_400_000 } }, 12);
    expect(ledgerRow(goal(2))).toMatchObject({ group: 'goals', tag: 'Goal', title: `Closed: ${GOAL}`, detail: 'Cmdr. Vale · 3 slices · 1 pull request · open 2 days', goal: GOAL });
    expect(ledgerRow(goal(0)).detail).toBe('Cmdr. Vale · 3 slices · 1 pull request · open under a day');
  });

  it('says what the captain made of a retro draft, and where it was filed', () => {
    expect(ledgerRow(ev({ kind: 'retro-decision', title: 'Fix the demo', signatures: ['a: b', 'c: d'], accepted: true, issue: { repo: REPO, number: 226 } }, 13))).toMatchObject({ group: 'retro', tone: 'ok', title: 'Accepted: Fix the demo', detail: 'filed as focus #226 · 2 friction signatures' });
    expect(ledgerRow(ev({ kind: 'retro-decision', title: 'Fix the demo', signatures: ['a: b'], accepted: false }, 13))).toMatchObject({ tone: 'info', title: 'Rejected: Fix the demo', detail: '1 friction signature' });
  });

  it('counts the captain’s replies to a lead', () => {
    const replies = (n: number) => ev({ kind: 'captain-replies', key: 's1', sessionId: 's1', agent: 'Cmdr. Vale', goal: GOAL, replies: Array.from({ length: n }, () => ({ lead: 'Go?', captain: 'Yes' })) }, 14);
    expect(ledgerRow(replies(2))).toMatchObject({ group: 'sessions', tag: 'Captain', title: '2 replies to Cmdr. Vale', detail: GOAL });
    expect(ledgerRow(replies(0)).title).toBe('Nothing said to Cmdr. Vale');
  });

  it('says a session that isn’t on this machine wasn’t read, and one with no frictions had none', () => {
    const read = (missing?: boolean) => ev({ kind: 'session-frictions', key: 's1', sessionId: 's1', reader: 'retro', frictions: [], missing }, 15);
    expect(ledgerRow(read(true))).toMatchObject({ tone: 'info', title: 'Session not on this machine: not read' });
    expect(ledgerRow(read())).toMatchObject({ tone: 'info', title: 'Nothing got in the way of a session', detail: '' });
  });
});

describe('ledgerLog', () => {
  const events = [
    verdict(236, 'fail', 1, 1),
    digest('s1', 236, 2),
    ev({ kind: 'merged', repo: REPO, pr: 237, by: 'office', qa: 'passed', failedRounds: 0, triages: 0 }, 3),
    { ...ev({ kind: 'conflicts', repo: 'jonhilt/ops', pr: 1, resolved: 'office' }, 4), projectId: 'p2' },
  ];

  it('shows the groups picked, the newest first, leaving sessions and frictions out at first', () => {
    expect(ledgerLog(events, new Set(SHOWN_AT_FIRST)).map((r) => r.tag)).toEqual(['Conflicts', 'Merged', 'QA fail']);
  });

  it('keeps to a project when one is picked', () => {
    expect(ledgerLog(events, new Set(SHOWN_AT_FIRST), 'p1').map((r) => r.tag)).toEqual(['Merged', 'QA fail']);
  });

  it('counts each group, for the filters', () => {
    expect(groupCounts(events)).toMatchObject({ qa: 1, sessions: 1, merged: 1, conflicts: 1, goals: 0 });
    expect(groupCounts(events, 'p2')).toMatchObject({ qa: 0, conflicts: 1 });
  });

  it('groups rows by day, keeping their order', () => {
    const rows = ledgerLog(events, new Set(SHOWN_AT_FIRST));
    const days = byDay(rows, (t) => (t >= at(3) ? 'later' : 'earlier'));
    expect(days.map((d) => [d.day, d.rows.length])).toEqual([['later', 2], ['earlier', 1]]);
  });
});

describe('trace', () => {
  const events = [
    digest('s1', 236, 1, { minutes: 48, costUsd: 3.1, wastedCalls: 3 }, GOAL),
    verdict(236, 'fail', 1, 2),
    ev({ kind: 'conflicts', repo: REPO, pr: 236, resolved: 'office' }, 3),
    ev({ kind: 'conflicts', repo: REPO, pr: 236, resolved: 'up-to-date' }, 3),
    ev({ kind: 'session-frictions', key: 's1', sessionId: 's1', reader: 'retro', frictions: [{ kind: 'demo-env', signature: 'demo port in use', quote: 'EADDRINUSE' }] }, 4),
    digest('s2', 236, 5, { minutes: 6, costUsd: 0.7 }),
    verdict(236, 'pass', 1, 6),
    ev({ kind: 'merged', repo: REPO, pr: 236, goal: GOAL, by: 'office', qa: 'passed', failedRounds: 1, triages: 0 }, 7),
    verdict(240, 'pass', 0, 8),
    verdict(300, 'pass', 0, 9, 'Another goal'),
    digest('s3', 300, 9),
  ];

  it('follows a pull request’s lane, read and raised, by the pull request and by its goal', () => {
    const lanes = [
      ev({ kind: 'cos-lane', agent: 'Cmdr. Vale', goal: GOAL, prs: [{ repo: REPO, pr: 241, sha: 'abc' }], from: 'ship', to: 'ask', why: 'It changes a card.', model: 'haiku', version: 'lane-v1' }, 10),
      ev({ kind: 'lane-raised', repo: REPO, pr: 241, goal: GOAL, from: 'ship', to: 'ask', by: 'chief-of-staff', why: 'It changes a card.' }, 10),
      ev({ kind: 'cos-lane', agent: 'Cmdr. Vale', goal: 'Another goal', prs: [{ repo: REPO, pr: 300 }], from: 'ship', to: 'ship', why: 'Safe.', model: 'haiku', version: 'lane-v1' }, 11),
    ];
    expect(trace(lanes, { kind: 'pr', repo: REPO, pr: 241 }).steps.map((s) => s.tag)).toEqual(['Lane', 'Lane']);
    expect(trace(lanes, { kind: 'goal', title: GOAL }).steps).toHaveLength(2);
  });

  it('follows a pull request from its first session to its merge, with the frictions folded into their session', () => {
    const t = trace(events, { kind: 'pr', repo: REPO, pr: 236 });
    expect(t.steps.map((s) => s.tag)).toEqual(['Session', 'QA fail', 'Conflicts', 'Conflicts', 'Session', 'QA pass', 'Merged']);
    expect(t.steps[0].quotes).toEqual(['demo port in use: “EADDRINUSE”']);
    expect(t.goal).toBe(GOAL);
    expect(t.totals).toEqual({ prs: 1, verdicts: 2, fails: 1, conflicts: 1, sessions: 2, minutes: 54, costUsd: 3.8, wastedCalls: 3, frictions: 1 });
  });

  it('follows a goal across every pull request it opened, and no other', () => {
    const t = trace(events, { kind: 'goal', title: GOAL });
    expect(t.totals.prs).toBe(2);
    expect(t.totals.verdicts).toBe(3);
    expect(t.totals.sessions).toBe(2);
    expect(t.steps.some((s) => s.pr?.pr === 300)).toBe(false);
  });

  it('includes what the captain decided on the goal, and not on another', () => {
    const decided = (goal: string) => ev({ kind: 'captain-decision', agent: 'Lt. Halloran', goal, item: { id: 'turn:a:1', kind: 'turn', what: 'Waiting for your reply' }, answer: 'Go on', via: 'office' }, 8);
    expect(trace([...events, decided(GOAL), decided('Another goal')], { kind: 'goal', title: GOAL }).steps.filter((s) => s.tag === 'Captain')).toHaveLength(1);
    expect(trace([...events, decided(GOAL)], { kind: 'pr', repo: REPO, pr: 236 }).steps.some((s) => s.tag === 'Captain')).toBe(false);
  });

  it('includes the goal’s intent and decisions, and not another goal’s or a pull request’s', () => {
    const intent = (goal: string) => ev({ kind: 'intent', goalId: goal, goal, by: 'Lt. A', what: 'Typed decisions', constraints: [] }, 8);
    const decision = (goal: string) => ev({ kind: 'decision', id: `${goal}.d1`, status: 'open', goalId: goal, goal, owner: 'Lt. A', by: 'Lt. A', question: 'JSON?', options: ['yes', 'no'] }, 8);
    const all = [...events, intent(GOAL), decision(GOAL), intent('Another goal'), decision('Another goal')];
    expect(trace(all, { kind: 'goal', title: GOAL }).steps.filter((s) => s.tag === 'Intent' || s.tag === 'Decision').map((s) => s.tag)).toEqual(['Intent', 'Decision']);
    expect(trace(all, { kind: 'pr', repo: REPO, pr: 236 }).steps.some((s) => s.tag === 'Intent' || s.tag === 'Decision')).toBe(false);
  });

  it('includes the goal closing when it has', () => {
    const closed = ev({ kind: 'goal-closed', goal: { id: 'g', title: GOAL, slices: 2, prs: [], leadName: 'Lt. Halloran', openedAt: at(0), closedAt: at(10) } }, 10);
    const t = trace([...events, closed], { kind: 'goal', title: GOAL });
    expect(t.steps[t.steps.length - 1]).toMatchObject({ tag: 'Goal', title: `Closed: ${GOAL}` });
  });

  it('follows a friction through every session it came up in, quoting only it, and the retro decision on it', () => {
    const port = { kind: 'demo-env', signature: 'demo port in use' };
    const withFriction = [
      ...events,
      digest('s4', 301, 10, { minutes: 20, costUsd: 2, wastedCalls: 4 }),
      ev({ kind: 'session-frictions', key: 's4', sessionId: 's4', reader: 'retro', frictions: [{ ...port, quote: 'port 4477 taken' }, { ...port, quote: 'again' }, { kind: 'shell', signature: 'bash exit code 1', quote: 'exit 1' }] }, 11),
      ev({ kind: 'retro-decision', title: 'Give the demo its own port', signatures: ['demo-env: demo port in use'], accepted: true }, 12),
    ];
    const t = trace(withFriction, { kind: 'friction', key: 'demo-env: demo port in use' });
    expect(t.steps.map((s) => s.tag)).toEqual(['Session', 'Session', 'Retro']);
    expect(t.steps[1].quotes).toEqual(['“port 4477 taken”', '“again”']);
    expect(t.totals).toEqual({ prs: 2, verdicts: 0, fails: 0, conflicts: 0, sessions: 2, minutes: 68, costUsd: 5.1, wastedCalls: 7, frictions: 3 });
  });
});

describe('ledgerWindow', () => {
  const DAY = 86_400_000;
  const now = at(0);
  const old = (days: number) => ({ ...verdict(1, 'pass', 0, 0), at: now - days * DAY });
  const events = [old(1), old(10), old(20), old(100)];

  it('keeps the last so many days', () => {
    expect(ledgerWindow(events, now, 14)).toHaveLength(2);
    expect(ledgerWindow(events, now, 30)).toHaveLength(3);
  });

  it('looks back no further than MAX_DAYS, and 14 days for nonsense', () => {
    expect(MAX_DAYS).toBeLessThan(100);
    expect(ledgerWindow(events, now, 1000)).toHaveLength(3);
    expect(ledgerWindow(events, now, Number.NaN)).toHaveLength(2);
    expect(ledgerWindow(events, now, -3)).toHaveLength(2);
  });
});
