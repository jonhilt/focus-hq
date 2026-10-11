import { describe, expect, it } from 'vitest';
import { BLINK, cursorOn, REDRAW_EVERY, redrawDue, type ScreenDrawn } from './screenRedraw';

const drawn = (over: Partial<ScreenDrawn> = {}): ScreenDrawn => ({ changed: false, blinking: false, at: 0, cursor: true, ...over });

describe('redrawDue', () => {
  it('draws a changed screen as often as its view allows', () => {
    const screen = drawn({ changed: true, at: 1000 });
    expect(redrawDue(screen, 'near', 1000 + REDRAW_EVERY.near - 1)).toBe(false);
    expect(redrawDue(screen, 'near', 1000 + REDRAW_EVERY.near)).toBe(true);
    expect(redrawDue(screen, 'far', 1000 + REDRAW_EVERY.near)).toBe(false);
    expect(redrawDue(screen, 'far', 1000 + REDRAW_EVERY.far)).toBe(true);
  });

  it('leaves a screen out of sight until it comes into view, however much it has changed', () => {
    expect(redrawDue(drawn({ changed: true, blinking: true }), 'unseen', 60_000)).toBe(false);
  });

  it('blinks a busy screen’s cursor close up, drawing it only when the cursor turns on or off', () => {
    const at = 4 * BLINK + 10;
    const screen = drawn({ blinking: true, at, cursor: cursorOn(at) });
    expect(redrawDue(screen, 'near', at + REDRAW_EVERY.near)).toBe(false);
    expect(redrawDue(screen, 'near', 5 * BLINK)).toBe(true);
  });

  it('doesn’t blink from further off, nor for an agent who’s finished', () => {
    const at = 4 * BLINK;
    expect(redrawDue(drawn({ blinking: true, at, cursor: cursorOn(at) }), 'far', 5 * BLINK)).toBe(false);
    expect(redrawDue(drawn({ blinking: false, at, cursor: cursorOn(at) }), 'near', 5 * BLINK)).toBe(false);
  });
});
