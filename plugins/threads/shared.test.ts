import { describe, expect, it } from 'vitest';
import type { Agent, Contact, GoalRecord, LedgerEvent } from '../../plugin-api/shared';
import { acceptances, closedThreads, decision, ideaKey, lastSorts, register, spinOffText, spunOffEntry, type Thread, toSpinOff, withClosed } from './shared';

const contact = (id: string, at: number, closed?: Contact['closed']): Contact => ({ id, text: `thread ${id}`, slice: 1, at, ...(closed && { closed }) });
const goal = (id: string, contacts: Contact[], closedAt = 100): GoalRecord => ({ id, title: `Goal ${id}`, slices: 1, prs: [], leadName: 'Lt. Reyes', openedAt: 0, closedAt, contacts });
const closedLine = (projectId: string, g: GoalRecord, seq: number): LedgerEvent => ({ seq, at: g.closedAt, projectId, kind: 'goal-closed', goal: g });
const otherLine: LedgerEvent = { seq: 2, at: 3, projectId: 'shop', kind: 'retro-decision', title: 'Fix the demo port', signatures: [], accepted: true };
const decided = (seq: number, goalId: string, contact: string, as: 'next' | 'parked' | 'dropped' | 'resolved' | 'open', note?: string): LedgerEvent =>
  ({ seq, at: 300 + seq, projectId: 'shop', kind: 'thread-decided', goalId, goal: `Goal ${goalId}`, contact, text: `thread ${contact}`, as, ...(note && { note }) });
const lead = (id: string, contacts: Contact[]): Pick<Agent, 'id' | 'name' | 'lead'> =>
  ({ id, name: 'Lt. Oyelaran', lead: { station: 0, title: `Goal ${id}`, repos: [], slice: 1, prs: [], contacts } });

describe('the threads closed goals left open', () => {
  it('keeps each project’s open contacts as their goal closed, and none it pursued, dropped or spun off', () => {
    const shop = goal('g1', [
      contact('c1', 10),
      contact('c2', 20, { as: 'pursued', slice: 1, at: 30 }),
      contact('c3', 25, { as: 'dropped', why: 'covered', slice: 1, at: 30 }),
      contact('c4', 26, { as: 'spun off', title: 'Saved items', slice: 1, at: 30 }),
    ]);
    const blog = goal('g2', [contact('c1', 5)]);
    const closed = closedThreads([closedLine('shop', shop, 1), otherLine, closedLine('blog', blog, 3)]);
    expect(closed.shop?.map((t) => [t.goal, t.contact, t.closedAt])).toEqual([['g1', 'c1', 100]]);
    expect(closed.blog?.map((t) => t.text)).toEqual(['thread c1']);
  });

  it('takes a goal reopened and closed again as its last close left it', () => {
    const first = goal('g1', [contact('c1', 10), contact('c2', 20)], 100);
    const again = goal('g1', [contact('c1', 10, { as: 'pursued', slice: 2, at: 150 }), contact('c2', 20), contact('c3', 160)], 200);
    const closed = closedThreads([closedLine('shop', first, 1), closedLine('shop', again, 2)]);
    expect(closed.shop?.map((t) => [t.contact, t.closedAt])).toEqual([['c2', 200], ['c3', 200]]);
  });

  it('leaves the other projects’ threads as they were as a goal closes', () => {
    const before = closedThreads([closedLine('blog', goal('g2', [contact('c1', 5)]), 1)]);
    const after = withClosed(before, 'shop', goal('g1', [contact('c1', 10)]));
    expect(after.blog).toBe(before.blog);
    expect(after.shop).toHaveLength(1);
  });
});

describe('a project’s register', () => {
  it('lists its closed goals’ threads and its goals under way’s open contacts, oldest first', () => {
    const closed = closedThreads([closedLine('shop', goal('g1', [contact('c1', 30)]), 1)]).shop;
    const threads = register(closed, [lead('g9', [contact('c1', 10), contact('c2', 40, { as: 'dropped', slice: 1, at: 50 })])]);
    expect(threads.map((t) => [t.goal, t.contact, t.live])).toEqual([['g9', 'c1', true], ['g1', 'c1', undefined]]);
  });

  it('takes a reopened goal’s threads from its lead as they stand now, not as it closed', () => {
    const closed = closedThreads([closedLine('shop', goal('g1', [contact('c1', 10), contact('c2', 20)]), 1)]).shop;
    const reopened = lead('g1', [contact('c1', 10, { as: 'pursued', slice: 2, at: 120 }), contact('c2', 20)]);
    expect(register(closed, [reopened]).map((t) => [t.contact, t.live])).toEqual([['c2', true]]);
  });

  it('is empty for a project with no goals closed and none under way', () => {
    expect(register(undefined, [])).toEqual([]);
    expect(register([], [{ id: 'dev', name: 'Ens. Park' }])).toEqual([]);
  });
});

describe('the captain deciding where a thread ends', () => {
  const closed = (more: LedgerEvent[] = []) => closedThreads([closedLine('shop', goal('g1', [contact('c1', 10), contact('c2', 20)]), 1), ...more]).shop ?? [];
  const ends = (threads: Thread[]) => threads.map((t) => [t.contact, t.decided?.as, t.decided?.note]);

  it('sets a thread’s end from the ledger, the latest decision winning, and takes it back with open', () => {
    expect(ends(closed([decided(2, 'g1', 'c1', 'parked', 'until the first login'), decided(3, 'g1', 'c2', 'dropped', 'covered by #1236'), decided(4, 'g1', 'c1', 'next')])))
      .toEqual([['c1', 'next', undefined], ['c2', 'dropped', 'covered by #1236']]);
    expect(ends(closed([decided(2, 'g1', 'c1', 'resolved', '#1262'), decided(3, 'g1', 'c1', 'open')]))).toEqual([['c1', undefined, undefined], ['c2', undefined, undefined]]);
  });

  it('leaves alone a decision on a thread that isn’t there', () => {
    expect(ends(closed([decided(2, 'g9', 'c1', 'dropped', 'gone')]))).toEqual([['c1', undefined, undefined], ['c2', undefined, undefined]]);
  });

  it('keeps what was decided of a thread its goal left open again, reopened and closed, and loses the ones its lead closed', () => {
    const again = goal('g1', [contact('c1', 10, { as: 'pursued', slice: 2, at: 150 }), contact('c2', 20)], 200);
    const threads = closed([decided(2, 'g1', 'c1', 'parked', 'later'), decided(3, 'g1', 'c2', 'parked', 'until Jonathan’s call'), closedLine('shop', again, 4)]);
    expect(ends(threads)).toEqual([['c2', 'parked', 'until Jonathan’s call']]);
  });

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
  const closed = (more: LedgerEvent[] = []) => closedThreads([closedLine('shop', goal('g1', [contact('c1', 10), contact('c2', 20)]), 1), ...more]).shop ?? [];
  const spunOff = (seq: number, contact: string, to: { goal?: string; title: string }): LedgerEvent =>
    ({ seq, at: 300 + seq, projectId: 'shop', kind: 'thread-decided', goalId: 'g1', goal: 'Goal g1', contact, text: `thread ${contact}`, as: 'next', spunOff: to });

  it('starts the goal with the thread and where it came from, until it’s edited', () => {
    const [t] = closed();
    expect(t && spinOffText(t)).toBe('thread c1\n\n(Spun off from “Goal g1”, a closed goal: its contact c1, noticed in slice 1.)');
  });

  it('takes the thread on as the goal it started, at a station or in line for one', () => {
    const [t] = closed();
    const at = { agent: { id: 'shop-lead-a1', lead: { station: 1, title: 'Saved items', repos: [], slice: 1, prs: [] } } };
    expect(t && spunOffEntry(t, 'Saved items\n\nmore', at)).toEqual({
      kind: 'thread-decided', goalId: 'g1', goal: 'Goal g1', contact: 'c1', text: 'thread c1', as: 'next', spunOff: { goal: 'shop-lead-a1', title: 'Saved items' },
    });
    expect(t && spunOffEntry(t, 'Saved items, the rest of them\n\nmore', { queued: { id: 'q1', text: 'Saved items, the rest of them', at: 5 } }))
      .toMatchObject({ as: 'next', spunOff: { title: 'Saved items, the rest of them' } });
  });

  it('keeps the goal it was spun off as, until the decision’s taken back', () => {
    expect(closed([spunOff(2, 'c1', { goal: 'a1', title: 'Saved items' })])[0]?.decided).toEqual({ as: 'next', spunOff: { goal: 'a1', title: 'Saved items' }, at: 302 });
    expect(closed([spunOff(2, 'c1', { goal: 'a1', title: 'Saved items' }), decided(3, 'g1', 'c1', 'open')])[0]?.decided).toBeUndefined();
  });

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

describe('the ideas for next a closed goal left', () => {
  const withIdeas = (next: string[], closedAt = 100): GoalRecord => ({ ...goal('g1', [contact('c1', 10)], closedAt), slice: 2, note: { done: '', learned: [], next } });

  it('keeps each as a thread of its goal after its contacts, once, keyed by its words, as of the goal closing', () => {
    const threads = closedThreads([closedLine('shop', withIdeas(['Remember more addresses', ' remember   more addresses', 'Remember more addresses ', '', 'Prefill from the card']), 1)]).shop ?? [];
    expect(threads.map((t) => [t.contact, t.text, t.idea, t.at, t.slice])).toEqual([
      ['c1', 'thread c1', undefined, 10, 1],
      [ideaKey('Remember more addresses'), 'Remember more addresses', true, 100, 2],
      [ideaKey('remember more addresses'), 'remember more addresses', true, 100, 2],
      [ideaKey('Prefill from the card'), 'Prefill from the card', true, 100, 2],
    ]);
    expect(ideaKey('Prefill  from the card ')).toBe(ideaKey('Prefill from the card'));
    expect(ideaKey('Prefill from the card')).toMatch(/^next-[0-9a-z]+$/);
  });

  it('keeps what was decided of an idea its goal closed with again, reopened, however its list was ordered', () => {
    const key = ideaKey('Prefill from the card');
    const decidedIdea: LedgerEvent = { seq: 2, at: 302, projectId: 'shop', kind: 'thread-decided', goalId: 'g1', goal: 'Goal g1', contact: key, text: 'Prefill from the card', as: 'dropped', note: 'no card data' };
    const threads = closedThreads([closedLine('shop', withIdeas(['A', 'Prefill from the card']), 1), decidedIdea, closedLine('shop', withIdeas(['Prefill from the card', 'B'], 200), 3)]).shop ?? [];
    expect(threads.filter((t) => t.idea).map((t) => [t.text, t.decided?.as])).toEqual([['Prefill from the card', 'dropped'], ['B', undefined]]);
  });

  it('starts a goal spun off from an idea saying it was one', () => {
    const [, idea] = closedThreads([closedLine('shop', withIdeas(['Prefill from the card']), 1)]).shop ?? [];
    expect(idea && spinOffText(idea)).toBe('Prefill from the card\n\n(Spun off from “Goal g1”, a closed goal: one of the ideas for next it closed with.)');
  });
});

describe('what a model proposed of a project’s threads', () => {
  type Proposal = { contact: string; as: 'next' | 'parked' | 'dropped' | 'resolved'; note: string };
  const proposed = (seq: number, proposals: Proposal[], failed?: string): LedgerEvent =>
    ({ seq, at: 400 + seq, projectId: 'shop', kind: 'thread-proposals', asked: 2, proposals: proposals.map((p) => ({ goalId: 'g1', ...p })), model: 'sonnet', costUsd: 0.04, ...(failed && { failed }) });
  const closed = (more: LedgerEvent[] = []) => closedThreads([closedLine('shop', goal('g1', [contact('c1', 10), contact('c2', 20)]), 1), ...more]).shop ?? [];
  const shown = (threads: Thread[]) => threads.map((t) => [t.contact, t.proposed?.as, t.proposed?.note, t.decided?.as]);

  it('puts each proposal on its thread still to decide, the latest winning, and none on one decided', () => {
    expect(shown(closed([decided(2, 'g1', 'c2', 'parked', 'later'), proposed(3, [{ contact: 'c1', as: 'dropped', note: 'stale' }, { contact: 'c2', as: 'next', note: 'you' }]), proposed(4, [{ contact: 'c1', as: 'resolved', note: 'by #12' }])])))
      .toEqual([['c1', 'resolved', 'by #12', undefined], ['c2', undefined, undefined, 'parked']]);
  });

  it('takes a proposal off once its thread’s decided, and doesn’t bring it back when the decision is', () => {
    const threads = closed([proposed(2, [{ contact: 'c1', as: 'dropped', note: 'stale' }]), decided(3, 'g1', 'c1', 'next'), decided(4, 'g1', 'c1', 'open')]);
    expect(shown(threads)[0]).toEqual(['c1', undefined, undefined, undefined]);
  });

  it('keeps a proposal through its goal closing again, and nothing of a sort that failed', () => {
    expect(shown(closed([proposed(2, [{ contact: 'c2', as: 'dropped', note: 'stale' }]), closedLine('shop', goal('g1', [contact('c2', 20)], 200), 3)])))
      .toEqual([['c2', 'dropped', 'stale', undefined]]);
    expect(shown(closed([proposed(2, [], 'timed out')]))).toEqual([['c1', undefined, undefined, undefined], ['c2', undefined, undefined, undefined]]);
  });

  it('keeps each project’s last sort: when, how many it proposed ends for of how many asked, and its cost or why it failed', () => {
    expect(lastSorts([proposed(2, [{ contact: 'c1', as: 'dropped', note: 'stale' }]), otherLine, proposed(3, [], 'timed out')])).toEqual({
      shop: { at: 403, asked: 2, proposed: 0, model: 'sonnet', costUsd: 0.04, failed: 'timed out' },
    });
  });

  it('accepts one thread’s proposal, or every one of an end, each a decision as proposed, saying so', () => {
    const threads = closed([proposed(2, [{ contact: 'c1', as: 'dropped', note: 'stale' }, { contact: 'c2', as: 'dropped', note: 'covered by #12' }])]);
    expect(acceptances(threads, new Set(), { goal: 'g1', contact: 'c2' })).toEqual({
      entries: [{ kind: 'thread-decided', goalId: 'g1', goal: 'Goal g1', contact: 'c2', text: 'thread c2', as: 'dropped', note: 'covered by #12', proposed: true }],
    });
    const all = acceptances(threads, new Set(), { as: 'dropped' });
    expect('entries' in all && all.entries.map((e) => e.kind === 'thread-decided' && e.contact)).toEqual(['c1', 'c2']);
    const line: LedgerEvent = { seq: 4, at: 404, projectId: 'shop', kind: 'thread-decided', goalId: 'g1', goal: 'Goal g1', contact: 'c1', text: 'thread c1', as: 'dropped', note: 'stale', proposed: true };
    expect(closed([proposed(2, [{ contact: 'c1', as: 'dropped', note: 'stale' }]), line])[0]?.decided).toEqual({ as: 'dropped', note: 'stale', proposed: true, at: 404 });
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
