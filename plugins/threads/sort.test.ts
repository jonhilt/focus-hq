import { describe, expect, it } from 'vitest';
import type { GoalRecord, LedgerEvent } from '../../plugin-api/shared';
import type { Thread } from './shared';
import { closedGoals, demoAnswer, proposalsFrom, sortPrompt, sortRecord } from './sort';

const at = (d: number) => Date.UTC(2026, 9, d);
const thread = (contact: string, more: Partial<Thread> = {}): Thread =>
  ({ goal: 'g1', goalTitle: 'Checkout', leadName: 'Lt. Reyes', contact, text: `thread ${contact}`, at: at(10), slice: 1, closedAt: at(12), ...more });
const record = (id: string, closedAt: number, more: Partial<GoalRecord> = {}): GoalRecord =>
  ({ id, title: `Goal ${id}`, slices: 1, prs: [], leadName: 'Lt. Reyes', openedAt: 0, closedAt, ...more });

describe('what the model is told', () => {
  it('reads each goal as it last closed, the latest first, of the project asked about', () => {
    const line = (seq: number, projectId: string, goal: GoalRecord): LedgerEvent => ({ seq, at: goal.closedAt, projectId, kind: 'goal-closed', goal });
    const goals = closedGoals([line(1, 'shop', record('g1', at(3))), line(2, 'blog', record('g2', at(4))), line(3, 'shop', record('g3', at(5))), line(4, 'shop', record('g1', at(6), { title: 'Again' }))], 'shop');
    expect(goals.map((g) => g.title)).toEqual(['Again', 'Goal g3']);
  });

  it('lists the goals under way and closed, then each thread by an id of its own, saying where it came from', () => {
    const prompt = sortPrompt([thread('c1'), thread('next-abc', { idea: true, text: 'Remember more than one address' })], {
      now: at(24),
      closed: [record('g2', at(15), { title: 'Saved addresses', note: { done: 'A shopper keeps three addresses', learned: ['The lookup needs a key'], next: [] } })],
      leads: [{ lead: { title: 'Save for later', repos: [], slice: 1, prs: [], note: { done: 'Items saved across devices', learned: [], next: ['Share a list'] } } }],
    });
    expect(prompt).toBe([
      'Today is 2026-10-24.',
      'The project’s intents: none agreed yet.',
      'Goals under way:\n- “Save for later”: done looks like: Items saved across devices; next: Share a list',
      'Goals closed, the latest first:\n- “Saved addresses” (closed 2026-10-15): done looked like: A shopper keeps three addresses; learned: The lookup needs a key',
      'The user’s latest decisions on this project, oldest first:\n- none',
      'Threads to decide:\nt1 · from “Checkout” (closed 2026-10-12) · contact, noticed 2026-10-10 · thread c1\nt2 · from “Checkout” (closed 2026-10-12) · idea for next · Remember more than one address',
    ].join('\n\n'));
    expect(sortPrompt([thread('c1')], { now: at(24), closed: [], leads: [] })).toMatch(/^Today is 2026-10-24\.\n\nThe project’s intents: none agreed yet\.\n\nGoals under way:\n- none\n\nGoals closed, the latest first:\n- none/);
  });

  it('starts with the project’s compass, when it has one: what it’s for, its guardrails, and each intent', () => {
    const line = (seq: number, more: { id?: string; what: string; constraints?: string[] }): Extract<LedgerEvent, { kind: 'intent' }> =>
      ({ seq, at: seq, projectId: 'shop', kind: 'intent', by: 'the user', constraints: [], ...more });
    const compass = [line(1, { what: 'A shop people trust', constraints: ['Never break checkout', 'Build only what shoppers ask for'] }), line(2, { id: 'value', what: 'Deliver value: orders arrive' }), line(3, { id: 'reach', what: 'More shoppers' })];
    expect(sortPrompt([thread('c1')], { now: at(24), closed: [], leads: [], intents: compass }).split('\n\n')[1]).toBe([
      'What the project is for: A shop people trust',
      'Its guardrails, how the work is done: Never break checkout; Build only what shoppers ask for',
      'Its intents, what the work is for:\n- Deliver value: orders arrive\n- More shoppers',
    ].join('\n'));
    expect(sortPrompt([thread('c1')], { now: at(24), closed: [], leads: [], intents: compass.slice(1) }).split('\n\n')[1]).toMatch(/^What the project is for: not said\nIts intents/);
  });
});

describe('the record a sort reads', () => {
  it('reads a project’s goals with their pull requests, merged at the close or since, and the user’s decisions that say something', () => {
    const ev = (seq: number, entry: Record<string, unknown>, projectId = 'shop') => ({ seq, at: at(seq), projectId, ...entry }) as LedgerEvent;
    const pr = (number: number, outcome?: 'merged') => ({ repo: 'acme/api', number, url: '', ...(outcome && { outcome }) });
    const decided = (seq: number, answer: string, projectId = 'shop') => ev(seq, { kind: 'captain-decision', agent: 'Lt. Reyes', goal: 'Saved addresses', item: { id: 'q', kind: 'turn', what: 'Keep the toggle?' }, answer, via: 'api' }, projectId);
    const events = [
      ev(1, { kind: 'goal-closed', goal: record('g2', at(1), { title: 'Saved addresses', prs: [pr(12, 'merged'), pr(13), pr(14)] }) }),
      ev(2, { kind: 'merged', repo: 'acme/api', pr: 13, by: 'github', qa: 'passed', failedRounds: 0, triages: 0 }),
      ev(3, { kind: 'merged', repo: 'acme/api', pr: 14, by: 'github', qa: 'passed', failedRounds: 0, triages: 0 }, 'blog'),
      decided(4, 'Keep the toggle and log the cleanup as a loose thread.'),
      decided(5, 'Sent the chief of staff’s words'),
      decided(6, 'continue'),
      decided(7, 'Drop the map picker, nobody asked for it', 'blog'),
      ev(8, { kind: 'intent', by: 'the user', what: 'A shop people trust', constraints: [] }),
    ];
    const r = sortRecord(events, 'shop', [], at(24));
    expect(r.decisions).toEqual([{ at: at(4), goal: 'Saved addresses', asked: 'Keep the toggle?', said: 'Keep the toggle and log the cleanup as a loose thread.' }]);
    expect(r.intents?.map((i) => i.what)).toEqual(['A shop people trust']);
    expect(sortPrompt([thread('c1')], r).split('\n\n').slice(3, 5)).toEqual([
      'Goals closed, the latest first:\n- “Saved addresses” (closed 2026-10-01): pull requests: api#12 merged, api#13 merged, api#14 open',
      'The user’s latest decisions on this project, oldest first:\n- 2026-10-04 · “Saved addresses” · asked: Keep the toggle? · said: Keep the toggle and log the cleanup as a loose thread.',
    ]);
  });
});

describe('the proposals taken from the model’s answer', () => {
  const listed = [thread('c1'), thread('c2', { goal: 'g2', goalTitle: 'Saved addresses', text: 'Postcode lookup for saved addresses' }), thread('c3')];

  it('takes one whole proposal per listed thread, the first, by the ids it was given', () => {
    const answer = { proposals: [
      { id: 't1', as: 'dropped', why: '  Overtaken   by the redesign ' },
      { id: 't1', as: 'next', why: 'you' },
      { id: 't3', as: 'shelved', why: 'nope' },
      { id: 't3', as: 'parked', why: '' },
      { id: 't9', as: 'next', why: 'you' },
      { id: 'c2', as: 'next', why: 'you' },
      'not a proposal',
      { id: 't2', as: 'resolved', why: 'by “Saved addresses”' },
    ] };
    expect(proposalsFrom(answer, listed)).toEqual([
      { goalId: 'g1', contact: 'c1', as: 'dropped', note: 'Overtaken by the redesign' },
      { goalId: 'g2', contact: 'c2', as: 'resolved', note: 'by “Saved addresses”' },
    ]);
  });

  it('says which thread one says the same as, and keeps a note to a decision’s length', () => {
    const [same] = proposalsFrom({ proposals: [{ id: 't3', as: 'resolved', why: 'the same check', sameAs: 't2' }] }, listed);
    expect(same?.note).toBe('Same as “Postcode lookup for saved addresses” (Saved addresses): the same check');
    const [long] = proposalsFrom({ proposals: [{ id: 't1', as: 'dropped', why: 'x'.repeat(300) }] }, listed);
    expect(long?.note).toHaveLength(160);
    expect(proposalsFrom({ proposals: [{ id: 't1', as: 'dropped', why: 'itself', sameAs: 't1' }] }, listed)[0]?.note).toBe('itself');
  });

  it('takes nothing from an answer that isn’t one', () => {
    expect(proposalsFrom(undefined, listed)).toEqual([]);
    expect(proposalsFrom({ proposals: 'none' }, listed)).toEqual([]);
    expect(proposalsFrom('dropped', listed)).toEqual([]);
  });
});

describe('the demo’s stand-in for the model', () => {
  it('sends an idea to a goal under way it shares words with, drops the other ideas, and gives contacts to the captain', () => {
    const lead = { lead: { title: 'Shoppers can save items for later', repos: [], slice: 1, prs: [] } };
    const answer = demoAnswer([thread('c1'), thread('n1', { idea: true, text: 'Let shoppers save items for later' }), thread('n2', { idea: true, text: 'Prefill the address' })], [lead]);
    expect(proposalsFrom(answer, [thread('c1'), thread('n1', { idea: true }), thread('n2', { idea: true })]).map((p) => [p.contact, p.as, p.note])).toEqual([
      ['c1', 'next', 'you'],
      ['n1', 'next', '“Shoppers can save items for later”, under way'],
      ['n2', 'dropped', 'Its goal closed without it, and nothing since has picked it up'],
    ]);
  });
});
