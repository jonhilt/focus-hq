import { describe, expect, it } from 'vitest';
import { goalIntent, intentEntry, lineProblem, projectIntents } from './intents';
import { checkLedger, type LedgerEvent, ledgerLine } from './ledger';

let seq = 0;

describe('goalIntent', () => {
  it('is the goal’s latest intent line', () => {
    const intent = (what: string, goalId = 'g1'): LedgerEvent => ({ projectId: 'p', seq: ++seq, at: seq, kind: 'intent', goalId, goal: 'G', by: 'Lt. A', what, constraints: [] });
    expect(goalIntent([intent('first'), intent('second'), intent('other', 'g2')], 'g1')?.what).toBe('second');
    expect(goalIntent([], 'g1')).toBeUndefined();
  });

  it('keeps a project’s own intents apart from its goals’, in the same format, the latest for each id', () => {
    const goal: LedgerEvent = { projectId: 'p', seq: ++seq, at: seq, kind: 'intent', goalId: 'g1', goal: 'G', by: 'Lt. A', what: 'goal', constraints: [], serves: ['value'] };
    const project = (id: string, what: string, more: Partial<Extract<LedgerEvent, { kind: 'intent' }>> = {}, projectId = 'p'): LedgerEvent => ({ projectId, seq: ++seq, at: seq, kind: 'intent', id, by: 'Jon', what, constraints: [], ...more });
    const events = [project('value', 'Deliver value'), project('quality', 'Quality proven'), goal, project('value', 'Deliver value, reliably', { why: 'reliability matters' }), project('plain', 'A plain harness'), project('plain', 'A plain harness', { retired: true }), project('value', 'elsewhere', {}, 'q')];
    expect(projectIntents(events, 'p').map((e) => [e.id, e.what])).toEqual([['value', 'Deliver value, reliably'], ['quality', 'Quality proven']]);
    expect(goalIntent(events, 'g1')?.serves).toEqual(['value']);
    expect(goalIntent([...events, { ...goal, seq: ++seq, retired: true }], 'g1')).toBeUndefined();
  });
});

describe('intentEntry', () => {
  it('writes a project’s intent or a goal’s as the one intent line, or says what’s wrong', () => {
    expect(intentEntry({ by: 'threads', what: ' Ship small ', constraints: [' one PR each ', ''] })).toEqual({ entry: { kind: 'intent', by: 'threads', what: 'Ship small', constraints: ['one PR each'] } });
    expect(intentEntry({ by: 'Lt. A', what: 'x', goal: { id: 'g1', title: 'G' } })).toEqual({ entry: { kind: 'intent', goalId: 'g1', goal: 'G', by: 'Lt. A', what: 'x', constraints: [] } });
    expect(intentEntry({ by: 'Lt. A', what: '  ' })).toEqual({ problem: 'The intent has no what' });
    expect(intentEntry({ by: 'Jon', id: 'value', what: 'x', why: ' clearer ', retired: true })).toEqual({ entry: { kind: 'intent', id: 'value', by: 'Jon', what: 'x', constraints: [], why: 'clearer', retired: true } });
    expect(intentEntry({ by: 'Jon', id: 'Deliver value', what: 'x' })).toEqual({ problem: 'The intent has an id that isn’t a slug (lowercase words and dashes)' });
    expect(intentEntry({ by: 'Jon', what: 'x', serves: ['value'] })).toEqual({ problem: 'The intent serves intents without being a goal’s, or names them oddly' });
  });
});

describe('lineProblem', () => {
  const intent = (more: Record<string, unknown> = {}) => ({ kind: 'intent', goalId: 'g1', goal: 'G', by: 'Lt. A', what: 'x', constraints: [], ...more });

  it('passes whole lines, and lines of other kinds', () => {
    expect(lineProblem(intent())).toBeUndefined();
    expect(lineProblem({ kind: 'alert' })).toBeUndefined();
  });

  it('says what’s wrong with a broken intent', () => {
    expect(lineProblem(intent({ what: undefined }))).toBe('has no what');
    expect(lineProblem(intent({ goal: undefined }))).toBe('has a goal without both its id and title');
    expect(lineProblem(intent({ constraints: [1] }))).toBe('has constraints that aren’t a list of words');
  });

  it('as the ledger loads: a broken intent is reported and left out, its number still taken', () => {
    const line = (n: number, more: Record<string, unknown> = {}) => `${JSON.stringify({ v: 2, seq: n, at: n, projectId: 'p', ...intent(more) })}\n`;
    const check = checkLedger(line(1) + line(2, { constraints: 'none' }) + line(3));
    expect(check.problems).toEqual(['line 2 (intent) has constraints that aren’t a list of words']);
    expect(check.events.map((e) => e.seq)).toEqual([1, 3]);
    expect(check.nextSeq).toBe(4);
    expect(ledgerLine(check.events[0])).toContain('"kind":"intent"');
  });
});
