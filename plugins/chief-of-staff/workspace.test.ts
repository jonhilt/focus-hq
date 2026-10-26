// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableIframePageLoading":true}}
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Agent } from '../../plugin-api/client';
import type { ThreadEntry } from './thread';

// A lead's workspace as the captain watches it: its Activity tab keeps up with the lead's log, even once the browser
// holds the log at its cap and drops the oldest line as each new one comes; its Browser tab keeps up with a preview
// starting; its Pull requests tab with QA's word; and folded, it comes back as a strip after the goals went and returned.
const fake = vi.hoisted((): { threads: Record<string, ThreadEntry[]>; reviews: Map<string, unknown>; preview?: unknown; lines: { t: number; kind: string; text: string }[]; on?: (id: string) => void; ship?: () => void } => ({ threads: {}, reviews: new Map(), lines: [] }));
const agent = (id: string): Agent => ({
  id, name: `Lt. ${id}`, projectId: 'p', repo: 'acme/shop', task: 'lead', issue: { number: 0, title: 'Wishlist', url: '' }, desk: 0,
  status: 'working', activity: '', branch: 'b', baseBranch: 'main', costUsd: 0, startedAt: 1, finishedAt: 1000,
  avatar: { division: 'command', rank: 'ensign', species: 'human', skin: '#fff', hair: '#000', hairstyle: 'crop', accessory: 'none' },
  lead: { station: 0, title: `Goal ${id}`, repos: [], slice: 1, prs: [] },
});
// goal a's lead has put two visuals on their screen and has a pull request open
const withWork = (a: Agent): Agent => ({ ...a, lead: { station: 0, title: a.lead?.title ?? '', repos: [], slice: 1, artifacts: [{ id: 'old', title: 'Old sketch', at: 50 }, { id: 'flow', title: 'The data flow', at: 100, image: true }], prs: [{ repo: 'acme/shop', number: 5, url: 'https://github.com/acme/shop/pull/5' }] } });
const leads = [withWork(agent('a')), agent('b')];
vi.mock('../../plugin-api/client', async () => {
  const phone = await import('../../plugin-api/phone');
  return {
    ...phone,
    focus: { ...phone.focus, shown: [{ id: 'p', name: 'Shop', color: '#fff' }], project: () => ({ id: 'p', name: 'Shop', color: '#fff' }), leadsIn: () => leads, preview: () => fake.preview, reviews: fake.reviews, lines: (id: string) => (id === 'a' ? fake.lines : []), onLines: (f: (id: string) => void) => { fake.on = f; return () => undefined; }, agent: (id: string) => leads.find((l) => l.id === id), isHidden: () => false, markRead: vi.fn(), onShip: (f: () => void) => { fake.ship = f; return () => undefined; }, onAgent: () => () => undefined },
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

let cleanups: (() => void)[] = [];
const ui = {
  panels: { open: vi.fn((opts: { body: HTMLElement }) => document.body.replaceChildren(opts.body)), own: (c: () => void) => cleanups.push(c), backTo: vi.fn() },
  openAgent: vi.fn(), error: vi.fn(),
};
const settle = () => new Promise((r) => setTimeout(r, 50));
afterEach(() => { for (const c of cleanups) c(); cleanups = []; });

describe('the activity tab with a full log', () => {
  it('keeps showing the latest lines once the browser has dropped the oldest to stay at its cap', async () => {
    localStorage.clear();
    // the browser keeps at most 600 lines per agent (client/src/net/state.ts MAX_LINES)
    fake.lines = Array.from({ length: 600 }, (_, i) => ({ t: i + 1, kind: 'tool', text: `Read file${i}` }));
    fake.threads.a = [];
    openStream(ui as never);
    await settle();
    [...document.querySelectorAll<HTMLElement>('.cos-ws-tab')].find((b) => b.textContent?.startsWith('Activity'))?.click();
    expect(document.querySelector('.cos-ws-body')?.textContent).toContain('Read file599');
    // a new line arrives: the oldest is dropped, the length stays 600
    fake.lines = [...fake.lines.slice(1), { t: 700, kind: 'tool', text: 'Read newest' }];
    fake.on?.('a');
    expect(document.querySelector('.cos-ws-body')?.textContent).toContain('Read newest');
  });
});

const pr = { repo: 'acme/shop', number: 5 };
const tab = (name: string) => [...document.querySelectorAll<HTMLElement>('.cos-ws-tab')].find((b) => b.textContent?.startsWith(name))?.click();
describe('the browser tab, and the workspace folded', () => {
  it('keeps up with what the starting preview is doing', async () => {
    localStorage.clear();
    fake.threads.a = [];
    fake.preview = { ...pr, projectId: 'p', title: 'Wishlist', status: 'starting', activity: 'Installing packages', links: [] };
    openStream(ui as never);
    await settle();
    tab('Browser');
    expect(document.querySelector('.cos-ws-body')?.textContent).toContain('Installing packages');
    fake.preview = { ...(fake.preview as object), activity: 'Building the app' };
    fake.ship?.();
    await settle();
    expect(document.querySelector('.cos-ws-body')?.textContent).toContain('Building the app');
    fake.preview = undefined;
  });
  it('comes back as a strip after the goals went and returned', async () => {
    localStorage.clear();
    localStorage.setItem('cos-stream-workspace-folded', '1');
    fake.threads.a = [];
    openStream(ui as never);
    await settle();
    expect(document.querySelector('.cos-st-strip')).not.toBeNull();
    const all = leads.splice(0, leads.length);
    fake.ship?.();
    await settle();
    expect(document.querySelector('.cos-st-strip')).toBeNull();
    leads.push(...all);
    fake.ship?.();
    await settle();
    expect(document.querySelector('.cos-st-strip')).not.toBeNull();
  });
});

describe('the pull requests tab', () => {
  it('keeps up with QA’s word on an open pull request', async () => {
    localStorage.clear();
    fake.threads.a = [];
    openStream(ui as never);
    await settle();
    tab('Pull requests');
    expect(document.querySelector('.cos-ws-body')?.textContent).toContain('not tested');
    fake.reviews.set('acme/shop#5', { projectId: 'p', repo: 'acme/shop', number: 5, title: 'Saved', status: 'testing' });
    fake.ship?.();
    await settle();
    expect(document.querySelector('.cos-ws-body')?.textContent).toContain('QA testing');
    fake.reviews.clear();
  });
});

