// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent, Attention, PullRequest } from '../../plugin-api/client';
import type { CommsUi } from './comms';
import type { DecisionEvent, Inbox, InboxItem } from './inbox';
import { CHIEF_OF_STAFF, type CosRead, type Verdict } from './shared';

// Comms as the captain uses it: what waits comes from this browser's view of Focus (`waitingNow`) and the inbox Focus
// serves, both stood in for here; the card's answers are its own test's (needCard.test.ts).
const fake = vi.hoisted((): { waiting: Attention[]; inbox: Inbox; markRead: (agent: Agent) => void } => ({ waiting: [], inbox: { open: [], landed: [], decided: [] }, markRead: vi.fn() }));
vi.mock('../../plugin-api/client', async () => {
  const phone = await import('../../plugin-api/phone');
  return {
    ...phone,
    focus: { ...phone.focus, shown: [], isHidden: () => false, markRead: fake.markRead, onShip: () => () => undefined },
    confirmDialog: () => Promise.resolve(true),
    LCARS: { gold: 'gold', red: 'red', orange: 'orange', lilac: 'lilac' },
    markdownHtml: (text: string) => text,
    busy: async (_button: HTMLButtonElement, run: () => Promise<unknown>) => {
      await run();
    },
    fill: (el: HTMLElement, ...children: (Node | null)[]) => el.replaceChildren(...children.flatMap((c) => (c ? [c] : []))),
    timeAgo: () => '5 min ago',
    goalTags: () => [],
  };
});
vi.mock('./here', () => ({ waitingNow: () => fake.waiting }));
vi.mock('./inboxApi', () => ({ inbox: { view: () => Promise.resolve(fake.inbox), decide: vi.fn(), hold: vi.fn(), decideLanded: vi.fn(() => Promise.resolve({ ok: true })) } }));
const { inbox: inboxApi } = await import('./inboxApi');

const { openComms } = await import('./comms');

const verdict = (route: Verdict['route']): Verdict => ({ route, ask: route === 1 ? 'Carry on with slice 2' : 'Ship slice 2?', why: 'w', message: 'Go on.' });
const agent = (id: string, more: Partial<Agent> = {}, read?: CosRead): Agent => ({
  id, name: `Lt. ${id}`, projectId: 'p', repo: 'acme/shop', task: 'lead', issue: { number: 0, title: 'Wishlist', url: '' }, desk: 0,
  status: 'done', activity: '', branch: 'b', baseBranch: 'main', costUsd: 0, startedAt: 1, finishedAt: 1000,
  avatar: { division: 'command', rank: 'ensign', species: 'human', skin: '#fff', hair: '#000', hairstyle: 'crop', accessory: 'none' },
  lead: { station: 0, title: `Goal ${id}`, repos: [], slice: 1, prs: [], ...(read && { marks: { [CHIEF_OF_STAFF]: read } }) },
  ...more,
});
const pr: PullRequest = {
  repo: 'acme/shop', number: 7, title: 'Wishlist endpoints', url: 'https://github.com/acme/shop/pull/7', branch: 'wishlist', baseBranch: 'main',
  isDraft: false, mergeable: 'MERGEABLE', checks: 'passing', failedChecks: [], closes: [], createdAt: '2026-10-01',
};
const item = (id: string, over: Partial<InboxItem> = {}): InboxItem => ({ id, kind: 'turn', projectId: 'p', who: 'Lt. x', goal: 'Goal', what: id, lane: 'needs-you', ...over });
const decision = (via: DecisionEvent['via'], answer: string): DecisionEvent =>
  ({ kind: 'captain-decision', at: Date.now(), seq: 1, via, projectId: 'p', agent: 'Lt. a', goal: 'Goal a', answer, item: { id: 'x', kind: 'turn', what: 'w' } });

const hand: Attention = { kind: 'hand', agent: agent('a', { status: 'waiting', permission: { id: 'r1', tool: 'Bash', summary: 'Run the tests', at: 900 } }) };
const card: Attention = { kind: 'turn', agent: agent('b', {}, { at: 1000, judged: verdict(2) }) };
const ready: Attention = { kind: 'turn', agent: agent('c', {}, { at: 1000, judged: verdict(1), sendsAt: Date.now() + 5 * 60_000 }) };
const qa: Attention = { kind: 'qa', projectId: 'p', pr };

let cleanups: (() => void)[] = [];
const ui = {
  panels: {
    open: vi.fn((opts: { body: HTMLElement }) => document.body.replaceChildren(opts.body)),
    own: (cleanup: () => void) => cleanups.push(cleanup),
    backTo: vi.fn(),
  },
  openAgent: vi.fn(),
  openBoard: vi.fn(),
  openGoals: vi.fn(),
  openScreen: vi.fn(),
  error: vi.fn(),
} satisfies CommsUi;

/** A slice that merged itself in Show, as the inbox lists it. */
const landedItem = { id: 'landed:p:acme/shop#7', projectId: 'p', repo: 'acme/shop', number: 7, goal: 'Wishlist', leadId: 'b', who: 'Lt. b', at: 900, why: 'It only wires parts in.' };

const press = (key: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key }));
const picked = () => document.querySelector('.cos-inbox-row.sel .cos-need-what')?.textContent;
/** Opens Comms, and lets it ask Focus for the inbox. */
async function open(): Promise<void> {
  openComms(ui);
  await vi.advanceTimersByTimeAsync(300);
}

describe('Comms', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    for (const cleanup of cleanups) cleanup();
    cleanups = [];
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('lists what needs the captain, picks the first, and reads a lead’s turn as it shows it', async () => {
    fake.waiting = [hand, card, ready, qa];
    fake.inbox = {
      open: [item('hand:a:r1', { kind: 'hand' }), item('turn:b:1000', { cos: verdict(2) }), item('turn:c:1000', { lane: 'ready', cos: verdict(1) }), item('qa:p:acme/shop#7', { kind: 'qa' })],
      landed: [],
      decided: [decision('office', 'Approved'), decision('chief-of-staff', 'Sent the chief of staff’s words')],
    };
    await open();
    expect(document.querySelector('h3')?.textContent).toBe('Needs you · 3');
    expect([...document.querySelectorAll('.cos-inbox-tag')].map((t) => t.textContent)).toEqual(['Approve', 'Card', 'QA']);
    expect(picked()).toBe('hand:a:r1');
    expect(document.querySelector('.cos-tray-line')?.textContent).toBe('Chief of staff: 1 ready to send · sent 1 by itself today ›');
    expect(document.querySelector('.cos-decided-answer')?.textContent).toBe('You: “Approved”');

    press('j');
    expect(picked()).toBe('turn:b:1000');
    expect(fake.markRead).toHaveBeenCalledWith(card.agent);
    press('k');
    press('k');
    expect(picked()).toBe('qa:p:acme/shop#7');
  });

  it('opens its tray of ready words, each counting down to going by itself', async () => {
    fake.waiting = [ready];
    fake.inbox = { open: [item('turn:c:1000', { lane: 'ready', cos: verdict(1) })], landed: [], decided: [] };
    await open();
    expect(document.querySelector('.cos-card-clear')?.textContent).toContain('Nothing needs you.');
    document.querySelector<HTMLButtonElement>('.cos-tray-line')?.click();
    expect(document.querySelector('.cos-tray .cos-inbox-tag')?.textContent).toBe('Ready');
    expect(document.querySelector('.cos-tray .cos-need-sends')?.textContent).toBe('⏱ sends itself in 5 min');
  });

  it('goes by key to the one picked: an agent’s panel, or a pull request’s board, and back to Comms with Esc', async () => {
    fake.waiting = [hand, qa];
    fake.inbox = { open: [item('hand:a:r1', { kind: 'hand' }), item('qa:p:acme/shop#7', { kind: 'qa' })], landed: [], decided: [] };
    await open();
    press('g');
    expect(ui.openAgent).toHaveBeenCalledWith('a');
    expect(ui.panels.backTo).toHaveBeenLastCalledWith('Comms', expect.any(Function));
    press('j');
    press('g');
    expect(ui.openBoard).toHaveBeenCalledWith('p');
  });

  it('leaves out what this browser hasn’t heard of yet, and keys pressed while the captain writes', async () => {
    fake.waiting = [hand];
    fake.inbox = { open: [item('hand:a:r1', { kind: 'hand' }), item('turn:z:5', {})], landed: [], decided: [] };
    await open();
    expect([...document.querySelectorAll('.cos-inbox-tag')].map((t) => t.textContent)).toEqual(['Approve']);
    const reply = document.createElement('textarea');
    document.body.append(reply);
    reply.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true }));
    expect(ui.openAgent).not.toHaveBeenCalled();
  });

  // README.md#landed-in-show: what landed in Show is listed under what needs the captain, a card each, off the count
  it('lists what landed in Show under the queue, and shows its card with Got it, Redirect and Revert', async () => {
    fake.waiting = [hand];
    fake.inbox = { open: [item('hand:a:r1', { kind: 'hand' })], landed: [landedItem], decided: [] };
    await open();
    expect([...document.querySelectorAll<HTMLElement>('h3')].filter((h) => !h.hidden).map((h) => h.textContent)).toEqual(['Needs you · 1', 'Landed in Show · 1']);
    document.querySelector<HTMLButtonElement>('.cos-landed .cos-inbox-row')?.click();
    expect(document.querySelector('.cos-card-what')?.textContent).toBe('✓shop#7 merged itself in Show');
    expect(document.querySelector('.cos-card-context')?.textContent).toBe('Chief of Staff: It only wires parts in.');
    expect([...document.querySelectorAll('.cos-quick button')].map((b) => b.textContent)).toEqual(['Got it', 'Redirect', 'Revert']);
    // O says Got it, as on a lead's turn
    press('o');
    await vi.advanceTimersByTimeAsync(0);
    expect(inboxApi.decideLanded).toHaveBeenCalledWith(landedItem.id, { ack: true });
  });

  it('sends a Redirect only with the captain’s words, and a Revert with them as its reason', async () => {
    fake.waiting = [];
    fake.inbox = { open: [], landed: [landedItem], decided: [] };
    await open();
    document.querySelector<HTMLButtonElement>('.cos-landed .cos-inbox-row')?.click();
    const [, redirect, revert] = document.querySelectorAll<HTMLButtonElement>('.cos-quick button');
    redirect.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(inboxApi.decideLanded).not.toHaveBeenCalled();
    const words = document.querySelector('textarea');
    if (words) words.value = 'It broke search';
    revert.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(inboxApi.decideLanded).toHaveBeenCalledWith(landedItem.id, { revert: 'It broke search' });
  });
});
