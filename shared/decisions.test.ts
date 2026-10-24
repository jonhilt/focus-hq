import { describe, expect, it } from 'vitest';
import { askProblem, decisionChangeProblem, decisionRegister, goalDecisions, goalIntent, intentEntry, lineProblem, projectIntents, raiseDecision, settleDecision } from './decisions';
import { checkLedger, type DecisionRecord, type LedgerEvent, ledgerLine } from './ledger';
import { fieldsOf } from './records';

let seq = 0;
const open = (id: string, at: number, more: Partial<DecisionRecord> = {}): LedgerEvent => ({
  projectId: 'p', seq: ++seq, at, kind: 'decision', id, status: 'open', goalId: 'g1', goal: 'Typed decisions', owner: 'Lt. A', by: 'Lt. A', question: `Which for ${id}?`, options: ['a', 'b'], ...more,
});
const decided = (id: string, at: number, more: Partial<DecisionRecord> = {}) => open(id, at, { status: 'decided', chosen: 'a', rationale: 'simpler', by: 'captain', ...more });

describe('decisionRegister', () => {
  it('keeps each decision as its latest line has it, raised when its first line was', () => {
    const d = decisionRegister([open('d1', 1), decided('d1', 5)]).get('d1');
    expect(d).toMatchObject({ status: 'decided', chosen: 'a', by: 'captain', raisedAt: 1, at: 5 });
  });

  it('reads a decision superseded once the one replacing it is decided, not while that one is only proposed', () => {
    const before = [decided('d1', 1), open('d2', 2, { supersedes: 'd1' })];
    expect(decisionRegister(before).get('d1')?.status).toBe('decided');
    const after = decisionRegister([...before, decided('d2', 3, { supersedes: 'd1', chosen: 'b' })]);
    expect(after.get('d1')).toMatchObject({ status: 'superseded', supersededBy: 'd2' });
    expect(after.get('d2')?.status).toBe('decided');
  });

  it('keeps a chain superseded: A replaced by B, B by C', () => {
    const events = [decided('A', 1), decided('B', 2, { supersedes: 'A' }), decided('C', 3, { supersedes: 'B' })];
    const r = decisionRegister(events);
    expect([r.get('A')?.status, r.get('B')?.status, r.get('C')?.status]).toEqual(['superseded', 'superseded', 'decided']);
    expect(goalDecisions(events, 'g1').decided.map((x) => x.id)).toEqual(['C']);
  });

  it('keeps A superseded when B, which replaced it, is itself later written as superseded', () => {
    const events = [decided('A', 1), decided('B', 2, { supersedes: 'A' }), decided('C', 3, { supersedes: 'B' }), decided('B', 4, { supersedes: 'A', status: 'superseded' })];
    expect(decisionRegister(events).get('A')?.status).toBe('superseded');
    expect(goalDecisions(events, 'g1').decided.map((x) => x.id)).toEqual(['C']);
  });

  it('lets an open proposal to replace a decision replace nothing, whatever else is in the chain', () => {
    const events = [decided('A', 1), decided('B', 2, { supersedes: 'A' }), open('C', 3, { supersedes: 'B', proposed: 'b' })];
    const r = decisionRegister(events);
    expect([r.get('A')?.status, r.get('B')?.status, r.get('C')?.status]).toEqual(['superseded', 'decided', 'open']);
    expect(r.get('B')?.supersededBy).toBeUndefined();
  });

  it('keeps to one project when asked', () => {
    expect(decisionRegister([open('d1', 1), { ...open('d2', 2), projectId: 'q' }], 'q').size).toBe(1);
  });
});

describe('goalDecisions', () => {
  it('splits a goal’s standing decisions into open and decided, oldest raised first, and leaves superseded ones out', () => {
    const events = [open('d3', 3), decided('d1', 1), open('d2', 2), decided('d4', 4, { supersedes: 'd1' }), { ...open('x', 0), goalId: 'g2' }];
    const { open: o, decided: d } = goalDecisions(events, 'g1');
    expect(o.map((x) => x.id)).toEqual(['d2', 'd3']);
    expect(d.map((x) => x.id)).toEqual(['d4']);
  });
});

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
  const line = (e: LedgerEvent) => fieldsOf(JSON.parse(JSON.stringify(e)));

  it('passes whole lines, and lines of other kinds', () => {
    expect(lineProblem(line(open('d1', 1, { proposed: 'a' })))).toBeUndefined();
    expect(lineProblem(line(decided('d1', 1, { rejected: [{ option: 'b', why: 'slower' }] })))).toBeUndefined();
    expect(lineProblem({ kind: 'alert' })).toBeUndefined();
  });

  it('says what’s wrong with a broken decision or intent', () => {
    expect(lineProblem({ ...line(open('d1', 1)), question: '' })).toBe('has no question');
    expect(lineProblem({ ...line(open('d1', 1)), status: 'maybe' })).toBe('has a status that isn’t open, decided, superseded');
    expect(lineProblem({ ...line(open('d1', 1)), options: 'a or b' })).toBe('has options that aren’t a list of words');
    expect(lineProblem(line(open('d1', 1, { status: 'decided' })))).toBe('is decided with nothing chosen');
    expect(lineProblem(line(open('d1', 1, { chosen: 'a' })))).toBe('is open with something chosen');
    expect(lineProblem(line(open('d1', 1, { supersedes: 'd1' })))).toBe('supersedes itself');
    expect(lineProblem({ ...line(decided('d1', 1)), rejected: [{ option: 'b' }] })).toBe('has rejected options without an option and why');
    expect(lineProblem({ kind: 'intent', goalId: 'g1', goal: 'G', by: 'Lt. A', constraints: [] })).toBe('has no what');
    expect(lineProblem({ kind: 'intent', goalId: 'g1', by: 'Lt. A', what: 'x', constraints: [] })).toBe('has a goal without both its id and title');
    expect(lineProblem({ kind: 'intent', goalId: 'g1', goal: 'G', by: 'Lt. A', what: 'x', constraints: [1] })).toBe('has constraints that aren’t a list of words');
  });

  it('as the ledger loads: a broken decision is reported and left out, its number still taken', () => {
    const broken = JSON.stringify({ v: 2, ...line({ ...open('d2', 2), seq: 2 }), status: 'maybe' });
    const check = checkLedger(ledgerLine({ ...open('d1', 1), seq: 1 }) + `${broken}\n` + ledgerLine({ ...open('d3', 3), seq: 3 }));
    expect(check.problems).toEqual(['line 2 (decision) has a status that isn’t open, decided, superseded']);
    expect(check.events.map((e) => e.seq)).toEqual([1, 3]);
    expect(check.nextSeq).toBe(4);
  });
});

describe('raiseDecision', () => {
  const goal = { id: 'g1', title: 'Typed decisions' };

  it('raises a decision on the lead’s goal, numbered in it, owned and written by the lead and open', () => {
    const first = raiseDecision([], goal, 'Lt. A', { question: ' JSON or markdown? ', options: ['JSON', ' markdown '], proposed: 'JSON' });
    expect(first).toEqual({ entry: { kind: 'decision', id: 'g1.d1', status: 'open', goalId: 'g1', goal: 'Typed decisions', owner: 'Lt. A', by: 'Lt. A', question: 'JSON or markdown?', options: ['JSON', 'markdown'], proposed: 'JSON' } });
    expect(raiseDecision([open('g1.d1', 1)], goal, 'Lt. A', { question: 'q', options: ['a', 'b'] })).toMatchObject({ entry: { id: 'g1.d2' } });
  });

  it('changes one still open, keeping who owns it', () => {
    expect(raiseDecision([open('g1.d1', 1, { owner: 'Lt. B' })], goal, 'Lt. A', { id: 'g1.d1', question: 'q?', options: ['a', 'c'] })).toMatchObject({ entry: { id: 'g1.d1', owner: 'Lt. B', by: 'Lt. A', options: ['a', 'c'] } });
  });

  it('refuses to raise a decided one again, another goal’s, odd options or a proposal not among them', () => {
    expect(raiseDecision([decided('g1.d1', 1)], goal, 'Lt. A', { id: 'g1.d1', question: 'q', options: ['a', 'b'] })).toEqual({ problem: 'g1.d1 is decided already: it isn’t raised again' });
    expect(raiseDecision([open('g2.d1', 1, { goalId: 'g2' })], goal, 'Lt. A', { id: 'g2.d1', question: 'q', options: ['a', 'b'] })).toEqual({ problem: 'There’s no decision g2.d1 on your goal' });
    expect(raiseDecision([], goal, 'Lt. A', { question: 'q', options: ['a'] })).toEqual({ problem: 'A decision needs 2 to 6 options' });
    expect(raiseDecision([], goal, 'Lt. A', { question: 'q', options: ['a', 'b'], proposed: 'c' })).toEqual({ problem: 'What you propose has to be one of the options, word for word' });
    expect(raiseDecision([], goal, 'Lt. A', { question: ' ', options: ['a', 'b'] })).toEqual({ problem: 'The decision has no question' });
  });
});

describe('settleDecision', () => {
  it('decides an open one as chosen, the other options rejected', () => {
    const settled = settleDecision([open('d1', 1, { proposed: 'a' })], 'd1', 'captain', 'b', ' less churn ');
    expect(settled).toEqual({ entry: expect.objectContaining({ kind: 'decision', id: 'd1', status: 'decided', by: 'captain', chosen: 'b', rationale: 'less churn', proposed: 'a', rejected: [{ option: 'a', why: 'captain chose b' }] }) });
    expect(lineProblem('entry' in settled ? settled.entry : {})).toBeUndefined();
  });

  it('refuses one that isn’t there or isn’t open', () => {
    expect(settleDecision([], 'd1', 'captain', 'a')).toEqual({ problem: 'There’s no decision d1' });
    expect(settleDecision([decided('d1', 1)], 'd1', 'captain', 'b')).toEqual({ problem: 'd1 is decided already' });
  });
});

describe('decisionChangeProblem', () => {
  const entry = (e: LedgerEvent) => {
    if (e.kind !== 'decision') throw new Error('not a decision');
    const { at: _a, projectId: _p, seq: _s, ...rest } = e;
    return rest;
  };

  it('lets an open decision change, or be decided', () => {
    expect(decisionChangeProblem([open('d1', 1)], entry(decided('d1', 2)))).toBeUndefined();
    expect(decisionChangeProblem([], entry(open('d1', 1)))).toBeUndefined();
  });

  it('never reopens or re-decides a decided one, and keeps a decision on its goal', () => {
    expect(decisionChangeProblem([decided('d1', 1)], entry(open('d1', 2)))).toBe('d1 is decided already: a new decision supersedes it instead');
    expect(decisionChangeProblem([decided('d1', 1)], entry(decided('d1', 2, { chosen: 'b' })))).toBe('d1 is decided already: a new decision supersedes it instead');
    expect(decisionChangeProblem([open('d1', 1)], entry(open('d1', 2, { goalId: 'g2' })))).toBe('d1 is another goal’s');
  });

  it('supersedes only a standing decision of the same goal', () => {
    expect(decisionChangeProblem([decided('d1', 1)], entry(open('d2', 2, { supersedes: 'd1' })))).toBeUndefined();
    expect(decisionChangeProblem([open('d1', 1)], entry(open('d2', 2, { supersedes: 'd1' })))).toBe('d1 isn’t a decision of this goal’s that stands');
    expect(decisionChangeProblem([decided('d1', 1, { goalId: 'g2' })], entry(open('d2', 2, { supersedes: 'd1' })))).toBe('d1 isn’t a decision of this goal’s that stands');
  });
});

describe('askProblem', () => {
  it('lets the lead put an open decision of their goal to the captain, its options as the labels', () => {
    expect(askProblem([open('d1', 1)], 'g1', 'd1', ['a', ' b'])).toBeUndefined();
    expect(askProblem([open('d1', 1)], 'g1', 'd1', ['a', 'c'])).toBe('Label each option as one of d1’s options, word for word (“c” isn’t)');
    expect(askProblem([decided('d1', 1)], 'g1', 'd1', ['a', 'b'])).toBe('d1 is decided already');
    expect(askProblem([open('d1', 1)], 'g2', 'd1', ['a', 'b'])).toBe('There’s no decision d1 on your goal');
  });
});
