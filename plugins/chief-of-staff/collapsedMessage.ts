import { fold, h, markdownHtml } from '../../plugin-api/client';

// A message someone told a lead, folded to one quiet line (who told whom, and when, and its first words) that opens in
// place to the whole of it: the direct line's words to a lead (lineView.ts) and what Ops, QA, the chief of staff and
// the scheduler told a lead in its thread (stream.ts) draw it alike. A long brief inline was a wall of text; cut to its
// first line, the rest couldn't be read at all. It's Focus's fold (the session pane's steps fold the same way), in the
// thread's look. Which are open is the view's (`open`, by each message's id), so a view drawn again as Focus's state
// streams in keeps them open.

/** A message's first words, for its folded line: its first line that has any, spaces squeezed. */
export function firstWords(text: string): string {
  const first = text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).find(Boolean) ?? '';
  return first.replace(/^#+\s*/, '');
}

/** The message folded, or open when `open` has its id: a press (or Enter, or Space) on its line opens or folds it in place. */
export function collapsedMessage(m: { id: string; head: string; text: string; open: Set<string>; part: string }): HTMLElement {
  return fold({
    id: m.id,
    open: m.open,
    head: h('span', { class: 'tw:flex-none tw:max-w-[85%] tw:truncate' }, m.head),
    hint: firstWords(m.text),
    body: () => {
      const body = h('div');
      body.innerHTML = markdownHtml(m.text);
      return body;
    },
    classes: {
      root: 'tw:pl-3 tw:border-0 tw:border-l-2 tw:border-solid tw:border-line',
      toggle: 'tw:flex tw:items-baseline tw:gap-2 tw:w-full tw:min-w-0 tw:text-left tw:bg-transparent tw:border-0 tw:p-0 tw:text-[13px] tw:text-muted tw:font-read tw:cursor-pointer tw:hover:text-ink',
      mark: 'tw:flex-none tw:w-3 tw:text-label',
      hint: 'tw:min-w-0 tw:truncate tw:text-muted',
      body: 'cos-md tw:mt-2 tw:text-[14px]/[1.6] tw:text-ink',
    },
    part: m.part,
  });
}
