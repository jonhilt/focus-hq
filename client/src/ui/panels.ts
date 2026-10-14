import { h } from './dom';

/** A panel's views, down its sidebar: Alt+1… picks them by number. */
export interface PanelNav {
  el: HTMLElement;
  /** Picks the view numbered `n` (from 1), unless it's on standby. */
  pick(n: number): void;
}

export interface PanelOptions {
  title: string | Node;
  body: HTMLElement;
  accent?: string;
  wide?: boolean;
  /** Fills the window, for what wants every pixel (a lead's screen up close). */
  full?: boolean;
  /** The panel's views: the sidebar widens to hold their buttons. */
  nav?: PanelNav;
  footer?: HTMLElement;
  /** Buttons on the header bar, before the title. */
  headerExtra?: Node[];
  /** Docked down the right with the world left uncovered (the studio's chat, to watch the takes while you talk). */
  docked?: boolean;
}

/**
 * Hosts one modal panel at a time, in an LCARS frame: an elbow joins the sidebar to the header bar (title at its right
 * end, then CLOSE), and a second one joins it to the bar along the bottom. Opening a panel releases the mouse; closing
 * it grabs it again.
 */
export class Panels {
  private overlay: HTMLDivElement | null = null;
  private nav: PanelNav | undefined;
  private cleanups: (() => void)[] = [];
  onOpen: () => void = () => undefined;
  onClose: () => void = () => undefined;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (!this.overlay) return;
      // Escape leaves full screen first; the panel stays open behind it
      if (e.key === 'Escape' && document.fullscreenElement) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
      // e.code, since Alt+digit types a symbol on a Mac
      const digit = /^Digit([1-9])$/.exec(e.code);
      if (digit && e.altKey && this.nav) {
        e.preventDefault();
        this.nav.pick(Number(digit[1]));
      }
    });
  }

  get isOpen(): boolean {
    return this.overlay !== null;
  }

  /** Whether the open panel is docked, leaving the world in view (the studio's chat). */
  get docked(): boolean {
    return this.overlay?.classList.contains('docked') ?? false;
  }

  open(opts: PanelOptions): void {
    this.close(false);
    const title = typeof opts.title === 'string' ? h('h2', null, opts.title) : opts.title;
    const panel = h(
      'div',
      { class: `panel${opts.wide ? ' wide' : ''}${opts.full ? ' full' : ''}${opts.docked ? ' docked' : ''}${opts.nav ? ' has-nav' : ''}`, style: opts.accent ? `--accent:${opts.accent}` : undefined },
      h('div', { class: 'panel-elbow' }),
      h('div', { class: 'panel-head' },
        ...(opts.headerExtra ?? []),
        h('span', { class: 'panel-bar' }),
        title,
        h('button', { class: 'panel-close', title: 'Close (Esc)', onclick: () => this.close() }, 'Close'),
      ),
      opts.nav ? h('div', { class: 'panel-nav' }, opts.nav.el) : null,
      h('div', { class: 'panel-side' }),
      h('div', { class: 'panel-body' }, opts.body),
      opts.footer ? h('div', { class: 'panel-foot' }, opts.footer) : null,
      h('div', { class: 'panel-base' }),
    );
    const overlay = h('div', { class: `overlay${opts.docked ? ' docked' : ''}` }, panel);
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) this.close();
    });
    document.body.append(overlay);
    this.overlay = overlay;
    this.nav = opts.nav;
    this.onOpen();
    const focusable = panel.querySelector<HTMLElement>('[autofocus]');
    focusable?.focus();
  }

  /**
   * Registers something to undo when the current panel closes (e.g. a state subscription). Call it once `open` has run:
   * until then, the current panel is the one being replaced, and opening the new one undoes it straight away.
   */
  own(cleanup: () => void): void {
    this.cleanups.push(cleanup);
  }

  close(notify = true): void {
    if (!this.overlay) return;
    for (const fn of this.cleanups.splice(0)) fn();
    this.overlay.remove();
    this.overlay = null;
    this.nav = undefined;
    if (notify) this.onClose();
  }
}

/** One of a panel's views, as its sidebar button shows it. */
export interface NavItem<K extends string> {
  key: K;
  label: string;
  /** A short live readout on the button: a count, a fraction, LIVE. */
  readout?: string;
  /** Nothing to show there right now: dimmed, and can't be picked. */
  standby?: boolean;
}

/**
 * An LCARS sidebar's buttons, one per view: numbered (the number is its Alt shortcut), the picked one lit. `show` updates
 * the buttons in place, so a re-render doesn't take focus off the one you're on.
 */
export class SideNav<K extends string> implements PanelNav {
  readonly el = h('div', { class: 'side-nav', attrs: { role: 'tablist', 'aria-orientation': 'vertical' } });
  private items: readonly NavItem<K>[] = [];
  private picked: K | undefined;
  private buttons = new Map<K, HTMLButtonElement>();

  constructor(private readonly onPick: (key: K) => void) {}

  show(items: readonly NavItem<K>[], picked: K | undefined): void {
    this.items = items;
    this.picked = picked;
    const keep = new Set(items.map((i) => i.key));
    for (const [key, button] of this.buttons) {
      if (keep.has(key)) continue;
      button.remove();
      this.buttons.delete(key);
    }
    items.forEach((item, i) => {
      const button = this.buttons.get(item.key) ?? this.button(item.key);
      const on = item.key === picked;
      button.className = `nav-btn${on ? ' on' : ''}${item.standby ? ' standby' : ''}`;
      button.disabled = !!item.standby;
      button.setAttribute('aria-selected', String(on));
      button.title = `${item.label} (Alt+${i + 1})`;
      button.replaceChildren(
        h('span', { class: 'nav-num' }, String(i + 1).padStart(2, '0')),
        h('span', { class: 'nav-readout' }, item.readout ?? ''),
        h('span', { class: 'nav-label' }, item.label),
      );
      // in item order, moving only what's out of place: moving a focused button blurs it
      if (this.el.children[i] !== button) this.el.insertBefore(button, this.el.children[i] ?? null);
    });
  }

  pick(n: number): void {
    const item = this.items[n - 1];
    if (item && !item.standby) this.choose(item.key);
  }

  private choose(key: K): void {
    // another view starts at its top, not wherever the last one was scrolled to
    if (key !== this.picked) this.el.closest('.panel')?.querySelector('.panel-body')?.scrollTo(0, 0);
    this.onPick(key);
  }

  private button(key: K): HTMLButtonElement {
    const button = h('button', { attrs: { role: 'tab' }, onclick: () => this.choose(key) });
    this.buttons.set(key, button);
    return button;
  }
}

/** An LCARS readout: a small label over its value, in the cool colour LCARS keeps for data unless `tone` says otherwise. */
export function readout(label: string, value: Node | string, opts: { tone?: string; title?: string; grow?: boolean } = {}): HTMLElement {
  return h('div', { class: `readout${opts.grow ? ' grow' : ''}`, title: opts.title },
    h('small', null, label),
    h('b', { style: opts.tone ? `color:${opts.tone}` : undefined }, value),
  );
}

/** An LCARS switch in place of a checkbox: a pill that's lit while it's on, and says which. */
export class Switch {
  readonly el: HTMLButtonElement;
  private readonly reading = h('span');
  private state = false;

  constructor(label: string, on: boolean, opts: { title?: string; changed?: (on: boolean) => void } = {}) {
    this.el = h('button', { class: 'btn small switch', type: 'button', title: opts.title }, label, this.reading);
    this.el.onclick = () => {
      this.on = !this.on;
      opts.changed?.(this.on);
    };
    this.on = on;
  }

  get on(): boolean {
    return this.state;
  }

  set on(on: boolean) {
    this.state = on;
    this.el.classList.toggle('on', on);
    this.el.setAttribute('aria-pressed', String(on));
    this.reading.textContent = on ? 'On' : 'Off';
  }
}

/** The view to show: the one picked, while it has something to show; otherwise the first that does. */
export function shownView<K extends string>(items: readonly NavItem<K>[], picked: K | undefined): K | undefined {
  const live = items.filter((i) => !i.standby);
  return (live.find((i) => i.key === picked) ?? live[0])?.key;
}
