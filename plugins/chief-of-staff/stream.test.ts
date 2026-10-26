// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Agent } from '../../plugin-api/client';
import type { ThreadEntry } from './thread';

// The stream as the captain uses it: a goal's row on the left says whether anything is new since they last looked, the
// goals fold to a strip and back, and the quick replies reach the lead.
const fake = vi.hoisted((): { threads: Record<string, ThreadEntry[]> } => ({ threads: {} }));
const agent = (id: string): Agent => ({
  id, name: `Lt. ${id}`, projectId: 'p', repo: 'acme/shop', task: 'lead', issue: { number: 0, title: 'Wishlist', url: '' }, desk: 0,
  status: 'working', activity: '', branch: 'b', baseBranch: 'main', costUsd: 0, startedAt: 1, finishedAt: 1000,
  avatar: { division: 'command', rank: 'ensign', species: 'human', skin: '#fff', hair: '#000', hairstyle: 'crop', accessory: 'none' },
  lead: { station: 0, title: `Goal ${id}`, repos: [], slice: 1, prs: [] },
});
const leads = [agent('a'), agent('b')];
vi.mock('../../plugin-api/client', async () => {
  const phone = await import('../../plugin-api/phone');
  return {
    ...phone,
    focus: { ...phone.focus, shown: [{ id: 'p', name: 'Shop', color: '#fff' }], project: () => ({ id: 'p', name: 'Shop', color: '#fff' }), leadsIn: () => leads, agent: (id: string) => leads.find((l) => l.id === id), isHidden: () => false, markRead: vi.fn(), onShip: () => () => undefined, onAgent: () => () => undefined },
    LCARS: { gold: 'gold', red: 'red', orange: 'orange', lilac: 'lilac' },
    markdownHtml: (text: string) => text,
    busy: async (_b: HTMLButtonElement, run: () => Promise<unknown>) => { await run(); },
    fill: (el: HTMLElement, ...children: (Node | null)[]) => el.replaceChildren(...children.flatMap((c) => (c ? [c] : []))),
    messageAgent: vi.fn(() => Promise.resolve()),
    readPlugin: (_p: string, path: string) => Promise.resolve({ entries: fake.threads[decodeURIComponent(path.split('/').pop() ?? '')] ?? [] }),
  };
});
vi.mock('./here', () => ({ waitingNow: () => [] }));
vi.mock('./inboxApi', () => ({ inbox: { view: () => Promise.resolve({ open: [], landed: [], decided: [] }) } }));
const { openStream } = await import('./stream');
const { messageAgent } = await import('../../plugin-api/client');

let cleanups: (() => void)[] = [];
const ui = {
  panels: { open: vi.fn((opts: { body: HTMLElement }) => document.body.replaceChildren(opts.body)), own: (c: () => void) => cleanups.push(c), backTo: vi.fn() },
  openAgent: vi.fn(), error: vi.fn(),
};
const settle = () => new Promise((r) => setTimeout(r, 50));
afterEach(() => { for (const c of cleanups) c(); cleanups = []; });

describe('a goal’s row in the stream', () => {
  it('says there is something new when its lead spoke after the captain last looked at its thread', async () => {
    fake.threads.a = [{ kind: 'lead', at: 5, text: 'Plan?' }];
    fake.threads.b = [{ kind: 'lead', at: 6, text: 'Hello' }];
    openStream(ui as never);
    await settle();
    document.querySelectorAll<HTMLElement>('.cos-st-row')[1].click();
    await settle();
    // goal a's lead speaks again while the captain is on goal b
    fake.threads.a = [...fake.threads.a, { kind: 'lead', at: 9, text: 'Done.' }];
    cleanups.forEach((c) => c());
    cleanups = [];
    openStream(ui as never);
    await settle();
    await settle();
    expect(document.querySelectorAll('.cos-st-row')[0].classList).toContain('new');
    expect(document.querySelectorAll('.cos-st-row')[1].classList).not.toContain('new');
  });
});

describe('the goals list', () => {
  it('folds to a strip and opens again, and stays as it was left', async () => {
    localStorage.clear();
    openStream(ui as never);
    await settle();
    document.querySelector<HTMLElement>('.cos-st-foldbtn')?.click();
    expect(document.querySelector('.cos-st-row')).toBeNull();
    expect(document.querySelector('.cos-st-strip')?.textContent).toBe('Goals');
    cleanups.forEach((c) => c());
    cleanups = [];
    openStream(ui as never);
    await settle();
    expect(document.querySelector('.cos-st-strip')).not.toBeNull();
    document.querySelector<HTMLElement>('.cos-st-strip')?.click();
    expect(document.querySelectorAll('.cos-st-row')).toHaveLength(2);
  });
});

describe('the foot of a goal’s thread', () => {
  it('sends a quick reply to the lead of the goal picked', async () => {
    localStorage.clear();
    openStream(ui as never);
    await settle();
    [...document.querySelectorAll<HTMLElement>('.cos-st-quick button')].find((b) => b.textContent === 'Carry on')?.click();
    await settle();
    const picked = document.querySelector('.cos-st-row.sel')?.textContent ?? '';
    const id = picked.includes('Goal a') ? 'a' : 'b';
    expect(messageAgent).toHaveBeenCalledWith(id, `Lt. ${id}`, 'Carry on');
  });
});
