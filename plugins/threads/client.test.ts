// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent } from '../../plugin-api/shared';
import type { Thread, ThreadsState } from './shared';

// the browser's plugin API brings every plugin's client part with it: what the view uses stands in for itself here
type Child = Node | string | null | undefined | false;
type Props = { class?: string; title?: string; placeholder?: string; value?: string; onclick?: () => void } | null;
let leads: Partial<Agent>[] = [];
let sent: ThreadsState | undefined;
const called: { path: string; body: unknown }[] = [];
let refuse: string | undefined;
// what Focus answers a spin-off with: the goal at a team station, or in line for one
let spun: unknown;
const goalsStarted: string[] = [];
// what happens while Focus answers: its new state reaches the browser, and the panel's drawn again, before the answer does
let meanwhile = () => undefined as unknown;
vi.mock('../../plugin-api/client', async () => ({
  callPlugin: (_id: string, path: string, body: unknown) => {
    called.push({ path, body });
    meanwhile();
    return refuse ? Promise.reject(new Error(refuse)) : Promise.resolve(path === '/spin-off' ? spun : { ok: true });
  },
  goalStarted: (_ui: unknown, agent: Agent) => goalsStarted.push(agent.id),
  goalTitle: (await import('../../plugin-api/shared')).goalTitle,
  busy: (_el: unknown, fn: () => Promise<unknown>, onError: (message: string) => void) => fn().catch((err: Error) => onError(err.message)),
  focus: { leadsIn: () => leads },
  pluginState: () => sent,
  timeAgo: (at: number) => `${at}d ago`,
  h: (tag: string, props: Props, ...children: Child[]) => {
    const el = document.createElement(tag);
    if (props?.class) el.className = props.class;
    if (props?.placeholder) el.setAttribute('placeholder', props.placeholder);
    if (props?.value !== undefined && el instanceof HTMLInputElement) el.value = props.value;
    if (props?.onclick) el.onclick = props.onclick;
    el.append(...children.filter((c): c is Node | string => c !== null && c !== undefined && c !== false));
    return el;
  },
}));
vi.mock('./threads.css', () => ({}));

const { default: threads, decidedLine, proposedLine, sortSaid, threadsView } = await import('./client');

const opened: string[] = [];
const errors: string[] = [];
const toasts: string[] = [];
const ui = { openAgent: (id: string) => opened.push(id), error: (message: string) => errors.push(message), hud: { toast: (_level: string, text: string) => toasts.push(text) } } as never;
const closedThread = (contact: string, at: number, decided?: Thread['decided']): Thread =>
  ({ goal: 'g1', goalTitle: 'Quality review', leadName: 'Lt. Reyes', contact, text: `Thread ${contact}`, at, slice: 1, closedAt: 3, ...(decided && { decided }) });
const live = { id: 'g7', name: 'Lt. Oyelaran', lead: { title: 'SaaS', repos: [], slice: 2, prs: [], contacts: [{ id: 'c1', text: 'Firm #2 gaps', slice: 1, at: 8 }] } };

const sections = (view: HTMLElement) => [...view.querySelectorAll('.threads-section')].map((s) => [
  s.querySelector('h3, summary')?.textContent,
  [...s.querySelectorAll('.threads-text')].map((t) => t.textContent),
]);
const button = (row: Element | undefined, text: string) => [...(row?.querySelectorAll('button') ?? [])].find((b) => b.textContent === text);
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  meanwhile = () => undefined;
  called.length = 0;
  errors.length = 0;
  toasts.length = 0;
  goalsStarted.length = 0;
  opened.length = 0;
  spun = { agent: { id: 'shop-lead-a1', name: 'Lt. Mensah', lead: { title: 'Thread c2', repos: [], slice: 1, prs: [] } } };
  refuse = undefined;
  leads = [live];
  sent = { sorts: {}, sorting: {}, closed: { shop: [closedThread('c2', 9), closedThread('c3', 12, { as: 'parked', note: 'until the first login', at: 2 }), closedThread('c4', 1, { as: 'dropped', note: 'covered', at: 1 })] } };
});

describe('a project’s threads in its goals panel', () => {
  it('counts the threads still asking something of someone, 0 once none is, and nothing with none at all', () => {
    expect(threads.goalsView?.readout?.('shop')).toBe('3');
    sent = { sorts: {}, sorting: {}, closed: { shop: [closedThread('c4', 1, { as: 'dropped', note: 'covered', at: 1 })] } };
    leads = [];
    expect(threads.goalsView?.readout?.('shop')).toBe('0');
    sent = undefined;
    expect(threads.goalsView?.readout?.('shop')).toBe('');
  });

  it('lists them by where they stand, to decide first and let go last (folded away), oldest first in each', () => {
    const view = threadsView(ui, 'shop');
    expect(sections(view)).toEqual([
      ['To decide (1)', ['Thread c2']],
      ['Under way (1)', ['Firm #2 gaps']],
      ['Parked (1)', ['Thread c3']],
      ['Dropped or resolved (1)', ['Thread c4']],
    ]);
    expect(view.querySelector('details')?.textContent).toMatch(/Dropped: covered · 1d ago/);
  });

  it('leaves a goal under way’s thread to its lead: a way to them, and nothing to decide', () => {
    const row = [...threadsView(ui, 'shop').querySelectorAll('.threads-row')].find((r) => r.classList.contains('live'));
    expect([...(row?.querySelectorAll('button') ?? [])].map((b) => b.textContent)).toEqual(['Talk']);
    button(row, 'Talk')?.click();
    expect(opened).toEqual(['g7']);
  });

  it('decides a closed goal’s thread with a note, written by Focus, and keeps the note being written as the panel’s drawn again', async () => {
    let view = threadsView(ui, 'shop');
    const row = () => view.querySelector('.threads-row');
    button(row() ?? undefined, 'Drop')?.click();
    const input = row()?.querySelector('input');
    expect(input?.getAttribute('placeholder')).toBe('Why drop it?');
    if (input) {
      input.value = 'Nobody needs it';
      input.dispatchEvent(new Event('input'));
    }
    // the ship changes, and the panel's drawn again: the note's still there
    view = threadsView(ui, 'shop');
    expect(row()?.querySelector('input')?.value).toBe('Nobody needs it');
    // the decision's in the register before Focus has answered: the panel drawn then has no note being written
    let drawnMeanwhile: HTMLElement | undefined;
    meanwhile = () => (drawnMeanwhile = threadsView(ui, 'shop'));
    button(row() ?? undefined, 'Drop')?.click();
    await settle();
    expect(called).toEqual([{ path: '/decide', body: { projectId: 'shop', goal: 'g1', contact: 'c2', as: 'dropped', note: 'Nobody needs it' } }]);
    expect(drawnMeanwhile?.querySelector('.threads-row input')).toBeNull();
    expect(threadsView(ui, 'shop').querySelector('.threads-row input')).toBeNull();
  });

  it('says why Focus refused a decision, and keeps the note to fix it', async () => {
    refuse = 'Say why it’s dropped';
    const view = threadsView(ui, 'shop');
    button(view.querySelector('.threads-row') ?? undefined, 'Drop')?.click();
    button(view.querySelector('.threads-row') ?? undefined, 'Drop')?.click();
    await settle();
    expect(errors).toEqual(['Say why it’s dropped']);
    expect(threadsView(ui, 'shop').querySelector('.threads-row input')).not.toBeNull();
    button(threadsView(ui, 'shop').querySelector('.threads-row') ?? undefined, 'Cancel')?.click();
  });

  it('takes a decision back with Undo, and offers every end but the one it has', async () => {
    const parked = [...threadsView(ui, 'shop').querySelectorAll('.threads-row')].find((r) => r.textContent?.includes('Thread c3'));
    expect([...(parked?.querySelectorAll('button') ?? [])].map((b) => b.textContent)).toEqual(['Next', 'Drop', 'Resolved', 'Spin off', 'Undo']);
    button(parked, 'Undo')?.click();
    await settle();
    expect(called).toEqual([{ path: '/decide', body: { projectId: 'shop', goal: 'g1', contact: 'c3', as: 'open', note: '' } }]);
  });

  it('says what was decided in words, the note as it was typed: by whom, until when, why, by what', () => {
    expect(decidedLine(closedThread('c1', 1, { as: 'next', at: 2 }))).toBe('Taken on by you · 2d ago');
    expect(decidedLine(closedThread('c1', 1, { as: 'next', note: 'Jonathan', at: 2 }))).toBe('Taken on by Jonathan · 2d ago');
    expect(decidedLine(closedThread('c1', 1, { as: 'resolved', at: 2 }))).toBe('Resolved · 2d ago');
    expect(decidedLine(closedThread('c1', 1, { as: 'resolved', note: '#1262', at: 2 }))).toBe('Resolved: #1262 · 2d ago');
    expect(decidedLine(closedThread('c1', 1, { as: 'parked', note: 'until the redesign', at: 2 }))).toBe('Parked: until the redesign · 2d ago');
    expect(decidedLine(closedThread('c1', 1, { as: 'next', note: 'Serves Exactly right: the audit takes it', proposed: true, at: 2 }))).toBe('Next: Serves Exactly right: the audit takes it · 2d ago');
    expect(decidedLine(closedThread('c1', 1))).toBeNull();
  });

  it('spins a closed goal’s thread off as a goal of its own, starting with the thread and where it came from, as edited', async () => {
    const row = () => threadsView(ui, 'shop').querySelector('.threads-row');
    button(row() ?? undefined, 'Spin off')?.click();
    const text = row()?.querySelector('textarea');
    expect(text?.value).toBe('Thread c2\n\n(Spun off from “Quality review”, a closed goal: its contact c2, noticed in slice 1.)');
    if (text) {
      text.value = 'Thread c2, for the second firm';
      text.dispatchEvent(new Event('input'));
    }
    // drawn again as the ship changes: the words as edited are still there
    expect(row()?.querySelector('textarea')?.value).toBe('Thread c2, for the second firm');
    button(row() ?? undefined, 'Spin off as a goal')?.click();
    await settle();
    expect(called).toEqual([{ path: '/spin-off', body: { projectId: 'shop', goal: 'g1', contact: 'c2', text: 'Thread c2, for the second firm' } }]);
    expect(goalsStarted).toEqual(['shop-lead-a1']);
    expect(row()?.querySelector('textarea')).toBeNull();
  });

  it('shows a thread spun off as the goal it went to, with a way to its lead while it’s under way', () => {
    const spunOff = closedThread('c2', 9, { as: 'next', spunOff: { goal: 'g8', title: 'Thread c2' }, at: 2 });
    sent = { sorts: {}, sorting: {}, closed: { shop: [spunOff] } };
    leads = [{ id: 'g8', name: 'Lt. Mensah', lead: { title: 'Second firm’s gaps', repos: [], slice: 1, prs: [] } }];
    const row = threadsView(ui, 'shop').querySelector('.threads-row:not(.live)') ?? undefined;
    expect(row?.querySelector('.threads-decided')?.textContent).toBe('Spun off as “Second firm’s gaps” · 2d ago');
    expect([...(row?.querySelectorAll('button') ?? [])].map((b) => b.textContent)).toEqual(['Talk', 'Park', 'Drop', 'Resolved', 'Undo']);
    button(row, 'Talk')?.click();
    expect(opened).toEqual(['g8']);
    // its goal closed (or still waiting in line): the title it started with, and no one to talk to
    leads = [];
    const after = threadsView(ui, 'shop').querySelector('.threads-row') ?? undefined;
    expect(after?.querySelector('.threads-decided')?.textContent).toBe('Spun off as “Thread c2” · 2d ago');
    expect(button(after, 'Talk')).toBeUndefined();
  });

  it('lists a closed goal’s ideas for next to decide after its contacts, saying they’re ideas', () => {
    const idea: Thread = { ...closedThread('next-abc', 3), text: 'Prefill from the card', idea: true };
    sent = { sorts: {}, sorting: {}, closed: { shop: [closedThread('c2', 9), idea] } };
    const view = threadsView(ui, 'shop');
    expect(sections(view).slice(0, 2)).toEqual([['To decide (1)', ['Thread c2']], ['Ideas left for next (1)', ['Prefill from the card']]]);
    expect(view.querySelectorAll('.threads-source')[1]?.textContent).toBe('Quality review · an idea for next · goal closed 3d ago');
  });

  it('shows what a model proposed of a thread to decide, with Accept first, which accepts it as proposed', async () => {
    sent = { sorts: {}, sorting: {}, closed: { shop: [{ ...closedThread('c2', 9), proposed: { as: 'dropped', note: 'Covered by #1236', at: 4 } }] } };
    const row = threadsView(ui, 'shop').querySelector('.threads-row:not(.live)') ?? undefined;
    expect(row?.querySelector('.threads-proposed')?.textContent).toBe('Proposed · Dropped: Covered by #1236');
    expect(proposedLine({ ...closedThread('c3', 9), proposed: { as: 'next', note: 'Exactly right: the audit takes it', at: 4 } })).toBe('Proposed · Next: Exactly right: the audit takes it');
    expect([...(row?.querySelectorAll('button') ?? [])].map((b) => b.textContent)[0]).toBe('Accept');
    button(row, 'Accept')?.click();
    await settle();
    expect(called).toEqual([{ path: '/accept', body: { projectId: 'shop', goal: 'g1', contact: 'c2' } }]);
  });

  it('asks for a sort, says while one’s out, and accepts every proposal of an end at once', async () => {
    const drop = (contact: string): Thread => ({ ...closedThread(contact, 9), proposed: { as: 'dropped', note: 'stale', at: 4 } });
    sent = { sorting: {}, sorts: { shop: { at: 5, asked: 3, proposed: 2, model: 'sonnet', costUsd: 0.04 } }, closed: { shop: [drop('c1'), drop('c2'), { ...closedThread('c3', 9), proposed: { as: 'parked', note: 'until May', at: 4 } }] } };
    const bar = () => threadsView(ui, 'shop').querySelector('.threads-sort') ?? undefined;
    expect([...(bar()?.querySelectorAll('button') ?? [])].map((b) => b.textContent)).toEqual(['Sort for me', 'Accept 1 park', 'Accept 2 drops']);
    expect(bar()?.querySelector('small')?.textContent).toBe('Sorted 5d ago: ends proposed for 2 of 3 · $0.04');
    button(bar(), 'Sort for me')?.click();
    button(bar(), 'Accept 2 drops')?.click();
    await settle();
    expect(called).toEqual([{ path: '/sort', body: { projectId: 'shop' } }, { path: '/accept', body: { projectId: 'shop', as: 'dropped' } }]);
    sent = { ...sent, sorting: { shop: { at: 6, asked: 3 } } };
    expect(bar()?.querySelector('button')?.textContent).toBe('Sorting 3…');
    expect(bar()?.querySelector('button')?.disabled).toBe(true);
  });

  it('offers no sort with nothing to decide, and says why a sort failed', () => {
    sent = { sorts: {}, sorting: {}, closed: { shop: [closedThread('c4', 1, { as: 'dropped', note: 'covered', at: 1 })] } };
    expect(threadsView(ui, 'shop').querySelector('.threads-sort')).toBeNull();
    expect(sortSaid({ at: 2, asked: 4, proposed: 0, model: 'sonnet', failed: 'timed out' })).toBe('The last sort failed 2d ago: timed out');
  });

  it('asks Focus to read the ledger afresh as the browser starts', () => {
    threads.start?.({ ui });
    expect(called.map((c) => c.path)).toEqual(['/read']);
  });

  it('says there are none when every contact was pursued or dropped', () => {
    sent = { sorts: {}, sorting: {}, closed: {} };
    leads = [];
    expect(threadsView(ui, 'shop').textContent).toMatch(/No loose threads/);
  });
});
