// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chooseDialog, confirmDialog } from './confirmDialog';

const dialog = () => document.querySelector<HTMLElement>('.dialog-overlay');
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.dialog button')].find((b) => b.textContent === label)!;

describe('confirmDialog', () => {
  afterEach(() => document.body.replaceChildren());

  it('resolves true on confirm and false on cancel, and goes away', async () => {
    const yes = confirmDialog({ message: 'Merge it?', confirmLabel: 'Merge' });
    button('Merge').click();
    expect(await yes).toBe(true);
    expect(dialog()).toBeNull();

    const no = confirmDialog({ message: 'Merge it?' });
    button('Cancel').click();
    expect(await no).toBe(false);
  });

  it('keeps each line of the message', () => {
    void confirmDialog({ message: 'Close “Wishlist”?\n\nOne\nTwo' });
    const message = document.querySelector('.dialog-message')!;
    expect(message.textContent).toBe('Close “Wishlist”?\n\nOne\nTwo');
  });

  it('cancels on Escape without the panel underneath hearing it', async () => {
    const panelHeard = vi.fn();
    window.addEventListener('keydown', panelHeard);
    const answer = confirmDialog({ message: 'Send them home?', danger: true });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(await answer).toBe(false);
    expect(panelHeard).not.toHaveBeenCalled();
    window.removeEventListener('keydown', panelHeard);
  });

  it('cancels on a click on its backdrop, not on the dialog itself', async () => {
    const answer = confirmDialog({ message: 'Close the project?' });
    document.querySelector('.dialog')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(dialog()).not.toBeNull();
    dialog()!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(await answer).toBe(false);
  });

  it('offers a second way forward, between cancel and confirm', async () => {
    const pick = (label: string) => {
      const choice = chooseDialog({ message: 'Carry on?', confirmLabel: 'Now', altLabel: 'Later' });
      expect([...document.querySelectorAll('.dialog-foot button')].map((b) => b.textContent)).toEqual(['Cancel', 'Later', 'Now']);
      button(label).click();
      return choice;
    };
    expect(await pick('Later')).toBe('alt');
    expect(await pick('Now')).toBe('confirm');
    expect(await pick('Cancel')).toBe('cancel');
  });

  it('puts focus on Cancel when the action is dangerous, otherwise on confirm', () => {
    void confirmDialog({ message: 'Close it?', confirmLabel: 'Close', danger: true });
    expect(document.activeElement).toBe(button('Cancel'));
    document.body.replaceChildren();
    void confirmDialog({ message: 'Replace it?', confirmLabel: 'Replace' });
    expect(document.activeElement).toBe(button('Replace'));
  });
});
