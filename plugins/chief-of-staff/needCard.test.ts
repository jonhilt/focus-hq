// @vitest-environment happy-dom
// @vitest-environment-options {"happyDOM":{"settings":{"disableIframePageLoading":true}}}
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Agent, Attention, PullRequest } from '../../plugin-api/client';
import type { CosRead, Verdict } from './shared';
import { CHIEF_OF_STAFF } from './shared';

// The card answers as the agent's panel does, and sends or holds the chief of staff's words through the inbox: those
// calls are what's watched here. The 3D ship's plugin API brings every plugin's client part with it, so the card gets
// the phone's (the same view of Focus, and the same `h`) and the few parts of the kit it uses besides.
const calls = vi.hoisted(() => ({
  allowTool: vi.fn(() => Promise.resolve()),
  answerLead: vi.fn(() => Promise.resolve()),
  messageAgent: vi.fn(() => Promise.resolve(true)),
  closeGoal: vi.fn(() => Promise.resolve(true)),
  decide: vi.fn(() => Promise.resolve({ ok: true })),
  hold: vi.fn(() => Promise.resolve()),
  mergePr: vi.fn(() => Promise.resolve()),
  mergeWhenPassed: vi.fn(() => Promise.resolve()),
  confirmDialog: vi.fn(() => Promise.resolve(true)),
  shownPrs: vi.fn((): { projectId: string; pr: PullRequest }[] => []),
}));
vi.mock('../../plugin-api/client', async () => {
  const phone = await import('../../plugin-api/phone');
  // the board's pull requests are the ones a test puts there
  const focus = Object.create(phone.focus, { shownPrs: { value: calls.shownPrs } });
  return {
    ...phone,
    ...calls,
    focus,
    LCARS: { gold: 'gold', red: 'red', orange: 'orange', lilac: 'lilac' },
    markdownHtml: (text: string) => text,
    busy: async (_button: HTMLButtonElement, run: () => Promise<unknown>) => {
      await run();
    },
    timeAgo: () => '5 min ago',
    goalTags: () => [],
  };
});
vi.mock('./inboxApi', () => ({ inbox: { decide: calls.decide, hold: calls.hold } }));

const { needCard } = await import('./needCard');
const { fitScale, zoomStep } = await import('./zoom');

const verdict = (route: Verdict['route']): Verdict => ({ route, ask: 'Ship slice 2?', why: 'It changes the checkout.', message: 'Go ahead with the tests first.' });
const lead = (more: Partial<Agent> = {}, read?: CosRead): Agent => ({
  id: 'a1', name: 'Lt. Vale', projectId: 'p', repo: 'acme/shop', task: 'lead', issue: { number: 0, title: 'Wishlist', url: '' }, desk: 0,
  status: 'done', activity: '', branch: 'b', baseBranch: 'main', costUsd: 0, startedAt: 1, finishedAt: 1000,
  avatar: { division: 'command', rank: 'ensign', species: 'human', skin: '#fff', hair: '#000', hairstyle: 'crop', accessory: 'none' },
  lead: { station: 2, title: 'Wishlist', repos: [], slice: 1, prs: [], ...(read && { marks: { [CHIEF_OF_STAFF]: read } }) },
  ...more,
});
const pr: PullRequest = {
  repo: 'acme/shop', number: 7, title: 'Wishlist endpoints', url: 'https://github.com/acme/shop/pull/7', branch: 'wishlist', baseBranch: 'main',
  isDraft: false, mergeable: 'MERGEABLE', checks: 'passing', failedChecks: [], closes: [], createdAt: '2026-10-01',
};

const ui = { openScreen: vi.fn(), openBoard: vi.fn(), goToAgent: vi.fn(), error: vi.fn() };
const open = vi.fn();
const card = (a: Attention) => needCard(ui, a, open);
const button = (el: HTMLElement, text: string): HTMLButtonElement => {
  const found = [...el.querySelectorAll('button')].find((b) => b.textContent === text);
  if (!found) throw new Error(`No ${text} button in ${el.textContent}`);
  return found;
};
const settle = () => new Promise((resolve) => setTimeout(resolve));

describe('a card in Comms', () => {
  afterEach(() => vi.clearAllMocks());

  it('approves or declines a raised hand, as the agent’s panel does', async () => {
    const el = card({ kind: 'hand', agent: lead({ status: 'waiting', permission: { id: 'r1', tool: 'Bash', summary: 'Run the tests', at: 900 } }) });
    expect(el.textContent).toContain('Approve: Run the tests');
    expect(el.textContent).toContain('Tool: Bash');
    expect(el.textContent).toContain('Lt. Vale, Station 3');
    button(el, 'Approve').click();
    button(el, 'Decline').click();
    await settle();
    expect(calls.allowTool.mock.calls).toEqual([['a1', 'r1', true], ['a1', 'r1', false]]);
    button(el, 'Open their panel').click();
    expect(open).toHaveBeenCalledWith('a1');
  });

  it('sends an agent who’s stuck to their panel', () => {
    const el = card({ kind: 'error', agent: lead({ status: 'error', error: 'npm install failed' }) });
    expect(el.textContent).toContain('Stuck: npm install failed');
  });

  it('picks a question’s option, with the captain’s word', async () => {
    const question = { id: 'q1', question: 'Which layout?', context: 'The list or the grid.', options: [{ id: 'a', label: 'List' }, { id: 'b', label: 'Grid', detail: 'Denser' }], at: 900 };
    const el = card({ kind: 'question', agent: lead({ lead: { station: 0, title: 'Wishlist', repos: [], slice: 1, prs: [], questions: [question] } }) });
    expect(el.textContent).toContain('Pick: Which layout?');
    const note = el.querySelector('input');
    if (note) note.value = ' the grid reads better ';
    button(el, 'Pick B').click();
    await settle();
    expect(calls.answerLead).toHaveBeenCalledWith('a1', 'q1', 'b', 'the grid reads better');
  });

  it('fits a lead’s page into the window, never larger than it is, and steps round its pictures', () => {
    expect([fitScale(640, 800), fitScale(1280, 400), fitScale(4000, 4000)]).toEqual([0.5, 0.5, 1]);
    expect([zoomStep(2, 1, 3), zoomStep(0, -1, 3), zoomStep(1, 0, 3)]).toEqual([0, 2, 1]);
  });

  it('opens an option large over Comms, steps to the next with →, picks it there, and Esc closes only the picture', async () => {
    const question = { id: 'q1', question: 'Which layout?', context: '', options: [{ id: 'a', label: 'List', image: true }, { id: 'b', label: 'Grid', detail: 'Denser', image: true }], at: 900 };
    const el = card({ kind: 'question', agent: lead({ lead: { station: 0, title: 'Wishlist', repos: [], slice: 1, prs: [], questions: [question] } }) });
    document.body.append(el);
    const panelEsc = vi.fn();
    window.addEventListener('keydown', panelEsc);
    el.querySelector<HTMLImageElement>('img.cos-zoomable')?.click();
    const zoom = () => document.querySelector('.cos-zoom');
    expect(zoom()?.querySelector('iframe')?.getAttribute('src')).toBe('/api/artifacts/a1/q1.a.html?v=900');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(zoom()?.textContent).toContain('B · Grid');
    expect(zoom()?.textContent).toContain('Denser');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(zoom()).toBeNull();
    expect(panelEsc).not.toHaveBeenCalled();
    el.querySelectorAll<HTMLImageElement>('img.cos-zoomable')[1]?.click();
    button(zoom() as HTMLElement, 'Pick B').click();
    await settle();
    expect(zoom()).toBeNull();
    expect(calls.answerLead).toHaveBeenCalledWith('a1', 'q1', 'b', undefined);
    window.removeEventListener('keydown', panelEsc);
    el.remove();
  });

  it('replies to a lead whose turn ended, unjudged, in the captain’s words', async () => {
    const el = card({ kind: 'turn', agent: lead() });
    expect(el.textContent).toContain('Waiting for your reply');
    const text = el.querySelector('textarea');
    if (text) text.value = 'Carry on';
    button(el, 'Send').click();
    await settle();
    expect(calls.messageAgent).toHaveBeenCalledWith('a1', 'Lt. Vale', 'Carry on');
  });

  it('heads a card with what the chief of staff made of the turn and its words to the captain, why it routed it folded away', () => {
    const el = card({ kind: 'turn', agent: lead({}, { at: 1000, judged: verdict(2) }) });
    expect(el.textContent).toContain('Ship slice 2?');
    expect(el.querySelector('.cos-card > .cos-card-context')?.textContent).toBe('Go ahead with the tests first.');
    const why = [...el.querySelectorAll('details')].find((d) => d.querySelector('summary')?.textContent === 'Why the chief of staff routed it here');
    expect(why?.open).toBe(false);
    expect(why?.textContent).toContain('It changes the checkout.');
    expect(el.textContent).not.toContain('Send the chief of staff’s words');
  });

  it('beams to a lead’s team room from their card', () => {
    const el = card({ kind: 'turn', agent: lead() });
    el.querySelector<HTMLButtonElement>('[data-act="beam"]')?.click();
    expect(ui.goToAgent).toHaveBeenCalledWith('a1');
  });

  it('sends its ready words with one press, and holds them while they count down', async () => {
    const id = 'turn:a1:1000';
    const el = card({ kind: 'turn', agent: lead({}, { at: 1000, judged: verdict(4), sendsAt: Date.now() + 90_000 }) });
    expect(el.textContent).toContain('The chief of staff’s words for Lt. Vale:');
    expect(el.textContent).toMatch(/Sends itself in 1:(29|30)/);
    button(el, 'Hold').click();
    button(el, 'Send the chief of staff’s words').click();
    await settle();
    expect(calls.hold).toHaveBeenCalledWith(id);
    expect(calls.decide).toHaveBeenCalledWith(id, { send: true });
  });

  it('sends a reply it suggests as the captain’s own, numbered for the keys, beside a typed one', async () => {
    const replies = [{ label: 'Keep it open', text: 'Keep the goal open.' }, { label: 'Close it', text: 'Close it: it’s done.' }];
    const el = card({ kind: 'turn', agent: lead({}, { at: 1000, judged: { ...verdict(2), replies } }) });
    expect([...el.querySelectorAll('[data-act^="pick-"]')].map((b) => [b.getAttribute('data-act'), b.textContent])).toEqual([['pick-1', '1 · Keep it open'], ['pick-2', '2 · Close it']]);
    button(el, '2 · Close it').click();
    await settle();
    expect(calls.decide).toHaveBeenCalledWith('turn:a1:1000', { text: 'Close it: it’s done.' });
    expect(calls.messageAgent).not.toHaveBeenCalled();
    expect(el.querySelector('textarea')).not.toBeNull();
  });

  it('acknowledges any lead’s turn with Got it, judged or not, sending nothing', async () => {
    for (const read of [undefined, { at: 1000 }, { at: 1000, judged: verdict(2) }, { at: 1000, judged: verdict(1), sendsAt: Date.now() + 90_000 }]) {
      const el = card({ kind: 'turn', agent: lead({}, read) });
      expect(el.querySelector('[data-act="ack"]')?.textContent).toBe('Got it');
      expect(el.querySelectorAll('[data-act^="pick-"]')).toHaveLength(0);
      button(el, 'Got it').click();
    }
    await settle();
    expect(calls.decide.mock.calls).toEqual(Array(4).fill(['turn:a1:1000', { ack: true }]));
    expect(calls.messageAgent).not.toHaveBeenCalled();
  });

  it('closes a goal ready to close, saying what done looked like', async () => {
    const el = card({ kind: 'wrap-up', agent: lead({ lead: { station: 0, title: 'Wishlist', repos: [], slice: 1, prs: [], note: { done: 'Wishlists ship', learned: [], next: [] }, closing: { reason: 'All shipped', at: 900 } } }) });
    expect(el.textContent).toContain('Ready to close: All shipped');
    expect(el.textContent).toContain('Done looks like: Wishlists ship');
    button(el, 'Close goal').click();
    await settle();
    expect(calls.closeGoal).toHaveBeenCalled();
  });

  it('merges a lead’s open pull request from their turn, without going to the board', async () => {
    calls.shownPrs.mockReturnValue([{ projectId: 'p', pr }]);
    const recap = { id: 'system-recap', title: 'System recap: Wishlist', at: 900, image: true };
    const el = card({ kind: 'turn', agent: lead({ lead: { station: 2, title: 'Wishlist', repos: [], slice: 1, prs: [{ repo: 'acme/shop', number: 7, url: pr.url }], artifacts: [recap] } }) });
    expect(el.textContent).toContain('Their open pull request:');
    // the slice's recap with them, once, whatever was said since it went up
    expect([...el.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toEqual(['/api/artifacts/a1/system-recap.jpg?v=900']);
    expect(el.querySelector('[data-act="merge"]')?.textContent).toBe('squash & merge shop#7');
    button(el, 'squash & merge shop#7').click();
    await settle();
    // QA hasn't tested it, so it asks first, saying so
    expect(calls.confirmDialog).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('QA hasn’t tested it') }));
    expect(calls.mergePr).toHaveBeenCalledWith('p', 'acme/shop', 7, false);
  });

  it('merges a pull request QA needs the captain on from its card, or leaves it to the board', async () => {
    const qa = card({ kind: 'qa', projectId: 'p', pr });
    expect(qa.textContent).toContain('acme/shop#7 · Wishlist endpoints');
    button(qa, 'Pull requests').click();
    expect(ui.openBoard).toHaveBeenCalledWith('p', 'prs');
    calls.confirmDialog.mockResolvedValueOnce(false);
    button(qa, 'squash & merge shop#7').click();
    await settle();
    expect(calls.mergePr).not.toHaveBeenCalled();
    const conflicts = card({ kind: 'conflicts', projectId: 'p', pr });
    expect(conflicts.textContent).toContain('Resolve conflicts with its base branch');
  });
});
