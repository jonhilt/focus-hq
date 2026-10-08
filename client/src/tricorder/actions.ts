import { confirmDialog } from '../ui/confirmDialog';
import { h } from '../ui/dom';

/**
 * The Tricorder's API buttons. Screens re-render whenever the office changes, so a call's in-flight state and its error
 * live here by key rather than on the button: a re-render mid-call keeps the button disabled and the error in view.
 * Keys are `<scope>:<verb>`, so `errors(scope)` shows everything that went wrong on one card.
 */
export class Actions {
  private readonly busy = new Set<string>();
  private readonly failed = new Map<string, string>();

  constructor(private readonly changed: () => void) {}

  button(key: string, label: string, run: () => Promise<unknown>, opts: { class?: string; disabled?: boolean; confirm?: string } = {}): HTMLButtonElement {
    const pending = this.busy.has(key);
    const button = h('button', { class: `btn ${opts.class ?? ''}`, type: 'button', disabled: pending || !!opts.disabled, attrs: { 'data-action': key } }, pending ? '…' : label);
    button.onclick = async (e) => {
      e.stopPropagation();
      if (opts.confirm && !await confirmDialog({ message: opts.confirm })) return;
      void this.run(key, run);
    };
    return button;
  }

  pending(key: string): boolean {
    return this.busy.has(key);
  }

  /** Resolves to whether the call succeeded. */
  async run(key: string, run: () => Promise<unknown>): Promise<boolean> {
    if (this.busy.has(key)) return false;
    this.busy.add(key);
    this.failed.delete(key);
    this.changed();
    try {
      await run();
      return true;
    } catch (err) {
      this.failed.set(key, err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      this.busy.delete(key);
      this.changed();
    }
  }

  /** The errors of the scope's actions; tap to dismiss. */
  errors(scope: string): HTMLElement | null {
    const keys = [...this.failed.keys()].filter((k) => k.startsWith(`${scope}:`));
    if (!keys.length) return null;
    return h('div', { class: 'error-text', role: 'alert', onclick: () => {
      for (const k of keys) this.failed.delete(k);
      this.changed();
    } }, ...keys.map((k) => h('div', null, `⚠ ${this.failed.get(k)}`)));
  }
}

/**
 * Brings `target`'s children in line with `next`'s, keeping every node that hasn't changed. Live updates arrive several
 * times a second; rebuilding the whole screen would swap buttons out from under a finger mid-tap.
 */
export function morph(target: Element, next: Element): void {
  const before = [...target.childNodes];
  const after = [...next.childNodes];
  if (before.length !== after.length) return target.replaceChildren(...after);
  after.forEach((node, i) => {
    const old = before[i];
    if (old.isEqualNode(node)) return;
    if (old instanceof Element && node instanceof Element && old.cloneNode(false).isEqualNode(node.cloneNode(false))) morph(old, node);
    else old.replaceWith(node);
  });
}
