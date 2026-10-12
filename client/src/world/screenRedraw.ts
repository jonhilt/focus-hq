// When a station's screen (screen.ts) is drawn again. Each drawing is a whole canvas sent to the GPU again, mipmaps
// and all (a briefing room's viewscreen is 2400 × 1000), so a screen is drawn only when there's something new to see:
// what it shows has changed, or, close up, its cursor's due to blink (which sends only the cursor's cell).

/** How the captain sees a screen: close enough to read, further off, or not at all (in another part of the ship). */
export type ScreenView = 'near' | 'far' | 'unseen';

/** How often (ms) a screen that's changed is drawn again: often enough to follow close up, now and then from further off. */
export const REDRAW_EVERY: Record<Exclude<ScreenView, 'unseen'>, number> = { near: 120, far: 1500 };
/**
 * A briefing room's viewscreen, less often: sending its 2400 × 1000 canvas holds a frame up for 70 ms on a laptop's
 * integrated GPU, so a lead streaming output at the laptop's pace would stall the room every few frames.
 */
export const BIG_REDRAW_EVERY: Record<Exclude<ScreenView, 'unseen'>, number> = { near: 1000, far: 2000 };
/**
 * A station's sign, goal board, chart and the screen over its pod, and a holodeck's Kanban board (goalScreens.ts,
 * board.ts): they change with every line the crew write (the board's roster shows each one's latest), and each is a
 * canvas of several MB to send, which on a laptop's integrated GPU held a frame up about 7 ms a MB.
 */
export const DISPLAY_EVERY: Record<Exclude<ScreenView, 'unseen'>, number> = { near: 2000, far: 5000 };
/** How long (ms) a busy terminal's cursor stays on, and then off. */
export const BLINK = 500;

/** Whether the cursor is on at `now` (ms). */
export function cursorOn(now: number): boolean {
  return Math.floor(now / BLINK) % 2 === 0;
}

export interface ScreenDrawn {
  /** Whether what it shows has changed since it was last drawn. */
  changed: boolean;
  /** Whether its agent is busy, so its cursor blinks. */
  blinking: boolean;
  /** When it was last drawn (ms). */
  at: number;
  /** Whether its cursor was on when it was. */
  cursor: boolean;
}

/**
 * Whether a screen's due to be drawn again at `now`: once it's changed, as often as its view allows; while its agent's
 * busy, close up, as its cursor blinks. Out of sight it waits, and is drawn as it comes into view.
 */
export function redrawDue(screen: ScreenDrawn, view: ScreenView, now: number, every = REDRAW_EVERY): boolean {
  if (view === 'unseen') return false;
  if (screen.changed) return now - screen.at >= every[view];
  return screen.blinking && view === 'near' && cursorOn(now) !== screen.cursor;
}
