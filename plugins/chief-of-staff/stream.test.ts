// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Agent } from '../../plugin-api/client';
import type { ThreadEntry } from './thread';

// The stream as the captain uses it: a goal's line on the left says whether anything is new since they last looked.
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
    focus: { ...phone.focus, shown: [{ id: 'p', name: 'Shop', color: '#fff' }], leadsIn: () => leads, agent: (id: string) => leads.find((l) => l.id === id), isHidden: () => false, markRead: vi.fn(), onShip: () => () => undefined, onAgent: () => () => undefined },
    LCARS: { gold: 'gold', red: 'red', orange: 'orange', lilac: 'lilac' },
    markdownHtml: (text: string) => text,
    busy: async (_b: HTMLButtonElement, run: () => Promise<unknown>) => { await run(); },
    fill: (el: HTMLElement, ...children: (Node | null)[]) => el.replaceChildren(...children.flatMap((c) => (c ? [c] : []))),
    messageAgent: vi.fn(),
    readPlugin: (_p: string, path: string) => Promise.resolve({ entries: fake.threads[decodeURIComponent(path.split('/').pop() ?? '')] ?? [] }),
  };
});
vi.mock('./here', () => ({ waitingNow: () => [] }));
vi.mock('./inboxApi', () => ({ inbox: { view: () => Promise.resolve({ open: [], landed: [], decided: [] }) } }));
const { openStream } = await import('./stream');

let cleanups: (() => void)[] = [];
const ui = {
  panels: { open: vi.fn((opts: { body: HTMLElement }) => document.body.replaceChildren(opts.body)), own: (c: () => void) => cleanups.push(c), backTo: vi.fn() },
  openAgent: vi.fn(), error: vi.fn(),
};
const settle = () => new Promise((r) => setTimeout(r, 50));
afterEach(() => { for (const c of cleanups) c(); cleanups = []; });

describe('a goal’s line in the stream', () => {
  it('says there is something new when its lead spoke after the captain last looked at its thread', async () => {
    fake.threads.a = [{ kind: 'lead', at: 5, text: 'Plan?' }];
    fake.threads.b = [{ kind: 'lead', at: 6, text: 'Hello' }];
    openStream(ui as never);
    await settle();
    document.querySelectorAll<HTMLElement>('.cos-st-goal')[1].click();
    await settle();
    // goal a's lead speaks again while the captain is on goal b
    fake.threads.a = [...fake.threads.a, { kind: 'lead', at: 9, text: 'Done.' }];
    cleanups.forEach((c) => c());
    cleanups = [];
    openStream(ui as never);
    await settle();
    await settle();
    expect(document.querySelectorAll('.cos-st-goal')[0].textContent).toContain('New since you looked');
  });
});
