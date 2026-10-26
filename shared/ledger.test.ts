import { describe, expect, it } from 'vitest';
import { checkLedger, closedGoals, fixEffects, frictionGroups, frictionName, knownSignatures, type LedgerEvent, ledgerLine, reportCard, reportLines, type SessionFacts, unreadDigests, viaNote } from './ledger';

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
    const lines = reportLines({ ...reportCard([merged(1, 'passed')], NOW), warnings: ['line 3 is missing'], notes: ['another Focus is writing it'] }).lines;
    expect(lines.slice(0, 2)).toEqual(['⚠ Ledger damaged: line 3 is missing', 'Ledger: another Focus is writing it']);
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

  it('leaves out, quietly, a decision line an older Focus wrote, its number still taken', () => {
    const decision = JSON.stringify({ v: 2, seq: 2, at: 2, projectId: 'p', kind: 'decision', id: 'g.d1', status: 'open', goalId: 'g', goal: 'G', owner: 'L', by: 'L', question: 'q?', options: ['a', 'b'] });
    const check = checkLedger(`${text(1)}${decision}\n${text(3)}`);
    expect(check).toMatchObject({ nextSeq: 4, problems: [] });
    expect(check.events.map((e) => e.seq)).toEqual([1, 3]);
  });

  it('reports damage in the middle rather than skipping it quietly', () => {
    expect(checkLedger(text(1, 2) + 'not json\n' + text(5, 5)).problems).toEqual(['line 3 isn’t readable', 'lines 3–4 are missing', 'line 5 repeats or goes back to number 5']);
  });

  it('reports a line that parses but isn’t an object, rather than failing to read the ledger', () => {
    const check = checkLedger(text(1) + 'null\n' + '[1]\n' + '"text"\n' + text(2));
    expect(check.problems).toEqual(['line 2 isn’t an event', 'line 3 isn’t an event', 'line 4 isn’t an event']);
    expect(check.events.map((e) => e.seq)).toEqual([1, 2]);
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

describe('frictionGroups', () => {
  const friction = (session: string, signature: string, at = NOW - DAY, kind: 'demo-env' | 'shell' = 'demo-env'): LedgerEvent => ({ ...(digest({}) as Extract<LedgerEvent, { kind: 'session-digest' }>), sessionId: session, agent: `Ens. ${session}`, at, frictions: [{ kind, signature, quote: `${signature} in ${session}` }] });

  it('groups by kind and signature, counting each session once, most widespread first', () => {
    const groups = frictionGroups([friction('a', 'port in use'), friction('a', 'port in use'), friction('b', 'port in use'), friction('c', 'port in use'), friction('a', 'glob', NOW - DAY, 'shell')], NOW, 14);
    expect(groups.map((g) => [g.key, g.sessions, g.moments.length])).toEqual([['demo-env: port in use', 3, 3], ['shell: glob', 1, 1]]);
  });

  it('leaves out what came before the window, and what the captain already decided on', () => {
    const decided: LedgerEvent = { projectId: 'p', seq: ++seq, at: NOW - DAY, kind: 'retro-decision', title: 'Ports', signatures: ['demo-env: port in use'], accepted: false };
    expect(frictionGroups([friction('a', 'old', NOW - 20 * DAY), friction('b', 'port in use'), decided], NOW, 14)).toEqual([]);
  });

  it('puts the open ones of the last two weeks on the report card, most widespread first, for the retro to show', () => {
    const events = [friction('a', 'port in use'), friction('b', 'port in use'), friction('c', 'glob', NOW - DAY, 'shell'), friction('d', 'old', NOW - 20 * DAY)];
    expect(reportCard(events, NOW).frictions).toEqual([{ key: 'demo-env: port in use', sessions: 2 }, { key: 'shell: glob', sessions: 1 }]);
  });
});

describe('fixEffects', () => {
  const T = NOW - 10 * DAY;
  const PORT = 'demo-env: demo port in use';
  const session = (id: string, at: number, port: boolean): LedgerEvent => ({ ...(digest({}) as Extract<LedgerEvent, { kind: 'session-digest' }>), sessionId: id, at, frictions: port ? [{ kind: 'demo-env', signature: 'demo port in use', quote: 'EADDRINUSE' }] : [] });
  const accepted: LedgerEvent = { projectId: 'p', seq: ++seq, at: T, kind: 'retro-decision', title: 'Give each workspace its own demo port', signatures: [PORT], accepted: true, issue: { repo: 'o/r', number: 9 } };
  const landing = (at: number): LedgerEvent => ({ ...merged(31, 'passed', 0, at), closes: [9] } as LedgerEvent);
  const beforeIt = [session('b1', T - DAY, true), session('b2', T - DAY, true), session('b3', T - DAY, false), session('b4', T - DAY, false)];
  const after = (n: number, hits: number, from: number) => Array.from({ length: n }, (_, i) => session(`a${i}`, from + (i + 1) * 1000, i < hits));

  it('waits for the merge that closes its issue', () => {
    expect(fixEffects([...beforeIt, accepted, merged(30, 'passed', 0, T + DAY)], NOW)).toMatchObject([{ status: 'waiting', before: { hits: 2, sessions: 4 }, after: { hits: 0, sessions: 0 } }]);
  });

  it('says it’s too early until enough sessions have been digested since it landed', () => {
    const land = T + DAY;
    expect(fixEffects([...beforeIt, accepted, landing(land), ...after(4, 0, land)], NOW)[0]).toMatchObject({ status: 'too-early', landed: { repo: 'o/r', pr: 31, at: land } });
  });

  it('tells stopped from fewer from still recurring, by share of sessions', () => {
    const land = T + DAY;
    expect(fixEffects([...beforeIt, accepted, landing(land), ...after(5, 0, land)], NOW)[0]).toMatchObject({ status: 'stopped', after: { hits: 0, sessions: 5 } });
    expect(fixEffects([...beforeIt, accepted, landing(land), ...after(5, 1, land)], NOW)[0].status).toBe('fewer');
    expect(fixEffects([...beforeIt, accepted, landing(land), ...after(6, 3, land)], NOW)[0].status).toBe('recurring');
  });

  it('leaves out rejected drafts, and sums them up on the report card', () => {
    const rejected: LedgerEvent = { ...accepted, seq: ++seq, accepted: false, title: 'No' };
    const land = T + DAY;
    const card = reportCard([...beforeIt, accepted, rejected, landing(land), ...after(5, 0, land)], NOW);
    expect(card.fixes).toHaveLength(1);
    expect(reportLines(card).lines.at(-1)).toBe('Retro fixes: 1 accepted · 1 landed · 1 stopped it');
  });
});

describe('frictions read at retro time', () => {
  const span = (id: string, frictions?: { kind: 'shell'; signature: string; quote: string }[]): LedgerEvent => ({ ...(digest({}) as Extract<LedgerEvent, { kind: 'session-digest' }>), key: `${id}:u`, sessionId: id, ...(frictions && { frictions }) });
  const read = (id: string, signature: string): LedgerEvent => ({ projectId: 'p', seq: ++seq, at: NOW - DAY, kind: 'session-frictions', key: `${id}:u`, sessionId: id, frictions: [{ kind: 'shell', signature, quote: 'q' }], reader: 'retro' });

  it('counts what the reader found, alongside what Haiku found before', () => {
    const events = [span('a', [{ kind: 'shell', signature: 'zsh glob', quote: 'q' }]), span('b'), span('c'), read('b', 'zsh glob'), read('c', 'zsh glob')];
    expect(frictionGroups(events, NOW, 14).map((g) => [g.key, g.sessions])).toEqual([['shell: zsh glob', 3]]);
    expect(knownSignatures(events)).toEqual(['shell: zsh glob']);
  });

  it('knows which spans are still to be read', () => {
    expect(unreadDigests([span('a'), span('b'), read('a', 'x')], NOW, 14).map((d) => d.sessionId)).toEqual(['b']);
  });
});

describe('closedGoals', () => {
  const closed = (id: string, projectId: string, closedAt: number): LedgerEvent =>
    ({ projectId, seq: ++seq, at: closedAt, kind: 'goal-closed', goal: { id, title: id, slices: 1, prs: [], leadName: 'Lt. A', openedAt: 0, closedAt } });

  it('lists every goal the ledger saw close, newest first, each once as it last closed, with its room', () => {
    const goals = closedGoals([closed('g1', 'p', 1), merged(1, 'passed'), closed('g2', 'q', 2), closed('g1', 'p', 3)]);
    expect(goals.map((g) => [g.id, g.projectId, g.closedAt])).toEqual([['g1', 'p', 3], ['g2', 'q', 2]]);
  });

  it('keeps to one room when asked', () => {
    expect(closedGoals([closed('g1', 'p', 1), closed('g2', 'q', 2)], 'q').map((g) => g.id)).toEqual(['g2']);
  });
});

describe('frictionName', () => {
  it('splits a friction key back into its kind and signature, at the first colon', () => {
    expect(frictionName('shell: bash exit code 1')).toEqual({ kind: 'shell', signature: 'bash exit code 1' });
    expect(frictionName('captain-nudge: agent stopped: says continue')).toEqual({ kind: 'captain-nudge', signature: 'agent stopped: says continue' });
    expect(frictionName('no kind')).toEqual({ kind: '', signature: 'no kind' });
  });
});

describe('viaNote', () => {
  it('says nothing for the captain in Focus, the API for a bot, and a plugin that acted itself by its id in words', () => {
    expect(viaNote('office')).toBe('');
    expect(viaNote('api')).toBe('via the API');
    expect(viaNote('quarter-master')).toBe('sent by the quarter master');
  });
});
