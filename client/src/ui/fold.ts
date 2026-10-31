import { h } from './dom';

// Something long folded to a line (and, when it helps, a peek at its start) that opens in place to all of it: a message
// told to a lead in Comms, a step in a session's transcript, its thinking, its output. One primitive, so they all fold
// and open alike, by mouse or keyboard. The views it's in are drawn again as Focus's state streams in, so which are open
// is the view's (`open`, by id): one drawn again opens as it was. Its body is built the first time it opens, so a long
// transcript of folded steps costs only their lines.

let seq = 0;

export interface FoldOptions {
  /** What it's known by in `open`. */
  id: string;
  /** The ids open in the view it's in. */
  open: Set<string>;
  /** Its line: what it is. */
  head: Node | string;
  /** Beside the line while it's folded: its first words, how much more there is. */
  hint?: Node | string;
  /** Under the line while it's folded: a few lines of its start. */
  peek?: Node;
  /** All of it, under the line when open. */
  body: () => Node | string;
  /** Classes for its parts, in the look of the view it's in. */
  classes?: { root?: string; toggle?: string; mark?: string; hint?: string; body?: string };
  /** Its `data-part`, for the view's tests and styles. */
  part?: string;
}

/** A folded thing, open when `open` has its id: a press (or Enter, or Space) on its line opens or folds it in place. */
export function fold(o: FoldOptions): HTMLElement {
  const bodyId = `fold-${++seq}`;
  const c = o.classes ?? {};
  const mark = h('span', { class: c.mark ?? 'fold-mark', attrs: { 'aria-hidden': 'true' } });
  const hint = o.hint === undefined ? null : h('span', { class: c.hint ?? 'fold-hint' }, o.hint);
  const toggle = h('button', { class: c.toggle ?? 'fold-toggle', attrs: { type: 'button', 'aria-controls': bodyId, 'data-part': 'fold-toggle' } }, mark, o.head, hint);
  const body = h('div', { class: c.body ?? 'fold-body', id: bodyId, attrs: { 'data-part': 'fold-body' } });
  let built = false;
  const set = (open: boolean) => {
    if (open && !built) {
      body.append(o.body());
      built = true;
    }
    toggle.setAttribute('aria-expanded', String(open));
    toggle.title = open ? 'Fold it' : 'Show all of it';
    mark.textContent = open ? '▾' : '▸';
    body.hidden = !open;
    if (hint) hint.hidden = open;
    if (o.peek instanceof HTMLElement) o.peek.hidden = open;
  };
  const flip = () => {
    const open = !o.open.has(o.id);
    if (open) o.open.add(o.id);
    else o.open.delete(o.id);
    set(open);
  };
  toggle.onclick = flip;
  // a peek opens it too: it's the start of what's folded
  if (o.peek instanceof HTMLElement) {
    o.peek.classList.add('fold-peek');
    o.peek.onclick = flip;
  }
  set(o.open.has(o.id));
  return h('div', { class: c.root ?? 'fold-root', attrs: { 'data-part': o.part ?? 'fold', 'data-id': o.id } }, toggle, o.peek ?? null, body);
}
