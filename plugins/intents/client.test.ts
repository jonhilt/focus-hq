// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IntentsState } from './shared';

// the browser's plugin API brings every plugin's client part with it: what the view uses stands in for itself here
type Child = Node | string | null | undefined | false;
type Props = { class?: string; placeholder?: string; onclick?: () => void } | null;
let sent: IntentsState | undefined;
const called: { path: string; body: unknown }[] = [];
let refuse: string | undefined;
vi.mock('../../plugin-api/client', () => ({
  callPlugin: (_id: string, path: string, body: unknown) => {
    called.push({ path, body });
    return refuse ? Promise.reject(new Error(refuse)) : Promise.resolve({ written: 1 });
  },
  busy: (_el: unknown, fn: () => Promise<unknown>, onError: (message: string) => void) => fn().catch((err: Error) => onError(err.message)),
  pluginState: () => sent,
  timeAgo: (at: number) => `${at}d ago`,
  h: (tag: string, props: Props, ...children: Child[]) => {
    const el = document.createElement(tag);
    if (props?.class) el.className = props.class;
    if (props?.placeholder) el.setAttribute('placeholder', props.placeholder);
    if (props?.onclick) el.onclick = props.onclick;
    el.append(...children.filter((c): c is Node | string => c !== null && c !== undefined && c !== false));
    return el;
  },
}));
vi.mock('./intents.css', () => ({}));

const { default: intents, agreedLine, intentsView, keyAction } = await import('./client');

const errors: string[] = [];
const ui = { error: (message: string) => errors.push(message) } as never;
const button = (root: Element, text: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === text);
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  called.length = 0;
  errors.length = 0;
  refuse = undefined;
  sent = { compasses: { shop: {
    about: { what: 'A shop people trust', guardrails: ['Never break checkout'], by: 'the user', at: 2 },
    intents: [{ id: 'value', what: 'Deliver value, reliably: orders arrive', why: 'from the draft', by: 'the user', at: 3 }, { id: 'reach', what: 'More shoppers', by: 'the user', at: 4 }],
  } } };
});

describe('the Intents view', () => {
  it('shows what the project is for and its guardrails, then each intent, its name in bold, when it was agreed and why', () => {
    const view = intentsView(ui, 'shop');
    expect(view.querySelector('.intents-about')?.textContent).toContain('A shop people trust');
    expect([...view.querySelectorAll('.intents-guardrails li')].map((li) => li.textContent)).toEqual(['Never break checkout']);
    expect([...view.querySelectorAll('.intents-row .intents-what')].map((w) => [w.querySelector('b')?.textContent ?? null, w.textContent])).toEqual([
      ['Deliver value, reliably', 'Deliver value, reliably: orders arrive'],
      [null, 'More shoppers'],
    ]);
    expect(agreedLine({ why: 'from the draft', at: 3 })).toBe('from the draft · agreed 3d ago');
    expect(intents.goalsView?.readout?.('shop')).toBe('2');
    expect(intents.goalsView?.readout?.('blog')).toBe('');
  });

  it('adds intents from what’s pasted, one a line, and says why', async () => {
    const view = intentsView(ui, 'shop');
    button(view, 'Add intents')?.click();
    const [text, why] = [...view.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>('.intents-field')];
    if (!text || !why) throw new Error('no add form');
    text.value = '1. Quality proven\n2. Fun to use';
    text.dispatchEvent(new Event('input'));
    why.value = 'from the draft';
    why.dispatchEvent(new Event('input'));
    button(view, 'Agree')?.click();
    await settle();
    expect(called).toEqual([{ path: '/change', body: expect.objectContaining({ projectId: 'shop', do: 'add', text: '1. Quality proven\n2. Fun to use', why: 'from the draft' }) }]);
  });

  it('brings a refused change back as it was written, saying why it was refused', async () => {
    refuse = 'It says that already';
    const view = intentsView(ui, 'shop');
    button(view.querySelectorAll('.intents-row')[0] ?? view, 'Edit')?.click();
    button(view, 'Agree')?.click();
    await settle();
    expect(called[0]?.body).toEqual(expect.objectContaining({ do: 'edit', id: 'value', what: 'Deliver value, reliably: orders arrive' }));
    expect(errors).toEqual(['It says that already']);
    expect(view.querySelector<HTMLTextAreaElement>('.intents-field')?.value).toBe('Deliver value, reliably: orders arrive');
  });

  it('saves with Enter from a one-line field, takes Enter as a new line in a box of several, and leaves with Esc', async () => {
    expect([keyAction('Enter', true), keyAction('Enter', false), keyAction('Escape', false), keyAction('a', true)]).toEqual(['save', null, 'cancel', null]);
    const view = intentsView(ui, 'shop');
    button(view, 'Edit')?.click();
    const why = view.querySelector<HTMLInputElement>('.intents-about input.intents-field');
    why?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await settle();
    expect(called[0]?.body).toEqual(expect.objectContaining({ do: 'about', what: 'A shop people trust', guardrails: 'Never break checkout' }));
    button(view.querySelectorAll('.intents-row')[0] ?? view, 'Edit')?.click();
    view.querySelector('.intents-row textarea')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(view.querySelector('.intents-row textarea')).toBeNull();
  });

  it('asks why before retiring one, and offers the first intents when there are none', async () => {
    const view = intentsView(ui, 'shop');
    button(view.querySelectorAll('.intents-row')[1] ?? view, 'Retire')?.click();
    const why = view.querySelector<HTMLInputElement>('.intents-field');
    if (!why) throw new Error('no retire form');
    why.value = 'covered by value';
    why.dispatchEvent(new Event('input'));
    button(view.querySelectorAll('.intents-row')[1] ?? view, 'Retire')?.click();
    await settle();
    expect(called[0]?.body).toEqual(expect.objectContaining({ do: 'retire', id: 'reach', why: 'covered by value' }));
    sent = { compasses: {} };
    const empty = intentsView(ui, 'blog');
    expect([empty.querySelector('.intents-about')?.textContent, button(empty, 'Add the first intents')?.textContent]).toEqual(['What it’s forNot said yetSay what it’s for', 'Add the first intents']);
  });
});
