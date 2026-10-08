import { h } from './dom';

export interface ConfirmOptions {
  title?: string;
  /** What's being asked; line breaks are kept. */
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** The action can't be taken back: the confirm button is red, and Enter cancels rather than confirms. */
  danger?: boolean;
}

/**
 * The ship's own confirm dialog, in an LCARS frame: resolves true on confirm, false on cancel, Escape or a click outside it.
 * It sits above any open panel without replacing it, and keeps every key (Escape included) from the panel and the
 * office underneath while it's up.
 */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return chooseDialog(opts).then((choice) => choice === 'confirm');
}

/**
 * The confirm dialog with a second way forward (`altLabel`), between cancel and confirm: resolves to which was picked,
 * 'cancel' for Escape or a click outside it.
 */
export function chooseDialog(opts: ConfirmOptions & { altLabel?: string }): Promise<'confirm' | 'alt' | 'cancel'> {
  return new Promise((resolve) => {
    const ok = h('button', { class: `btn ${opts.danger ? 'danger' : 'primary'}`, type: 'button' }, opts.confirmLabel ?? 'Confirm');
    const alt = opts.altLabel ? h('button', { class: 'btn', type: 'button' }, opts.altLabel) : null;
    const cancel = h('button', { class: 'btn', type: 'button' }, opts.cancelLabel ?? 'Cancel');
    const dialog = h('div', { class: 'dialog', attrs: { role: 'alertdialog', 'aria-modal': 'true' } },
      h('div', { class: 'dialog-head' }, h('span', { class: 'dialog-bar' }), h('h2', null, opts.title ?? 'Confirm')),
      h('p', { class: 'dialog-message' }, opts.message),
      h('div', { class: 'dialog-foot' }, cancel, alt, ok),
    );
    const overlay = h('div', { class: 'dialog-overlay' }, dialog);
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const done = (answer: 'confirm' | 'alt' | 'cancel') => {
      window.removeEventListener('keydown', onKey, true);
      overlay.remove();
      before?.focus();
      resolve(answer);
    };
    // capturing on window runs before anything else hears the key, the panel's Escape included
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        done('cancel');
      }
    };
    window.addEventListener('keydown', onKey, true);
    overlay.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      if (e.target === overlay) done('cancel');
    });
    ok.onclick = () => done('confirm');
    if (alt) alt.onclick = () => done('alt');
    cancel.onclick = () => done('cancel');

    document.body.append(overlay);
    (opts.danger ? cancel : ok).focus();
  });
}
