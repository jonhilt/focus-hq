import { h } from './dom';

export interface PanelOptions {
  title: string | Node;
  body: HTMLElement;
  accent?: string;
  wide?: boolean;
  tabs?: HTMLElement;
  footer?: HTMLElement;
  headerExtra?: Node[];
}

/** Hosts one modal panel at a time. Opening a panel releases the mouse; closing it grabs it again. */
export class Panels {
  private overlay: HTMLDivElement | null = null;
  private cleanups: (() => void)[] = [];
  onOpen: () => void = () => undefined;
  onClose: () => void = () => undefined;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.overlay) {
        e.preventDefault();
        this.close();
      }
    });
  }

  get isOpen(): boolean {
    return this.overlay !== null;
  }

  open(opts: PanelOptions): void {
    this.close(false);
    const panel = h(
      'div',
      { class: `panel${opts.wide ? ' wide' : ''}`, style: opts.accent ? `--accent:${opts.accent}` : undefined },
      h('div', { class: 'panel-head' }, typeof opts.title === 'string' ? h('h2', null, opts.title) : opts.title, ...(opts.headerExtra ?? []), h('button', { class: 'btn close', title: 'Close (Esc)', onclick: () => this.close() }, '✕')),
      opts.tabs ?? null,
      h('div', { class: 'panel-body' }, opts.body),
      opts.footer ?? null,
    );
    const overlay = h('div', { class: 'overlay' }, panel);
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) this.close();
    });
    document.body.append(overlay);
    this.overlay = overlay;
    this.onOpen();
    const focusable = panel.querySelector<HTMLElement>('[autofocus]');
    focusable?.focus();
  }

  /** Registers something to undo when the current panel closes (e.g. a state subscription). */
  own(cleanup: () => void): void {
    this.cleanups.push(cleanup);
  }

  close(notify = true): void {
    if (!this.overlay) return;
    for (const fn of this.cleanups.splice(0)) fn();
    this.overlay.remove();
    this.overlay = null;
    if (notify) this.onClose();
  }
}
