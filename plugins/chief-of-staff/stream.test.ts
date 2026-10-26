// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableIframePageLoading":true}}
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Agent } from '../../plugin-api/client';
import type { ThreadEntry } from './thread';

// The stream as the captain uses it: a goal's row on the left says whether anything is new since they last looked, the
// goals fold to a strip and back, the quick replies reach the lead, and their workspace has its tabs and the box to talk to them.
const fake = vi.hoisted((): { threads: Record<string, ThreadEntry[]>; preview?: unknown } => ({ threads: {} }));
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
    focus: { ...phone.focus, shown: [{ id: 'p', name: 'Shop', color: '#fff' }], project: () => ({ id: 'p', name: 'Shop', color: '#fff' }), leadsIn: () => leads, preview: () => fake.preview, reviews: new Map(), lines: (id: string) => (id === 'a' ? [{ t: 1, kind: 'tool', text: 'Read stream.ts' }, { t: 2, kind: 'text', text: 'Hmm' }] : []), onLines: () => () => undefined, agent: (id: string) => leads.find((l) => l.id === id), isHidden: () => false, markRead: vi.fn(), onShip: () => () => undefined, onAgent: () => () => undefined },
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

describe('the lead’s workspace', () => {
  const pickA = async () => {
    localStorage.clear();
    openStream(ui as never);
    await settle();
    [...document.querySelectorAll<HTMLElement>('.cos-st-row')].find((r) => r.textContent?.includes('Goal a'))?.click();
    await settle();
  };
  it('has the box to talk to the lead, and what’s written there goes straight to them', async () => {
    await pickA();
    expect(document.querySelector('.cos-st-foot textarea')).toBeNull();
    const box = document.querySelector<HTMLTextAreaElement>('.cos-ws textarea');
    if (!box) throw new Error('no box in the workspace');
    box.value = 'Ship the dot';
    document.querySelector<HTMLElement>('.cos-ws .cos-st-send')?.click();
    await settle();
    expect(messageAgent).toHaveBeenCalledWith('a', 'Lt. a', 'Ship the dot');
  });
  it('shows their conversation alone, and what they’ve been doing on its own tab', async () => {
    fake.threads.a = [{ kind: 'you', at: 1, text: 'Go' }, { kind: 'ops', at: 2, from: 'Ops', text: 'Following it.' }, { kind: 'lead', at: 3, text: 'Done.' }];
    await pickA();
    await settle();
    expect(document.querySelector('.cos-ws-body')?.textContent).toContain('Done.');
    expect(document.querySelector('.cos-ws-body')?.textContent).not.toContain('Following it.');
    [...document.querySelectorAll<HTMLElement>('.cos-ws-tab')].find((t) => t.textContent?.startsWith('Activity'))?.click();
    expect(document.querySelector('.cos-ws-body')?.textContent).toContain('Read stream.ts');
    expect(document.querySelector('.cos-ws-body')?.textContent).not.toContain('Hmm');
  });
  it('folds to a strip and opens again', async () => {
    await pickA();
    document.querySelector<HTMLElement>('.cos-ws .cos-st-foldbtn')?.click();
    expect(document.querySelector('.cos-ws')).toBeNull();
    expect(document.querySelector('.cos-st-side .cos-st-strip')?.textContent).toBe('Lt. a\'s workspace');
    document.querySelector<HTMLElement>('.cos-st-side .cos-st-strip')?.click();
    expect(document.querySelector('.cos-ws')).not.toBeNull();
  });
});

describe('the lead’s workspace, their screen and browser', () => {
  const open = async (tab: string) => {
    localStorage.clear();
    openStream(ui as never);
    await settle();
    [...document.querySelectorAll<HTMLElement>('.cos-st-row')].find((r) => r.textContent?.includes('Goal a'))?.click();
    await settle();
    [...document.querySelectorAll<HTMLElement>('.cos-ws-tab')].find((t) => t.textContent?.startsWith(tab))?.click();
    return document.querySelector('.cos-ws-body');
  };
  it('shows the latest visual on their screen as its picture, the others to pick from', async () => {
    const body = await open('Screen');
    expect(body?.querySelector('.cos-ws-art-h b')?.textContent).toBe('The data flow');
    expect(body?.querySelector<HTMLImageElement>('.cos-ws-pic')?.getAttribute('src')).toContain('/flow.jpg');
    [...(body?.querySelectorAll<HTMLElement>('.cos-ws-thumb') ?? [])].find((t) => t.textContent?.includes('Old sketch'))?.click();
    // one with no picture shows as the page itself
    expect(document.querySelector('.cos-ws-art-h b')?.textContent).toBe('Old sketch');
    expect(document.querySelector('.cos-ws-body iframe')?.getAttribute('src')).toContain('/old.html');
  });
  it('shows the preview when it runs one of their pull requests: the page once it’s up, what it’s doing before', async () => {
    fake.preview = { projectId: 'p', repo: 'acme/shop', number: 5, title: 'Saved', status: 'running', activity: 'Up', links: [{ url: 'http://localhost:5173/' }] };
    expect((await open('Browser'))?.querySelector('iframe')?.getAttribute('src')).toBe('http://localhost:5173/');
    fake.preview = { projectId: 'p', repo: 'acme/shop', number: 5, title: 'Saved', status: 'starting', activity: 'Installing dependencies', links: [] };
    const starting = await open('Browser');
    expect(starting?.querySelector('iframe')).toBeNull();
    expect(starting?.textContent).toContain('Installing dependencies');
    fake.preview = { projectId: 'p', repo: 'acme/shop', number: 9, title: 'Other', status: 'running', activity: 'Up', links: [{ url: 'http://localhost:5174/' }] };
    expect((await open('Browser'))?.textContent).toContain('No preview of Lt. a');
    fake.preview = undefined;
  });
});

