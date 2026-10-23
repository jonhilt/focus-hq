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
// what happens while Focus answers: its new state reaches the browser, and the panel's drawn again, before the answer does
let meanwhile = () => undefined as unknown;
vi.mock('../../plugin-api/client', () => ({
  callPlugin: (_id: string, path: string, body: unknown) => {
    called.push({ path, body });
    meanwhile();
    return refuse ? Promise.reject(new Error(refuse)) : Promise.resolve({ ok: true });
  },
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

const { default: threads, decidedLine, threadsView } = await import('./client');

const opened: string[] = [];
const errors: string[] = [];
const ui = { openAgent: (id: string) => opened.push(id), error: (message: string) => errors.push(message) } as never;
const closedThread = (contact: string, at: number, decided?: Thread['decided']): Thread =>
  ({ goal: 'g1', goalTitle: 'Quality review', leadName: 'Lt. Reyes', contact, text: `Thread ${contact}`, at, slice: 1, closedAt: 3, ...(decided && { decided }) });
const live = { id: 'g7', name: 'Lt. Oyelaran', lead: { station: 0, title: 'SaaS', repos: [], slice: 2, prs: [], contacts: [{ id: 'c1', text: 'Firm #2 gaps', slice: 1, at: 8 }] } };

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
  refuse = undefined;
  leads = [live];
  sent = { closed: { shop: [closedThread('c2', 9), closedThread('c3', 12, { as: 'parked', note: 'until the first login', at: 2 }), closedThread('c4', 1, { as: 'dropped', note: 'covered', at: 1 })] } };
});

describe('a project’s threads in its goals panel', () => {
  it('counts the threads still asking something of someone, 0 once none is, and nothing with none at all', () => {
    expect(threads.goalsView?.readout?.('shop')).toBe('3');
    sent = { closed: { shop: [closedThread('c4', 1, { as: 'dropped', note: 'covered', at: 1 })] } };
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
    expect([...(parked?.querySelectorAll('button') ?? [])].map((b) => b.textContent)).toEqual(['Next', 'Drop', 'Resolved', 'Undo']);
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
    expect(decidedLine(closedThread('c1', 1))).toBeNull();
  });

  it('asks Focus to read the ledger afresh as the browser starts', () => {
    threads.start?.({ ui });
    expect(called.map((c) => c.path)).toEqual(['/read']);
  });

  it('says there are none when every contact was pursued or dropped', () => {
    sent = { closed: {} };
    leads = [];
    expect(threadsView(ui, 'shop').textContent).toMatch(/No loose threads/);
  });
});
