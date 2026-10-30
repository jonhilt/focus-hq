// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableIframePageLoading":true}}
import { describe, expect, it, vi } from 'vitest';
import type { Agent } from '../../plugin-api/client';

// The cards of Comms' stack drawn from what Focus holds (stackCards.ts): what each says of itself, a pull request no
// longer on the board, an exhibit or a question that's gone, and a question's options picked from its card.
vi.mock('../../plugin-api/client', async () => {
  const phone = await import('../../plugin-api/phone');
  return {
    ...phone,
    focus: { ...phone.focus, shownPrs: () => [], reviews: new Map(), mergeMethod: () => 'Squash' },
    markdownHtml: (text: string) => text,
    busy: async (_b: HTMLButtonElement, run: () => Promise<unknown>) => { await run(); },
    answerLead: vi.fn(() => Promise.resolve()),
    goalTags: () => [],
    LCARS: {},
  };
});
const { answerLead } = await import('../../plugin-api/client');
const { artifactCard, mergesSay, namedOf, prCard, questionCard, sizeSays } = await import('./stackCards');

const question = { id: 'q1', question: 'Grid or list?', context: 'Saved items', options: [{ id: 'a', label: 'Grid', detail: 'Pictures' }, { id: 'b', label: 'List' }], at: 1 };
const lead = (work: Partial<NonNullable<Agent['lead']>> = {}): Pick<Agent, 'id' | 'name' | 'lead'> =>
  ({ id: 'l1', name: 'Lt. Ada', lead: { title: 'Saved items', repos: [], slice: 2, prs: [], ...work } });
const when = () => 'at noon';

describe('a card in the stack', () => {
  it('says what it is, its name and where it stands, for its spine and its mention', () => {
    const l = lead({ prs: [{ repo: 'acme/shop', number: 9, url: 'u', outcome: 'merged' }], questions: [question], artifacts: [{ id: 'flow', title: 'Flow', at: 1, slice: 2 }] });
    expect(namedOf({ kind: 'pr', id: 'acme/shop#9', repo: 'acme/shop', number: 9 }, l)).toEqual({ glyph: 'PR', name: 'shop#9', state: 'merged' });
    expect(namedOf({ kind: 'pr', id: 'acme/shop#3', repo: 'acme/shop', number: 3 }, l).state).toBe('not open');
    expect(namedOf({ kind: 'question', id: 'q1' }, l)).toEqual({ glyph: 'Q', name: 'Grid or list?', state: 'open' });
    expect(namedOf({ kind: 'artifact', id: 'gone' }, l)).toEqual({ glyph: 'EX', name: 'gone', state: '' });
    expect(namedOf({ kind: 'talk' }, l).name).toBe('Lt. Ada');
    expect(namedOf({ kind: 'exhibits' }, l).state).toBe('1');
  });

  it('says how a pull request merges and how big it is, and nothing of its size when GitHub didn’t say', () => {
    expect(mergesSay({ mergeable: 'MERGEABLE', isDraft: true })).toBe('draft');
    expect(mergesSay({ mergeable: 'CONFLICTING', isDraft: false })).toBe('conflicts');
    expect(mergesSay({ mergeable: 'MERGEABLE', isDraft: false, mergeCheck: { state: 'refused', head: 'x' } })).toBe('check refused');
    expect(mergesSay({ mergeable: 'MERGEABLE', isDraft: false, mergeCheck: { state: 'checking', head: 'x' } })).toBe('check checking');
    expect(mergesSay({ mergeable: 'UNKNOWN', isDraft: false })).toBe('not known yet');
    expect(sizeSays({ additions: 1, deletions: 0, changedFiles: 1 })).toBe('+1 −0 · 1 file');
    expect(sizeSays({ additions: 1, deletions: 0 })).toBe('+1 −0');
    expect(sizeSays({})).toBe('');
  });

  it('says a pull request that’s left the board merged or isn’t open, still linking it on GitHub', () => {
    const merged = prCard({ error: vi.fn() }, { repo: 'acme/shop', number: 9 }, lead({ prs: [{ repo: 'acme/shop', number: 9, url: 'https://github.com/acme/shop/pull/9', outcome: 'merged' }] }));
    expect(merged.textContent).toContain('It merged.');
    expect(merged.querySelector('[data-part=github]')?.getAttribute('href')).toBe('https://github.com/acme/shop/pull/9');
    expect(prCard({ error: vi.fn() }, { repo: 'acme/shop', number: 4 }, undefined).textContent).toContain('It isn’t open on the board.');
  });

  it('says an exhibit or a question that’s gone is gone', () => {
    expect(artifactCard('gone', lead(), when).textContent).toContain('no longer on their screen');
    expect(questionCard({ error: vi.fn() }, 'q9', lead()).textContent).toContain('no longer asked');
  });

  it('shows a question’s options scaled to the card, each picked from it, and none once it’s answered', async () => {
    const card = questionCard({ error: vi.fn() }, 'q1', lead({ questions: [question] }));
    expect(card.textContent).toContain('Grid or list?');
    expect([...card.querySelectorAll('[data-part=option] iframe')].map((f) => f.getAttribute('src'))).toEqual([expect.stringContaining('q1.a'), expect.stringContaining('q1.b')]);
    card.querySelector<HTMLButtonElement>('[data-part=pick]')?.click();
    await Promise.resolve();
    expect(answerLead).toHaveBeenCalledWith('l1', 'q1', 'a');
    const answered = questionCard({ error: vi.fn() }, 'q1', lead({ questions: [{ ...question, answer: { option: 'b', at: 2 } }] }));
    expect(answered.textContent).toContain('Question · answered');
    expect([...answered.querySelectorAll<HTMLButtonElement>('[data-part=pick]')].every((b) => b.disabled)).toBe(true);
  });

  it('shows an exhibit with when it went up and a tab of its own', () => {
    const card = artifactCard('flow', lead({ artifacts: [{ id: 'flow', title: 'Flow', at: 1, slice: 2 }] }), when);
    expect(card.textContent).toContain('Lt. Ada put it up at noon');
    expect(card.querySelector('[data-part=new-tab]')?.getAttribute('href')).toContain('flow.html');
  });
});
