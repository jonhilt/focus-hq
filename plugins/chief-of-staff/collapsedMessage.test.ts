// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../plugin-api/client', async () => ({ h: (await import('../../plugin-api/phone')).h, markdownHtml: (text: string) => `<p>${text}</p>` }));
const { collapsedMessage, firstWords } = await import('./collapsedMessage');

// A message told to a lead, folded to one line that opens in place to all of it (collapsedMessage.ts).
const brief = '## The plan\n\nFirst,   store the items per user.\n\nThen show them on the page.';
const draw = (open = new Set<string>()) => {
  const el = collapsedMessage({ id: 'a@1', head: 'Told Lt. a · Goal a · 10:00', text: brief, open, part: 'told' });
  const toggle = el.querySelector<HTMLButtonElement>('[data-part=msg-toggle]');
  const body = el.querySelector<HTMLElement>('[data-part=msg-body]');
  if (!toggle || !body) throw new Error('no toggle or body');
  return { el, toggle, body, open };
};

describe('firstWords', () => {
  it('is the first line with words in it, spaces squeezed and a heading’s marks gone', () => {
    expect(firstWords(brief)).toBe('The plan');
    expect(firstWords('\n\n  Ship   it  \nnow')).toBe('Ship it');
    expect(firstWords('')).toBe('');
  });
});

describe('collapsedMessage', () => {
  it('is folded to one line, who told whom and when and its first words, behind a button that says so', () => {
    const { el, toggle, body } = draw();
    expect(el.dataset.part).toBe('told');
    expect(el.dataset.id).toBe('a@1');
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe(body.id);
    expect(toggle.textContent).toContain('Told Lt. a · Goal a · 10:00');
    expect(toggle.textContent).toContain('The plan');
    expect(body.hidden).toBe(true);
  });

  it('opens in place to the whole message when pressed, and folds again, keeping which are open by id', () => {
    const { el, toggle, body, open } = draw();
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(body.hidden).toBe(false);
    expect(body.innerHTML).toContain('Then show them on the page.');
    expect(open.has('a@1')).toBe(true);
    // in place: the same element, not drawn again
    expect(el.contains(toggle)).toBe(true);
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(body.hidden).toBe(true);
    expect(open.has('a@1')).toBe(false);
  });

  it('is drawn open again when its id is open, so a view drawn again keeps it open', () => {
    const { toggle, body } = draw(new Set(['a@1']));
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(body.hidden).toBe(false);
  });
});
