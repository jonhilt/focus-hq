import { describe, expect, it } from 'vitest';
import type { JournalEntry, LedgerEvent, ReviewEntry, RunFact, SliceFact } from '../../plugin-api/server';
import { demoWorkspace, focus, leadOpensPrs, until } from '../../plugin-api/testing';
import { captainsLog, type LogSources, logSources } from './log';
import captainsLogPlugin from './server';
import type { LogLine } from './shared';

let seq = 0;
const at = <F>(t: number, fact: F) => ({ v: 1 as const, seq: ++seq, t, ...fact });
const sources = (s: Partial<LogSources>): LogSources => ({ runs: [], reviews: [], slices: [], ledger: [], nameOf: () => undefined, ...s });

describe('the captain’s log', () => {
  it('tells a crew member’s run by what a captain would want to hear, not Ops’ bookkeeping', () => {
    const entries = [
      at<RunFact>(10, { kind: 'queued', text: 'Fix it', at: 'end' }),
      at<RunFact>(11, { kind: 'turn-requested', turn: 't1', turnKind: 'work', prompt: 'Fix it' }),
      at<RunFact>(12, { kind: 'turn-started', turn: 't1', session: 's1' }),
      at<RunFact>(13, { kind: 'asked', turn: 't1', tool: 'Bash', summary: 'npm publish' }),
      at<RunFact>(14, { kind: 'answered', turn: 't1', allow: true }),
      at<RunFact>(15, { kind: 'turn-ended', turn: 't1', outcome: { ok: true } }),
      at<RunFact>(16, { kind: 'held', until: 99 }),
      at<RunFact>(17, { kind: 'interrupted', turn: 't2' }),
      at<RunFact>(18, { kind: 'turn-ended', turn: 't3', outcome: { ok: false, error: 'Tests failed' } }),
    ] as JournalEntry[];
    const log = captainsLog(sources({ runs: [{ key: 'a1', who: 'Ens. Park', projectId: 'p', agentId: 'a1', entries }] }), 0);
    expect(log.map((l) => [l.t, l.kind, l.who])).toEqual([[13, 'asked', 'Ens. Park'], [14, 'answered', 'Ens. Park'], [16, 'held', 'Ens. Park'], [17, 'interrupted', 'Ens. Park'], [18, 'failed', 'Ens. Park']]);
    expect(log[0]).toMatchObject({ source: 'run', tag: 'Hand up', tone: 'warn', text: 'Hand up: approval for npm publish', projectId: 'p', agentId: 'a1' });
    expect(log.at(-1)?.text).toBe('Turn failed: Tests failed');
  });

  it('tells a goal’s ships and moves with the slice, its title and its pull requests', () => {
    const entries = [
      at<SliceFact>(1, { kind: 'started', slice: 1, branch: 'b1' }),
      at<SliceFact>(2, { kind: 'shipping', title: 'Saved items', summary: 's' }),
      at<SliceFact>(3, { kind: 'pr', repo: 'o/web', number: 4, url: 'u', sha: 'abc', branch: 'b1' }),
      at<SliceFact>(4, { kind: 'shipped' }),
      at<SliceFact>(5, { kind: 'shipping', title: 'Fix', summary: 's' }),
      at<SliceFact>(6, { kind: 'ship-ended', error: 'Commit first' }),
      at<SliceFact>(7, { kind: 'landed', repo: 'o/web', number: 4, merged: true }),
      at<SliceFact>(8, { kind: 'moving', slice: 2, branch: 'b2', from: 'b1', repos: [], carry: [] }),
      at<SliceFact>(9, { kind: 'moved' }),
    ];
    const log = captainsLog(sources({ slices: [{ key: 'lead1', who: 'Lt. Oyelaran', goal: 'Saved items', entries }] }), 0);
    expect(log.map((l) => l.text)).toEqual(['Took up the goal: slice 1', 'Shipped slice 1: Saved items → web #4', "Couldn't ship “Fix”: Commit first", 'Slice 2 starts on fresh code']);
    expect(log[1]).toMatchObject({ source: 'slice', kind: 'shipped', tone: 'ok', who: 'Lt. Oyelaran', goal: 'Saved items' });
  });

  it('names QA by who’s reviewing, and leaves verdicts and merges to the ledger', () => {
    const entries = [
      at(1, { kind: 'requested' }),
      at(2, { kind: 'seated', agent: 'qa_p' }),
      at(3, { kind: 'restarted' }),
      at(4, { kind: 'seated', agent: 'qa_p' }),
      at(5, { kind: 'testing', sha: 'abcdef12345' }),
      at(6, { kind: 'ended', error: 'Stopped' }),
    ] as ReviewEntry[];
    const ledger = [{ kind: 'qa-verdict', repo: 'o/web', pr: 4, verdict: 'fail', reviewer: 'Lt. Quintero', checks: { pass: 3, fail: 1, skip: 0 }, failedRounds: 1, at: 7, projectId: 'p', seq: 1 }] as LedgerEvent[];
    const log = captainsLog(sources({ reviews: [{ key: 'o/web#4', who: 'QA', entries }], ledger, nameOf: (id) => (id === 'qa_p' ? 'Lt. Quintero' : undefined) }), 0);
    expect(log.map((l) => [l.kind, l.who, l.source])).toEqual([['restarted', 'Lt. Quintero', 'review'], ['testing', 'Lt. Quintero', 'review'], ['failed', 'Lt. Quintero', 'review'], ['fail', 'Lt. Quintero', 'ledger']]);
    expect(log[1].text).toBe('Testing web#4 at abcdef1');
    expect(log[3]).toMatchObject({ tag: 'QA fail', tone: 'bad', projectId: 'p', text: 'web #4 · 1 of 4 checks failed · fail 1' });
  });

  it('names the chief of staff, and quotes in full what it would have said and to whom', () => {
    const ledger = [{ kind: 'cos-verdict', sessionId: 's1', agent: 'Lt. Oyelaran', goal: 'Saved items', turnUuid: 'u', route: 2, why: 'A design choice with the lead’s pick.', message: 'Lt. Oyelaran wants to keep saved items per device. Shall they?', model: 'haiku', version: 'v6', at: 3, projectId: 'p', seq: 1 }] as LedgerEvent[];
    expect(captainsLog(sources({ ledger }), 0)).toEqual([expect.objectContaining({
      who: 'Chief of Staff', tag: 'CoS', text: 'CoS: card — A design choice with the lead’s pick. · Lt. Oyelaran', goal: 'Saved items',
      quotes: ['To the captain: “Lt. Oyelaran wants to keep saved items per device. Shall they?”'],
    })]);
  });

  it('names the chief of staff on a ship’s lane, read or raised', () => {
    const ledger: LedgerEvent[] = [
      { kind: 'cos-lane', agent: 'Lt. Oyelaran', goal: 'Saved items', prs: [{ repo: 'o/web', pr: 4, sha: 'abc' }], from: 'ship', to: 'ask', why: 'It changes a card.', model: 'haiku', version: 'lane-v1', at: 3, projectId: 'p', seq: 1 },
      { kind: 'lane-raised', repo: 'o/web', pr: 4, goal: 'Saved items', from: 'ship', to: 'ask', by: 'chief-of-staff', why: 'It changes a card.', at: 3, projectId: 'p', seq: 2 },
    ];
    expect(captainsLog(sources({ ledger }), 0).map((l) => l.who)).toEqual(['Chief of Staff', 'Chief of Staff']);
  });

  it('keeps to the window, oldest first, the ledger first at the same moment', () => {
    const runs = [{ key: 'a', who: 'A', entries: [at<RunFact>(5, { kind: 'held', until: 9 }), at<RunFact>(20, { kind: 'unheld' })] as JournalEntry[] }];
    const ledger = [{ kind: 'closed', repo: 'o/web', pr: 4, by: 'captain', qa: 'none', failedRounds: 0, triages: 0, at: 20, projectId: 'p', seq: 2 }] as unknown as LedgerEvent[];
    expect(captainsLog(sources({ runs, ledger }), 10).map((l) => [l.t, l.source])).toEqual([[20, 'ledger'], [20, 'run']]);
  });
});

describe('who and what each journal is about', () => {
  it('names a crew member who’s gone home from the ledger, and a review’s room and goal from its pull request', () => {
    const ledger = [
      { kind: 'session-digest', agentId: 'dev1', agent: 'Ens. Park', at: 1, projectId: 'p', seq: 1 },
      { kind: 'goal-closed', goal: { id: 'lead1', leadName: 'Lt. Oyelaran', title: 'Saved items' }, at: 2, projectId: 'p', seq: 2 },
    ] as unknown as LedgerEvent[];
    const agents = [{ id: 'lead2', name: 'Lt. Reyes', projectId: 'p', lead: { title: 'Search', prs: [{ repo: 'o/web', number: 4 }] } }] as never;
    const projects = [{ id: 'p', repos: ['o/web'] }] as never;
    const journals = { runs: [{ key: 'dev1', entries: [] }, { key: 'gone', entries: [] }], reviews: [{ key: 'o/web#4', entries: [] }], slices: [{ key: 'lead1', entries: [] }, { key: 'lead3', entries: [] }] };
    const s = logSources({ journals, agents, projects, ledger });
    expect(s.runs.map((r) => r.who)).toEqual(['Ens. Park', 'A crew member who’s gone home']);
    expect(s.reviews[0]).toMatchObject({ who: 'QA', projectId: 'p', goal: 'Search' });
    expect(s.slices.map((r) => [r.who, r.goal])).toEqual([['Lt. Oyelaran', 'Saved items'], ['A lead who’s gone home', undefined]]);
    expect(s.nameOf('lead2')).toBe('Lt. Reyes');
  });
});

describe('the captain’s log of a real ship', () => {
  it('has a goal’s pull request going out, by its lead, and QA picking it up, by the reviewer', async () => {
    // QA's checkout is instant, so QA's testing in good time
    const { store, agents, claude, project, github } = focus({ ...demoWorkspace, checkoutPullRequest: async () => '' });
    agents.startPlugins([captainsLogPlugin], { demo: false, ownRepo: () => undefined });
    const route = agents.plugins.routes().find((r) => r.plugin === 'captains-log' && r.route.path === '/log')!.route;
    const { agent } = agents.startGoal(project.id, 'Saved items') as { agent: { id: string; name: string } };
    await until(() => claude.turns.length === 1);
    await leadOpensPrs({ agents, store, github }, agent.id, 'Saved items, first slice');
    await until(() => [...store.reviews.values()].some((r) => r.status === 'testing'));
    const log = route.handle({ body: {}, query: {}, params: {} }) as LogLine[];
    expect(log.find((l) => l.kind === 'shipped')).toMatchObject({ who: agent.name, goal: 'Saved items', projectId: project.id, text: expect.stringMatching(/^webshop-\w+ #\d+ · ready for review/) });
    const testing = log.find((l) => l.kind === 'testing');
    expect(testing?.who).toBe(store.agent([...store.reviews.values()].find((r) => r.status === 'testing')!.agentId!).name);
    expect(testing).toMatchObject({ projectId: project.id, goal: 'Saved items' });
  });
});
