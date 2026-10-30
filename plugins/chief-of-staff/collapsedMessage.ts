import { h, markdownHtml } from '../../plugin-api/client';

// A message someone told a lead, folded to one quiet line (who told whom, and when, and its first words) that opens in
// place to the whole of it: the direct line's words to a lead (lineView.ts) and what Ops, QA, the chief of staff and
// the scheduler told a lead in its thread (stream.ts) draw it alike. A long brief inline was a wall of text; cut to its
// first line, the rest couldn't be read at all. Which are open is the view's (`open`, by each message's id), so a
// view drawn again as Focus's state streams in keeps them open.

/** A message's first words, for its folded line: its first line that has any, spaces squeezed. */
export function firstWords(text: string): string {
  const first = text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).find(Boolean) ?? '';
  return first.replace(/^#+\s*/, '');
}

let seq = 0;

/** The message folded, or open when `open` has its id: a press (or Enter, or Space) on its line opens or folds it in place. */
export function collapsedMessage(m: { id: string; head: string; text: string; open: Set<string>; part: string }): HTMLElement {
  const bodyId = `cos-msg-${++seq}`;
  const hint = h('span', { class: 'tw:min-w-0 tw:truncate tw:text-muted' }, firstWords(m.text));
  const mark = h('span', { class: 'tw:flex-none tw:w-3 tw:text-label', attrs: { 'aria-hidden': 'true' } });
  const toggle = h('button', {
    class: 'tw:flex tw:items-baseline tw:gap-2 tw:w-full tw:min-w-0 tw:text-left tw:bg-transparent tw:border-0 tw:p-0 tw:text-[13px] tw:text-muted tw:font-read tw:cursor-pointer tw:hover:text-ink',
    attrs: { type: 'button', 'aria-controls': bodyId, 'data-part': 'msg-toggle' },
  }, mark, h('span', { class: 'tw:flex-none tw:max-w-[85%] tw:truncate' }, m.head), hint);
  const body = h('div', { class: 'cos-md tw:mt-2 tw:text-[14px]/[1.6] tw:text-ink', id: bodyId, attrs: { 'data-part': 'msg-body' } });
  body.innerHTML = markdownHtml(m.text);
  const set = (open: boolean) => {
    toggle.setAttribute('aria-expanded', String(open));
    toggle.title = open ? 'Fold it to one line' : 'Read the whole message';
    mark.textContent = open ? '▾' : '▸';
    body.hidden = !open;
    hint.hidden = open;
  };
  toggle.onclick = () => {
    const open = !m.open.has(m.id);
    if (open) m.open.add(m.id);
    else m.open.delete(m.id);
    set(open);
  };
  set(m.open.has(m.id));
  return h('div', { class: 'tw:pl-3 tw:border-0 tw:border-l-2 tw:border-solid tw:border-line', attrs: { 'data-part': m.part, 'data-id': m.id } }, toggle, body);
}
