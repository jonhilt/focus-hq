import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { foldSummary, replyPart, saysLine } from '../../../shared/termText';
import type { TermLine } from '../../../shared/types';
import { h } from './dom';
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

/** A run of what the session did between the things it said, folded under the one line that sums it up. */
type Fold = { el: HTMLDetailsElement; summary: HTMLElement; lines: TermLine[] };

/**
 * An agent's terminal: a line at a time, except Claude's replies, which come back together as one block of rendered
 * markdown. A reply's lines can arrive in more than one batch, so the last reply grows while nothing else has come since.
 * What the session said (its replies, the messages it was sent) is always in view; what it did in between (tool calls,
 * their output, thinking, system lines) folds away, closed until you open it, and grows the same way.
 */
export class TermView {
  readonly el = h('div', { class: 'terminal' });
  private reply: { el: HTMLElement; source: string } | null = null;
  private fold: Fold | null = null;

  append(lines: TermLine[]): void {
    const changed = new Set<{ el: HTMLElement; source: string }>();
    const grown = new Set<Fold>();
    for (const line of lines) {
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
        this.el.append(h('div', { class: line.kind }, line.text || ' '));
      } else {
        const fold = this.foldFor();
        fold.lines.push(line);
        fold.el.append(h('div', { class: line.kind }, line.text || ' '));
        grown.add(fold);
      }
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
  }
}
