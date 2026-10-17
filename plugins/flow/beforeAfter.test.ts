import { describe, expect, it } from 'vitest';
import { FRICTION_KINDS, keysOf, type LedgerEvent, recordOf, type SessionFacts } from '../../plugin-api/shared';
import { beforeAfter, beforeAfterLines, windowStats } from './beforeAfter';

const DAY = 24 * 60 * 60 * 1000;
const AT = Date.parse('2026-10-15T12:00:00Z');
let seq = 0;

const facts = (f: Partial<SessionFacts>): SessionFacts => ({
  minutes: 10, turns: 0, toolCalls: 0, failedCalls: 0, refusedCalls: 0, repeatedCalls: 0, wastedCalls: 0,
  captainMessages: 0, nudges: 0, officeMessages: 0, compactions: 0, qaFails: 0, conflicts: 0, ...f,
});
const digest = (at: number, key: string, f: Partial<SessionFacts>, more: { projectId?: string; task?: 'lead' | 'issue' | 'review' } = {}): LedgerEvent => ({
  kind: 'session-digest', key, sessionId: key, agentId: 'a', agent: 'Lt. A', task: more.task ?? 'lead', prs: [], toUuid: 'u',
  facts: facts(f), at, projectId: more.projectId ?? 'p', seq: seq++,
});
const frictions = (at: number, key: string, kinds: ('guard-block' | 'captain-correction')[]): LedgerEvent => ({
  kind: 'session-frictions', key, sessionId: key, reader: 'r', frictions: kinds.map((kind) => ({ kind, signature: kind, quote: 'q' })), at, projectId: 'p', seq: seq++,
});
const verdict = (at: number, v: 'pass' | 'fail'): LedgerEvent => ({
  kind: 'qa-verdict', repo: 'o/r', pr: 1, verdict: v, reviewer: 'qa', checks: { pass: 1, fail: 0, skip: 0 }, failedRounds: 0, at, projectId: 'p', seq: seq++,
});

describe('windowStats', () => {
  it('averages each fact over the window’s sessions, from included and to left out', () => {
    const events = [
      digest(AT - 2 * DAY, 'a', { turns: 10, costUsd: 2 }),
      digest(AT - DAY, 'b', { turns: 20 }),
      digest(AT, 'c', { turns: 99 }),
      digest(AT - 3 * DAY, 'd', { turns: 99 }),
    ];
    const w = windowStats(events, AT - 2 * DAY, AT);
    expect(w.sessions).toBe(2);
    expect(w.perSession.turns).toBe(15);
    expect(w.perSession.costUsd).toBe(2); // only the session that knows its cost
  });

  it('counts frictions over the sessions read for them, a session once per kind', () => {
    const events = [
      digest(AT - DAY, 'a', {}),
      digest(AT - DAY, 'b', {}),
      digest(AT - DAY, 'c', {}),
      frictions(AT, 'a', ['guard-block', 'guard-block']),
      frictions(AT, 'b', ['captain-correction']),
    ];
    const w = windowStats(events, AT - 2 * DAY, AT);
    expect(w.read).toBe(2);
    expect(w.frictions).toEqual({ ...recordOf(keysOf(FRICTION_KINDS), () => 0), 'guard-block': 1, 'captain-correction': 1 });
  });

  it('keeps to one project and one kind of session', () => {
    const events = [digest(AT - DAY, 'a', { turns: 4 }), digest(AT - DAY, 'b', { turns: 8 }, { projectId: 'other' }), digest(AT - DAY, 'c', { turns: 6 }, { task: 'review' })];
    expect(windowStats(events, AT - 2 * DAY, AT, { projectId: 'p' }).sessions).toBe(2);
    expect(windowStats(events, AT - 2 * DAY, AT, { projectId: 'p', task: 'lead' }).perSession.turns).toBe(4);
  });
});

describe('beforeAfter', () => {
  it('compares the days either side of the moment, the after side stopping at now', () => {
    const events = [verdict(AT - DAY, 'fail'), verdict(AT - DAY, 'pass'), verdict(AT + DAY, 'pass'), verdict(AT + 3 * DAY, 'fail')];
    const { before, after } = beforeAfter(events, AT, 7, AT + 2 * DAY);
    expect([before.verdicts, before.passed]).toEqual([2, 1]);
    expect([after.verdicts, after.passed, after.to]).toEqual([1, 1, AT + 2 * DAY]);
  });

  it('warns when a side has too few sessions to tell the change from luck', () => {
    const lines = beforeAfterLines(beforeAfter([digest(AT - DAY, 'a', { turns: 10 }), digest(AT + DAY, 'b', { turns: 5 })], AT, 7, AT + 7 * DAY));
    expect(lines.find((l) => l.includes('turns'))).toMatch(/10\s+5\s+-50%/);
    expect(lines.at(-1)).toMatch(/Only 1 sessions/);
  });

  it('has a line for each friction either side hit, and none for the rest', () => {
    const events = [digest(AT - DAY, 'a', {}), frictions(AT - DAY, 'a', ['guard-block']), digest(AT + DAY, 'b', {}), frictions(AT + DAY, 'b', ['captain-correction'])];
    const lines = beforeAfterLines(beforeAfter(events, AT, 7, AT + 7 * DAY));
    expect(lines.filter((l) => keysOf(FRICTION_KINDS).some((k) => l.startsWith(`  ${k} `))).map((l) => l.trim().split(/\s+/)[0])).toEqual(['guard-block', 'captain-correction']);
  });
});
