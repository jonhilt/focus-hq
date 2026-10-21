import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { replyPart } from '../../../shared/termText';
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

/**
 * An agent's terminal: a line at a time, except Claude's replies, which come back together as one block of rendered
 * markdown. A reply's lines can arrive in more than one batch, so the last reply grows while nothing else has come since.
 */
export class TermView {
  readonly el = h('div', { class: 'terminal' });
  private reply: { el: HTMLElement; source: string } | null = null;

  append(lines: TermLine[]): void {
    const changed = new Set<{ el: HTMLElement; source: string }>();
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
      } else {
        this.el.append(h('div', { class: line.kind }, line.text || ' '));
      }
    }
    for (const r of changed) r.el.innerHTML = markdownHtml(r.source);
    while (this.el.childElementCount > KEEP) this.el.firstElementChild?.remove();
  }

  clear(): void {
    this.el.replaceChildren();
    this.reply = null;
  }
}
