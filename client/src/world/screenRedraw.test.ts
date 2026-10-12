import { describe, expect, it } from 'vitest';
import { BIG_REDRAW_EVERY, BLINK, DISPLAY_EVERY, DRAWS_PER_FRAME, cursorOn, newFrame, REDRAW_EVERY, redrawDue, type ScreenDrawn, takeDraw } from './screenRedraw';

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

  it('draws a big screen that’s changed less often', () => {
    const screen = drawn({ changed: true, at: 1000 });
    expect(redrawDue(screen, 'near', 1000 + REDRAW_EVERY.near, BIG_REDRAW_EVERY)).toBe(false);
    expect(redrawDue(screen, 'near', 1000 + BIG_REDRAW_EVERY.near, BIG_REDRAW_EVERY)).toBe(true);
  });

  it('draws a goal board or sign that’s changed less often still', () => {
    const screen = drawn({ changed: true, at: 1000 });
    expect(redrawDue(screen, 'near', 1000 + BIG_REDRAW_EVERY.near, DISPLAY_EVERY)).toBe(false);
    expect(redrawDue(screen, 'near', 1000 + DISPLAY_EVERY.near, DISPLAY_EVERY)).toBe(true);
    expect(redrawDue(screen, 'unseen', 1000 + DISPLAY_EVERY.far, DISPLAY_EVERY)).toBe(false);
  });
});

describe('takeDraw', () => {
  it('lets a frame draw only so many canvases, and the next frame as many again', () => {
    newFrame();
    for (let i = 0; i < DRAWS_PER_FRAME; i++) expect(takeDraw()).toBe(true);
    expect(takeDraw()).toBe(false);
    newFrame();
    expect(takeDraw()).toBe(true);
  });
});
