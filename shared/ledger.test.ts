import { describe, expect, it } from 'vitest';
import { checkLedger, type LedgerEvent, ledgerLine, reportCard, reportLines, type SessionFacts } from './ledger';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;
let seq = 0;
const pr = (n: number) => ({ projectId: 'p', repo: 'o/r', pr: n, seq: ++seq });

const merged = (n: number, qa: 'passed' | 'stale' | 'none', failedRounds = 0, at = NOW - DAY): LedgerEvent => ({ ...pr(n), at, kind: 'merged', by: qa === 'passed' ? 'office' : 'captain', qa, failedRounds, triages: 0 });
const verdict = (n: number, v: 'pass' | 'fail', at = NOW - DAY): LedgerEvent => ({ ...pr(n), at, kind: 'qa-verdict', verdict: v, reviewer: 'QA', checks: { pass: 1, fail: 0, skip: 0 }, failedRounds: 0 });

describe('reportCard', () => {
  it('counts merges, first-time passes, rounds and merges without a pass', () => {
    const card = reportCard([merged(1, 'passed'), merged(2, 'passed', 2), merged(3, 'stale'), verdict(1, 'pass'), verdict(2, 'fail'), verdict(2, 'fail'), verdict(2, 'pass')], NOW);
    expect(card).toMatchObject({ merged: 3, mergedFirstTime: 1, mergedUnpassed: 1, verdicts: 4, fails: 2 });
    expect(card.roundsPerMerge).toBeCloseTo(2 / 3);
  });

  it('leaves out what happened before the window', () => {
    expect(reportCard([merged(1, 'passed', 0, NOW - 31 * DAY), merged(2, 'none')], NOW)).toMatchObject({ merged: 1, mergedUnpassed: 1 });
  });

  it('counts each conflicting PR once, and those that needed an agent', () => {
    const conflicts = (n: number, resolved: 'office' | 'agent'): LedgerEvent => ({ ...pr(n), at: NOW - DAY, kind: 'conflicts', resolved });
    expect(reportCard([conflicts(1, 'office'), conflicts(1, 'agent'), conflicts(2, 'office')], NOW)).toMatchObject({ conflicts: 2, conflictsForAgent: 1 });
  });
});

const facts = (f: Partial<SessionFacts>): SessionFacts => ({ minutes: 1, turns: 1, toolCalls: 1, failedCalls: 0, refusedCalls: 0, repeatedCalls: 0, wastedCalls: 0, captainMessages: 0, nudges: 0, officeMessages: 0, compactions: 0, qaFails: 0, conflicts: 0, ...f });
const digest = (f: Partial<SessionFacts>): LedgerEvent => ({ projectId: 'p', seq: ++seq, at: NOW - DAY, kind: 'session-digest', key: `s${seq}:u`, sessionId: `s${seq}`, agentId: 'a', agent: 'Ens. A', task: 'issue', prs: [], toUuid: 'u', facts: facts(f) });

describe('reportCard spend', () => {
  it('shares the sessions’ cost and wasted calls out over the merges', () => {
    const card = reportCard([merged(1, 'passed'), merged(2, 'passed'), digest({ costUsd: 1.5, wastedCalls: 3 }), digest({ costUsd: 0.5, wastedCalls: 1 }), digest({ wastedCalls: 2 })], NOW);
    expect(card).toMatchObject({ sessions: 3, costUsd: 2, costPerMerge: 1, wastedPerMerge: 3 });
    expect(reportLines(card).lines.at(-1)).toBe('Per merge: $1.00 · 3.0 wasted tool calls');
  });

  it('puts ledger damage first, and notes that aren’t damage after it', () => {
    const lines = reportLines({ ...reportCard([merged(1, 'passed')], NOW), warnings: ['line 3 is missing'], notes: ['another office is writing it'] }).lines;
    expect(lines.slice(0, 2)).toEqual(['⚠ Ledger damaged: line 3 is missing', 'Ledger: another office is writing it']);
    expect(reportLines({ ...reportCard([merged(1, 'passed')], NOW), notes: ['x'] }).lines[0]).toBe('Ledger: x');
  });
});

describe('checkLedger', () => {
  const event = (n: number): LedgerEvent => ({ projectId: 'p', repo: 'o/r', pr: n, seq: n, at: n, kind: 'conflicts', resolved: 'office' });
  const text = (...ns: number[]) => ns.map((n) => ledgerLine(event(n))).join('');

  it('reads numbered lines in order, and says what the next one is', () => {
    const check = checkLedger(text(1, 2, 3));
    expect(check).toMatchObject({ nextSeq: 4, tornTail: false, migrated: false, problems: [] });
    expect(check.events).toEqual([event(1), event(2), event(3)]);
    expect(ledgerLine(event(1)).startsWith('{"v":2,"seq":1,')).toBe(true);
  });

  it('drops a last line cut short, and says how much of the file to keep', () => {
    const whole = text(1, 2);
    const check = checkLedger(whole + ledgerLine(event(3)).slice(0, 25));
    expect(check).toMatchObject({ tornTail: true, nextSeq: 3, problems: [], goodBytes: new TextEncoder().encode(whole).length });
  });

  it('keeps a last line that only lost its newline', () => {
    expect(checkLedger(text(1) + ledgerLine(event(2)).trimEnd()).events).toHaveLength(2);
  });

  it('reports damage in the middle rather than skipping it quietly', () => {
    expect(checkLedger(text(1, 2) + 'not json\n' + text(5, 5)).problems).toEqual(['line 3 isn’t readable', 'lines 3–4 are missing', 'line 5 repeats or goes back to number 5']);
  });

  it('numbers lines in the first format, to be rewritten in this one', () => {
    const v1 = [event(1), event(2)].map(({ seq: _s, ...e }) => JSON.stringify(e) + '\n').join('');
    const check = checkLedger(v1);
    expect(check).toMatchObject({ migrated: true, nextSeq: 3, problems: [] });
    expect(check.events.map((e) => e.seq)).toEqual([1, 2]);
  });
});

describe('reportLines', () => {
  it('says it is gathering evidence until there is some', () => {
    expect(reportLines(reportCard([], NOW)).headline).toBe('Gathering evidence');
  });

  it('shows the first-time pass rate as a percentage', () => {
    const { headline, lines } = reportLines(reportCard([merged(1, 'passed'), merged(2, 'passed', 1)], NOW));
    expect(headline).toBe('2 merged · last 30 days');
    expect(lines[0]).toBe('QA passed first time: 50%');
  });
});
