import { describe, expect, it } from 'vitest';
import type { GoalRecord, LedgerEvent } from '../../plugin-api/shared';
import type { Thread } from './shared';
import { closedGoals, demoAnswer, proposalsFrom, SORT_LIMIT, sortPrompt, toSort } from './sort';

const at = (d: number) => Date.UTC(2026, 9, d);
const thread = (contact: string, more: Partial<Thread> = {}): Thread =>
  ({ goal: 'g1', goalTitle: 'Checkout', leadName: 'Lt. Reyes', contact, text: `thread ${contact}`, at: at(10), slice: 1, closedAt: at(12), ...more });
const record = (id: string, closedAt: number, more: Partial<GoalRecord> = {}): GoalRecord =>
  ({ id, title: `Goal ${id}`, slices: 1, prs: [], leadName: 'Lt. Reyes', openedAt: 0, closedAt, ...more });

describe('which threads a sort asks about', () => {
  it('asks about a closed goal’s threads still to decide, the ones never proposed first, then the oldest', () => {
    const threads = [
      thread('c1', { at: at(5), proposed: { as: 'dropped', note: 'stale', at: at(13) } }),
      thread('c2', { at: at(9) }),
      thread('c3', { at: at(7) }),
      thread('c4', { decided: { as: 'parked', note: 'later', at: at(13) } }),
      thread('c5', { goal: 'g9' }),
    ];
    expect(toSort(threads, new Set(['g9'])).map((t) => t.contact)).toEqual(['c3', 'c2', 'c1']);
  });

  it('asks about every thread to decide in one call, up to a limit', () => {
    const many = Array.from({ length: SORT_LIMIT + 5 }, (_, i) => thread(`c${i}`, { at: i }));
    expect(toSort(many, new Set())).toHaveLength(SORT_LIMIT);
    expect(toSort(undefined, new Set())).toEqual([]);
  });
});

describe('what the model is told', () => {
  it('reads each goal as it last closed, the latest first, of the project asked about', () => {
    const line = (seq: number, projectId: string, goal: GoalRecord): LedgerEvent => ({ seq, at: goal.closedAt, projectId, kind: 'goal-closed', goal });
    const goals = closedGoals([line(1, 'shop', record('g1', at(3))), line(2, 'blog', record('g2', at(4))), line(3, 'shop', record('g3', at(5))), line(4, 'shop', record('g1', at(6), { title: 'Again' }))], 'shop');
    expect(goals.map((g) => g.title)).toEqual(['Again', 'Goal g3']);
  });

  it('lists the goals under way and closed, then each thread by an id of its own, saying where it came from', () => {
    const prompt = sortPrompt(
      [thread('c1'), thread('next-abc', { idea: true, text: 'Remember more than one address' })],
      [record('g2', at(15), { title: 'Saved addresses', note: { done: 'A shopper keeps three addresses', learned: ['The lookup needs a key'], next: [] } })],
      [{ lead: { station: 0, title: 'Save for later', repos: [], slice: 1, prs: [], note: { done: 'Items saved across devices', learned: [], next: ['Share a list'] } } }],
      at(24),
    );
    expect(prompt).toBe([
      'Today is 2026-10-24.',
      'Goals under way:\n- “Save for later”: done looks like: Items saved across devices; next: Share a list',
      'Goals closed, the latest first:\n- “Saved addresses” (closed 2026-10-15): done looked like: A shopper keeps three addresses; learned: The lookup needs a key',
      'Threads to decide:\nt1 · from “Checkout” (closed 2026-10-12) · contact, noticed 2026-10-10 · thread c1\nt2 · from “Checkout” (closed 2026-10-12) · idea for next · Remember more than one address',
    ].join('\n\n'));
    expect(sortPrompt([thread('c1')], [], [], at(24))).toMatch(/^Today is 2026-10-24\.\n\nGoals under way:\n- none\n\nGoals closed, the latest first:\n- none/);
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
    const lead = { lead: { station: 0, title: 'Shoppers can save items for later', repos: [], slice: 1, prs: [] } };
    const answer = demoAnswer([thread('c1'), thread('n1', { idea: true, text: 'Let shoppers save items for later' }), thread('n2', { idea: true, text: 'Prefill the address' })], [lead]);
    expect(proposalsFrom(answer, [thread('c1'), thread('n1', { idea: true }), thread('n2', { idea: true })]).map((p) => [p.contact, p.as, p.note])).toEqual([
      ['c1', 'next', 'you'],
      ['n1', 'next', '“Shoppers can save items for later”, under way'],
      ['n2', 'dropped', 'Its goal closed without it, and nothing since has picked it up'],
    ]);
  });
});
