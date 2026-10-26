import { describe, expect, it } from 'vitest';
import type { Contact, GoalRecord, LedgerEvent } from '../../plugin-api/shared';
import { closedThreads, type Thread } from './shared';
import { acceptances, decision, SORT_LIMIT, toSort, toSpinOff } from './threadsRules';

const contact = (id: string, at: number): Contact => ({ id, text: `thread ${id}`, slice: 1, at });
const goal = (id: string, contacts: Contact[], closedAt = 100): GoalRecord => ({ id, title: `Goal ${id}`, slices: 1, prs: [], leadName: 'Lt. Reyes', openedAt: 0, closedAt, contacts });
const closedLine = (projectId: string, g: GoalRecord, seq: number): LedgerEvent => ({ seq, at: g.closedAt, projectId, kind: 'goal-closed', goal: g });
const decided = (seq: number, goalId: string, contact: string, as: 'next' | 'parked' | 'dropped' | 'resolved' | 'open', note?: string): LedgerEvent =>
  ({ seq, at: 300 + seq, projectId: 'shop', kind: 'thread-decided', goalId, goal: `Goal ${goalId}`, contact, text: `thread ${contact}`, as, ...(note && { note }) });
const closed = (more: LedgerEvent[] = []) => closedThreads([closedLine('shop', goal('g1', [contact('c1', 10), contact('c2', 20)]), 1), ...more]).shop ?? [];

describe('the captain deciding where a thread ends', () => {
  it('writes the decision as a line that says on its own which thread, how and why', () => {
    expect(decision(closed(), new Set(), { goal: 'g1', contact: 'c2', as: 'dropped', note: '  covered   by #1236 ' })).toEqual({
      entry: { kind: 'thread-decided', goalId: 'g1', goal: 'Goal g1', contact: 'c2', text: 'thread c2', as: 'dropped', note: 'covered by #1236' },
    });
    expect(decision(closed(), new Set(), { goal: 'g1', contact: 'c1', as: 'next' })).toEqual({ entry: { kind: 'thread-decided', goalId: 'g1', goal: 'Goal g1', contact: 'c1', text: 'thread c1', as: 'next' } });
  });

  it('refuses what can’t be decided, saying why', () => {
    const threads = closed([decided(2, 'g1', 'c1', 'parked', 'later')]);
    const refused = (input: Record<string, unknown>, underWay = new Set<string>()) => {
      const made = decision(threads, underWay, input);
      return 'error' in made ? made.error : 'written';
    };
    expect(refused({ goal: 'g1', contact: 'c2', as: 'shelved' })).toMatch(/ends as next, parked, dropped, resolved/);
    expect(refused({ goal: 'g1', contact: 'c9', as: 'next' })).toMatch(/no such thread/);
    expect(refused({ goal: 'g1', contact: 'c2', as: 'next' }, new Set(['g1']))).toMatch(/under way again/);
    expect(refused({ goal: 'g1', contact: 'c2', as: 'parked' })).toMatch(/until when/);
    expect(refused({ goal: 'g1', contact: 'c2', as: 'dropped', note: ' ' })).toMatch(/why/);
    expect(refused({ goal: 'g1', contact: 'c2', as: 'next', note: 'x'.repeat(161) })).toMatch(/161 characters/);
    expect(refused({ goal: 'g1', contact: 'c2', as: 'open' })).toMatch(/isn’t decided yet/);
    expect(refused({ goal: 'g1', contact: 'c1', as: 'parked', note: 'later' })).toMatch(/already parked/);
    expect(refused({ goal: 'g1', contact: 'c1', as: 'parked', note: 'until Friday' })).toBe('written');
    expect(refused({ goal: 'g1', contact: 'c1', as: 'open' })).toBe('written');
  });
});

describe('the captain spinning a thread off as a goal of its own', () => {
  const spunOff = (seq: number, contact: string, to: { goal?: string; title: string }): LedgerEvent =>
    ({ seq, at: 300 + seq, projectId: 'shop', kind: 'thread-decided', goalId: 'g1', goal: 'Goal g1', contact, text: `thread ${contact}`, as: 'next', spunOff: to });

  it('refuses a thread that can’t be spun off, saying why, before any goal starts', () => {
    const threads = closed([spunOff(2, 'c1', { title: 'Saved items' })]);
    const refused = (input: Record<string, unknown>, underWay = new Set<string>()) => {
      const spin = toSpinOff(threads, underWay, input);
      return 'error' in spin ? spin.error : spin.text;
    };
    expect(refused({ goal: 'g1', contact: 'c9', text: 'Go' })).toMatch(/no such thread/);
    expect(refused({ goal: 'g1', contact: 'c2', text: 'Go' }, new Set(['g1']))).toMatch(/under way again/);
    expect(refused({ goal: 'g1', contact: 'c1', text: 'Go' })).toMatch(/a goal of its own already: “Saved items”/);
    expect(refused({ goal: 'g1', contact: 'c2', text: '  ' })).toMatch(/Say what the goal is/);
    expect(refused({ goal: 'g1', contact: 'c2', text: ' Saved items \n' })).toBe('Saved items');
  });
});

describe('accepting what a model proposed of a project’s threads', () => {
  type Proposal = { contact: string; as: 'next' | 'parked' | 'dropped' | 'resolved'; note: string };
  const proposed = (seq: number, proposals: Proposal[]): LedgerEvent =>
    ({ seq, at: 400 + seq, projectId: 'shop', kind: 'thread-proposals', asked: 2, proposals: proposals.map((p) => ({ goalId: 'g1', ...p })), model: 'sonnet', costUsd: 0.04 });

  it('accepts one thread’s proposal, or every one of an end, each a decision as proposed, saying so', () => {
    const threads = closed([proposed(2, [{ contact: 'c1', as: 'dropped', note: 'stale' }, { contact: 'c2', as: 'dropped', note: 'covered by #12' }])]);
    expect(acceptances(threads, new Set(), { goal: 'g1', contact: 'c2' })).toEqual({
      entries: [{ kind: 'thread-decided', goalId: 'g1', goal: 'Goal g1', contact: 'c2', text: 'thread c2', as: 'dropped', note: 'covered by #12', proposed: true }],
    });
    const all = acceptances(threads, new Set(), { as: 'dropped' });
    expect('entries' in all && all.entries.map((e) => e.kind === 'thread-decided' && e.contact)).toEqual(['c1', 'c2']);
  });

  it('refuses what can’t be accepted, saying why', () => {
    const threads = closed([proposed(2, [{ contact: 'c1', as: 'dropped', note: 'stale' }]), decided(3, 'g1', 'c2', 'parked', 'later')]);
    const refused = (input: Record<string, unknown>, underWay = new Set<string>()) => {
      const made = acceptances(threads, underWay, input);
      return 'error' in made ? made.error : `${made.entries.length} written`;
    };
    expect(refused({ goal: 'g1', contact: 'c2' })).toMatch(/no proposal for that thread/);
    expect(refused({ goal: 'g1', contact: 'c1' }, new Set(['g1']))).toMatch(/no proposal for that thread/);
    expect(refused({ as: 'shelved' })).toMatch(/Say which proposals to accept/);
    expect(refused({ as: 'next' })).toMatch(/No thread to decide has next proposed/);
    expect(refused({ as: 'dropped' })).toBe('1 written');
  });
});

const day = (d: number) => Date.UTC(2026, 9, d);
const sortThread = (contact: string, more: Partial<Thread> = {}): Thread =>
  ({ goal: 'g1', goalTitle: 'Checkout', leadName: 'Lt. Reyes', contact, text: `thread ${contact}`, at: day(10), slice: 1, closedAt: day(12), ...more });

describe('which threads a sort asks about', () => {
  it('asks about a closed goal’s threads still to decide, the ones never proposed first, then the oldest', () => {
    const threads = [
      sortThread('c1', { at: day(5), proposed: { as: 'dropped', note: 'stale', at: day(13) } }),
      sortThread('c2', { at: day(9) }),
      sortThread('c3', { at: day(7) }),
      sortThread('c4', { decided: { as: 'parked', note: 'later', at: day(13) } }),
      sortThread('c5', { goal: 'g9' }),
    ];
    expect(toSort(threads, new Set(['g9'])).map((t) => t.contact)).toEqual(['c3', 'c2', 'c1']);
  });

  it('asks about every thread to decide in one call, up to a limit', () => {
    const many = Array.from({ length: SORT_LIMIT + 5 }, (_, i) => sortThread(`c${i}`, { at: i }));
    expect(toSort(many, new Set())).toHaveLength(SORT_LIMIT);
    expect(toSort(undefined, new Set())).toEqual([]);
  });
});
