// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableIframePageLoading":true}}
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Agent } from '../../plugin-api/client';
import type { ThreadEntry } from './thread';

// Comms as the captain uses it (README.md#the-watch): an empty table with nobody at the conn, a berth pressed (or its
// number) takes the conn and opens the goal's sheet with its decision on it, another goal's card is a count on its
// berth, a hail drops over the sheet until it's put on screen and stood by, the Muster chip (or M) stands down and the
// muster comes up, and the lead's name (or T) slides in the panel to talk to them.
const fake = vi.hoisted((): { threads: Record<string, ThreadEntry[]>; conn?: string; stoodBy?: string[]; state?: () => void; open: unknown[]; waiting: unknown[] } => ({ threads: {}, open: [], waiting: [] }));
const agent = (id: string): Agent => ({
  id, name: `Lt. ${id}`, projectId: 'p', repo: 'acme/shop', task: 'lead', issue: { number: 0, title: 'Wishlist', url: '' }, desk: 0,
  status: 'done', activity: '', branch: 'b', baseBranch: 'main', costUsd: 0, startedAt: 1, finishedAt: 1000,
  avatar: { division: 'command', rank: 'ensign', species: 'human', skin: '#fff', hair: '#000', hairstyle: 'crop', accessory: 'none' },
  lead: {
    station: 0, title: `Goal ${id}`, repos: [], slice: 2, prs: [], note: { done: 'Saved items survive a reload', learned: [], next: ['Sharing'] },
    waypoints: [{ slice: 1, title: 'Quick wins', startedAt: 1 }, { slice: 2, heading: 'Saved list', startedAt: 2 }],
  },
});
const leads = [agent('a'), agent('b')];
vi.mock('../../plugin-api/client', async () => {
  const phone = await import('../../plugin-api/phone');
  return {
    ...phone,
    focus: { ...phone.focus, shown: [{ id: 'p', name: 'Shop', color: '#fff' }], project: () => ({ id: 'p', name: 'Shop', color: '#fff' }), leadsIn: () => leads, preview: () => undefined, reviews: new Map(), lines: () => [], shownPrs: () => [], agent: (id: string) => leads.find((l) => l.id === id), isHidden: () => false, markRead: vi.fn(), onShip: () => () => undefined, onAgent: () => () => undefined },
    goalTags: () => [],
    LCARS: { gold: 'gold', red: 'red', orange: 'orange', lilac: 'lilac', sky: 'sky', peach: 'peach' },
    markdownHtml: (text: string) => text,
    busy: async (_b: HTMLButtonElement, run: () => Promise<unknown>) => { await run(); },
    fill: (el: HTMLElement, ...children: (Node | null)[]) => el.replaceChildren(...children.flatMap((c) => (c ? [c] : []))),
    messageAgent: vi.fn(() => Promise.resolve()),
    // the watch as Focus keeps it: taking the conn is kept at once, and heard as the plugin's state changing
    pluginState: () => ({ autoSend: {}, conn: fake.conn, stoodBy: fake.stoodBy }),
    onPluginState: (_id: string, f: () => void) => { fake.state = f; return () => undefined; },
    callPlugin: vi.fn((_p: string, path: string, body: { lead?: string | null; key?: string }) => {
      if (path === '/conn') fake.conn = body.lead ?? undefined;
      if (path === '/stand-by' && body.key) fake.stoodBy = [...(fake.stoodBy ?? []), body.key];
      fake.state?.();
      return Promise.resolve({});
    }),
    readPlugin: (_p: string, path: string) => Promise.resolve({ entries: fake.threads[decodeURIComponent(path.split('/').pop() ?? '')] ?? [] }),
  };
});
vi.mock('./here', () => ({ waitingNow: () => fake.waiting }));
vi.mock('./inboxApi', () => ({ inbox: { view: () => Promise.resolve({ open: fake.open, landed: [], decided: [] }) } }));
const { openStream } = await import('./stream');
const { messageAgent } = await import('../../plugin-api/client');

let cleanups: (() => void)[] = [];
const ui = {
  panels: { open: vi.fn((opts: { body: HTMLElement }) => document.body.replaceChildren(opts.body)), own: (c: () => void) => cleanups.push(c), backTo: vi.fn() },
  openAgent: vi.fn(), error: vi.fn(),
};
const settle = () => new Promise((r) => setTimeout(r, 50));
afterEach(() => {
  for (const c of cleanups) c();
  cleanups = [];
  fake.conn = undefined;
  fake.stoodBy = undefined;
  fake.open = [];
  fake.waiting = [];
  fake.threads = {};
});
const part = (name: string) => document.querySelector<HTMLElement>(`[data-part=${name}]`);
const parts = (name: string) => [...document.querySelectorAll<HTMLElement>(`[data-part=${name}]`)];
const berth = (goal: string) => parts('berth').find((r) => r.textContent?.includes(goal));
const shown = (name: string) => !part(name)?.classList.contains('tw:hidden');
const press = (code: string, key = '') => window.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true }));
const open = async () => {
  localStorage.clear();
  openStream(ui as never);
  await settle();
};

// a card of goal b's lead waits on the captain, and an interrupt from goal a's that can't be undone
const card = { id: 'turn:b:1000', kind: 'turn', projectId: 'p', agentId: 'b', who: 'Lt. b', goal: 'Goal b', what: 'Filters first?', lane: 'needs-you', cos: { route: 2, ask: 'Filters first?', why: 'A pick.', says: 'Filters or sorting next.', message: '' } };
const hail = { id: 'turn:a:1000', kind: 'turn', projectId: 'p', agentId: 'a', who: 'Lt. a', goal: 'Goal a', what: 'Read production?', lane: 'needs-you', cos: { route: 3, check: 'irreversible', ask: 'Read production?', why: '', message: 'One read-only query.' } };

describe('the bridge with nobody at the conn', () => {
  it('is an empty table, every goal in its berth with what waits on it counted, the muster chip counting it all', async () => {
    fake.open = [card];
    await open();
    expect(shown('empty')).toBe(true);
    expect(shown('sheet')).toBe(false);
    expect(document.body.textContent).toContain('No watch');
    expect(berth('Goal b')?.querySelector('[data-part=count]')?.textContent).toBe('1');
    expect(part('chip')?.textContent).toBe('Muster1');
  });

  it('brings the muster up from the chip, by what each unblocks, and puts it away again', async () => {
    fake.open = [card];
    await open();
    part('chip')?.click();
    expect(shown('muster')).toBe(true);
    expect(part('row')?.textContent).toContain('Filters first?');
    expect(part('row')?.textContent).toContain('b idle until you answer');
    press('KeyM');
    expect(shown('muster')).toBe(false);
  });
});

describe('taking the conn', () => {
  it('opens the goal’s sheet: its head, its chart and its orders, the other berths dimmed with their counts', async () => {
    fake.open = [card];
    await open();
    berth('Goal a')?.click();
    await settle();
    expect(fake.conn).toBe('a');
    expect(shown('sheet')).toBe(true);
    expect(shown('empty')).toBe(false);
    expect(document.body.textContent).toContain('On watch · Goal a');
    expect(part('chart')?.textContent).toBe('Quick winsSaved listSharing · next');
    expect(part('sheet')?.textContent).toContain('Done: Saved items survive a reload');
    expect(berth('Goal b')?.className).toContain('tw:opacity-50');
    expect(berth('Goal b')?.querySelector('[data-part=count]')?.textContent).toBe('1');
  });

  it('takes it by a berth’s number too', async () => {
    await open();
    press('Digit2');
    await settle();
    expect(fake.conn).toBe('b');
  });

  it('puts the goal’s own decision on its sheet, with the chief of staff’s reading of it', async () => {
    fake.conn = 'b';
    fake.open = [card];
    fake.waiting = [{ kind: 'turn', agent: leads[1] }];
    await open();
    expect(part('decision')?.textContent).toContain('Decision · from Lt. b');
    expect(part('decision')?.textContent).toContain('Filters or sorting next.');
    expect(berth('Goal b')?.querySelector('[data-part=count]')?.className).toContain('tw:opacity-0');
  });

  it('keeps another goal’s card off the sheet: a count on its berth, no hail', async () => {
    fake.conn = 'a';
    fake.open = [card];
    await open();
    expect(shown('hail')).toBe(false);
    expect(part('decision')).toBeNull();
    expect(berth('Goal b')?.querySelector('[data-part=count]')?.textContent).toBe('1');
  });
});

describe('a hail on watch', () => {
  it('drops over the sheet, opens in place when pressed, and stands by into the muster', async () => {
    fake.conn = 'b';
    fake.open = [hail];
    await open();
    expect(shown('hail')).toBe(true);
    expect(part('hail')?.textContent).toBe('Hail · Goal aRead production?');
    part('hail')?.click();
    expect(part('hail')?.textContent).toContain('Hail · Goal a · Lt. a');
    expect(part('hail')?.textContent).toContain('One read-only query.');
    [...(part('hail')?.querySelectorAll('button') ?? [])].find((b) => b.textContent === 'Stand by')?.click();
    await settle();
    expect(fake.stoodBy).toEqual(['turn:a:1000']);
    expect(shown('hail')).toBe(false);
    // standing down: the muster comes up, the hail in it, first and said to be stood by
    part('chip')?.click();
    await settle();
    expect(fake.conn).toBeUndefined();
    expect(shown('muster')).toBe(true);
    expect(part('row')?.textContent).toContain('Goal a · hail, stood by');
  });
});

describe('talking to the lead', () => {
  it('slides the panel in from the lead’s name with their conversation, sends what’s written, and goes on Esc', async () => {
    fake.conn = 'a';
    fake.threads.a = [{ kind: 'you', at: 1, text: 'Go' }, { kind: 'ops', at: 2, from: 'Ops', text: 'Following it.' }, { kind: 'lead', at: 3, text: 'Done.' }];
    await open();
    expect(part('talk')?.className).toContain('tw:translate-x-[260px]');
    part('who')?.click();
    await settle();
    expect(part('talk')?.className).not.toContain('tw:translate-x-[260px]');
    expect(part('talk')?.textContent).toContain('Done.');
    expect(part('talk')?.textContent).not.toContain('Following it.');
    const box = part('talk')?.querySelector('textarea');
    if (!box) throw new Error('no box to talk to them');
    box.value = 'Ship it';
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(messageAgent).toHaveBeenCalledWith('a', 'Lt. a', 'Ship it');
    press('Escape', 'Escape');
    expect(part('talk')?.className).toContain('tw:translate-x-[260px]');
  });
});

describe('the bridge while updates stream in', () => {
  it('keeps the berth under the captain’s press through an update, so the press still lands', async () => {
    fake.open = [card];
    await open();
    const pressed = berth('Goal a');
    pressed?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    // the plugin's state comes in between the press going down and coming up
    fake.state?.();
    await settle();
    expect(berth('Goal a')).toBe(pressed);
    pressed?.click();
    expect(fake.conn).toBe('a');
  });

  it('keeps what the captain is typing into a card through an update that doesn’t change the card', async () => {
    fake.conn = 'b';
    fake.open = [card];
    fake.waiting = [{ kind: 'turn', agent: leads[1] }];
    await open();
    const box = part('decision')?.querySelector('textarea');
    if (!box) throw new Error('no box on the decision card');
    box.value = 'Filters, but only';
    fake.state?.();
    await settle();
    expect(part('decision')?.querySelector('textarea')).toBe(box);
    expect(box.value).toBe('Filters, but only');
  });
});
