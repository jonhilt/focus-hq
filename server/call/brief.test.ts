import { describe, expect, it } from 'vitest';
import type { LedgerEvent, SessionFacts } from '../../shared/ledger';
import type { Agent, GoalRecord, Project, Snapshot } from '../../shared/types';
import { briefing, PIECE_CHARS, pieces, type Topic, topics } from './brief';

const NOW = Date.UTC(2026, 9, 12);
const facts: SessionFacts = { minutes: 30, turns: 10, toolCalls: 20, failedCalls: 2, refusedCalls: 0, repeatedCalls: 0, wastedCalls: 2, captainMessages: 1, nudges: 0, officeMessages: 0, compactions: 0, qaFails: 1, conflicts: 0 };

const closed = { id: 'g1', title: 'Calls', leadName: 'Lt. Old', slices: 2, prs: [{ repo: 'acme/shop', number: 3, url: '', outcome: 'merged' }], brief: 'Talk to the ship', note: { done: 'It talks', slice: [], learned: ['Delegation has no text'], next: [] }, openedAt: 0, closedAt: NOW - 1 } as GoalRecord;
const shop = { id: 'p1', name: 'Shop', repos: ['acme/shop'], goals: [closed], goalQueue: [{ id: 'q1', text: 'Gift wrap\nwith ribbons', at: 0 }] } as unknown as Project;
const secret = { id: 'p9', name: 'Secret', repos: [], hidden: true } as unknown as Project;
const lead = {
  id: 'lead_1',
  name: 'Lt. Data',
  projectId: 'p1',
  task: 'lead',
  status: 'working',
  lead: {
    station: 1,
    title: 'Wishlist',
    slice: 2,
    brief: 'Shoppers save items for later',
    prs: [{ repo: 'acme/shop', number: 7, url: '' }],
    note: { done: 'Saved items survive a reload', slice: [{ text: 'Save button', done: true }, { text: 'List page', done: false }], learned: ['Local storage is enough'], next: ['Share a list'] },
    contacts: [{ id: 'c1', text: 'Guest carts?', slice: 1, at: 0 }, { id: 'c2', text: 'Done thing', slice: 1, at: 0, closed: { as: 'dropped', slice: 1, at: 0 } }],
    waypoints: [{ slice: 1, startedAt: 0, landedAt: 1, title: 'Save button', summary: 'Adds the button', learned: ['Buttons are easy'] }],
  },
} as unknown as Agent;

const snapshot = {
  projects: [shop, secret],
  agents: [lead],
  boards: [{ projectId: 'p1', issues: [{ number: 12, title: 'Checkout is slow' }], prs: [{ repo: 'acme/shop', number: 7, title: 'Wishlist page', headSha: 'abc' }] }],
  reviews: [{ repo: 'acme/shop', number: 7, status: 'passed', sha: 'abc' }],
} as unknown as Snapshot;

const ev = (e: object, at = NOW - 1_000): LedgerEvent => ({ projectId: 'p1', seq: 1, at, ...e }) as LedgerEvent;
const ledger: LedgerEvent[] = [
  ev({ kind: 'qa-verdict', repo: 'acme/shop', pr: 7, goal: 'Wishlist', verdict: 'fail', reviewer: 'QA', checks: { pass: 1, fail: 1, skip: 0 }, failedRounds: 1 }),
  ev({ kind: 'session-digest', key: 'k1', sessionId: 's1', agentId: 'lead_1', agent: 'Lt. Data', task: 'lead', prs: [{ repo: 'acme/shop', pr: 7 }], goal: 'Wishlist', toUuid: 'u', facts }),
  ev({ kind: 'session-frictions', key: 'k1', sessionId: 's1', reader: 'opus', frictions: [{ kind: 'environment', signature: 'flaky e2e', quote: 'the test timed out again' }] }),
  ev({ kind: 'merged', repo: 'acme/shop', pr: 3, by: 'captain', qa: 'passed', failedRounds: 0, triages: 0 }),
];

const topic = (id: string): Topic => topics(snapshot).find((t) => t.id === id)!;

describe('topics', () => {
  it('offers the goals under way, then closed goals, then each project, leaving hidden projects out', () => {
    expect(topics(snapshot).map((t) => [t.id, t.label])).toEqual([
      ['goal:lead_1', 'The goal "Wishlist" in Shop, led by Lt. Data'],
      ['closed:g1', 'The closed goal "Calls" in Shop'],
      ['project:p1', "Shop as a whole: how it's going, its issues, what keeps getting in the way"],
    ]);
  });
});

describe('briefing', () => {
  it("gives a goal under way: its brief, the lead's note and open threads, its slices, PRs and what the log saw", () => {
    const text = briefing(snapshot, ledger, topic('goal:lead_1'), NOW);
    for (const part of [
      'Topic: the goal "Wishlist" in Shop. Lt. Data leads it, at station 2, on slice 2.',
      'The goal as the captain first put it: Shoppers save items for later',
      'What done looks like: Saved items survive a reload',
      '- [done] Save button\n- [to do] List page',
      'What the slices taught:\n- Local storage is enough',
      'Loose threads still open:\n- Guest carts?',
      'Slice 1: Save button (landed). Adds the button. learned: Buttons are easy',
      'acme/shop pull request 7, "Wishlist page": QA passed',
      'From the ship’s log: 1 pull requests, 1 QA verdicts (1 failed), 0 merge conflicts, 1 sessions over 30 minutes.',
      'flaky e2e: “the test timed out again”',
    ])
      expect(text).toContain(part);
    expect(text).not.toContain('Done thing');
  });

  it('gives a closed goal from what its room kept', () => {
    const text = briefing(snapshot, ledger, topic('closed:g1'), NOW);
    expect(text).toContain('Topic: the closed goal "Calls" in Shop, led by Lt. Old, over 2 slices');
    expect(text).toContain('- Delegation has no text');
    expect(text).toContain('acme/shop 3: merged');
    expect(text).toContain('The ship’s log has nothing on it yet.');
  });

  it('gives a project: its goals, queue, issues, the last fortnight in the log, and what keeps getting in the way', () => {
    const text = briefing(snapshot, ledger, topic('project:p1'), NOW);
    for (const part of [
      'Goals under way:\n- "Wishlist", led by Lt. Data: done looks like Saved items survive a reload',
      'Goals queued:\n- Gift wrap',
      '"Calls"; learned: Delegation has no text',
      'Open issues:\n- 12: Checkout is slow',
      'In the last 14 days the log has 1 QA verdicts (1 failed), 0 merge conflicts and 1 merges.',
      'flaky e2e, in 1 sessions: “the test timed out again”',
    ])
      expect(text).toContain(part);
  });

  it('is empty once the topic has gone', () => {
    expect(briefing({ ...snapshot, agents: [] }, ledger, topic('goal:lead_1'), NOW)).toBe('');
    expect(briefing({ ...snapshot, projects: [] }, ledger, topic('project:p1'), NOW)).toBe('');
  });
});

describe('pieces', () => {
  it('splits between lines, each piece small enough, and caps how many', () => {
    expect(pieces('one\ntwo\nthree', 8)).toEqual(['one\ntwo', 'three']);
    const long = Array.from({ length: 400 }, (_, i) => `line ${i} ${'x'.repeat(60)}`).join('\n');
    const out = pieces(long);
    expect(out).toHaveLength(10);
    expect(out.every((p) => p.length <= PIECE_CHARS)).toBe(true);
  });

  it('cuts a line longer than a piece', () => {
    expect(pieces('x'.repeat(25), 10)).toEqual(['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(5)]);
  });
});
