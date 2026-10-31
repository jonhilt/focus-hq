import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { isTextLine } from '../../../shared/stepText';
import { foldSummary, replyPart, saysLine, sentLine } from '../../../shared/termText';
import type { TermEntry, TermLine, TextLine } from '../../../shared/types';
import { h } from './dom';
import { orphanResultEl, sentEl, stepEl, thinkEl } from './steps';
import './steps.css';
import './terminal.css';

/** How many lines (or replies) a terminal keeps before dropping the oldest. */
const KEEP = 3000;

// links in a reply open in a new tab rather than taking the ship with them
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noreferrer');
  }
});

/** Markdown as safe HTML: GitHub's flavour, with single line breaks kept as Claude wrote them. */
export const markdownHtml = (source: string): string => DOMPurify.sanitize(marked.parse(source, { async: false, gfm: true, breaks: true }));

/** A line's classes: its kind, and a manager line that isn't a message sent to the session is a notice about it. */
const lineClass = (line: TextLine): string => (line.kind === 'manager' && !sentLine(line) ? 'manager notice' : line.kind);

/** A run of what the session did between the things it said, folded under the one line that sums it up. */
type Fold = { el: HTMLDetailsElement; summary: HTMLElement; lines: TextLine[] };

/** A call on screen, waiting for (or with) its result, so the result can draw its step again in place. */
type Shown = { call: Extract<TermEntry, { kind: 'call' }>; el: HTMLElement };

/**
 * An agent's terminal, in Pi's look. What the session said (its replies, as markdown, and the messages it was sent) is
 * always in full. What it did is a step at a time (steps.ts): each tool call its own line with a peek at what it changed
 * or gave back, and its thinking a quiet line, each opening in place to all of it. Which are open is the view's
 * (`open`), kept across `clear`, so the panel drawing its whole history again keeps them open. Lines from before steps
 * were typed (and Ops' notices among them) read as they always have: Claude's reply lines joined into one block, the
 * lines in between folded under the one that sums them up.
 */
export class TermView {
  readonly el = h('div', { class: 'terminal' });
  /** The folds open, by id. */
  readonly open = new Set<string>();
  private reply: { el: HTMLElement; source: string } | null = null;
  private fold: Fold | null = null;
  private calls = new Map<string, Shown>();

  append(entries: TermLine[]): void {
    const changed = new Set<{ el: HTMLElement; source: string }>();
    const grown = new Set<Fold>();
    for (const entry of entries) {
      if (isTextLine(entry)) this.line(entry, changed, grown, entry.t);
      else this.step(entry);
    }
    for (const r of changed) r.el.innerHTML = markdownHtml(r.source);
    for (const f of grown) {
      f.summary.textContent = foldSummary(f.lines);
      f.summary.classList.toggle('failed', f.lines.some((l) => l.kind === 'error'));
      while (f.lines.length > KEEP) {
        f.lines.shift();
        f.summary.nextElementSibling?.remove();
      }
    }
    while (this.el.childElementCount > KEEP) this.el.firstElementChild?.remove();
  }

  /** A step: a reply in full, thinking, a call, or the result that draws its call again. */
  private step(entry: Exclude<TermLine, TextLine & { t: number }>): void {
    switch (entry.kind) {
      case 'reply': {
        const el = h('div', { class: `text md${entry.helper ? ' sub' : ''}` });
        el.innerHTML = markdownHtml(entry.text);
        return void this.el.append(el);
      }
      case 'think': {
        const el = thinkEl(entry, `think:${entry.t}:${entry.text.length}`, this.open);
        return void (el && this.el.append(el));
      }
      case 'call': {
        const el = stepEl(entry, undefined, this.open);
        this.calls.set(entry.id, { call: entry, el });
        return void this.el.append(el);
      }
      case 'result': {
        const shown = this.calls.get(entry.id);
        if (!shown || !this.el.contains(shown.el)) return void this.el.append(orphanResultEl(entry, this.open));
        const el = stepEl(shown.call, entry, this.open);
        shown.el.replaceWith(el);
        shown.el = el;
        this.calls.delete(entry.id);
      }
    }
  }

  /** A line of text, as the terminal always drew them. */
  private line(line: TextLine, changed: Set<{ el: HTMLElement; source: string }>, grown: Set<Fold>, t: number): void {
    const part = replyPart(line);
    const last = this.reply && this.el.lastElementChild === this.reply.el ? this.reply : null;
    if (part && (part.start || last)) {
      if (part.start || !last) {
        this.reply = { el: h('div', { class: 'text md' }), source: part.text };
        this.el.append(this.reply.el);
      } else {
        last.source += `\n${part.text}`;
      }
      changed.add(this.reply!);
    } else if (saysLine(line) || (!line.text.trim() && this.el.lastElementChild !== this.fold?.el)) {
      // a blank line doesn't start a fold of its own
      this.el.append(sentLine(line) ? sentEl(line.text, `sent:${t}`, this.open) : h('div', { class: lineClass(line) }, line.text || ' '));
    } else {
      const fold = this.foldFor();
      fold.lines.push(line);
      fold.el.append(h('div', { class: line.kind }, line.text || ' '));
      grown.add(fold);
    }
  }

  /** The fold at the end of the terminal, or a new one when something has been said since. */
  private foldFor(): Fold {
    if (this.fold && this.el.lastElementChild === this.fold.el) return this.fold;
    const summary = h('summary');
    const el = h('details', { class: 'fold' }, summary);
    this.fold = { el, summary, lines: [] };
    this.el.append(el);
    return this.fold;
  }

  clear(): void {
    this.el.replaceChildren();
    this.reply = null;
    this.fold = null;
    this.calls.clear();
  }
}
