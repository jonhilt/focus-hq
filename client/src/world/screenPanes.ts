// What a station's screen shows side by side, and which of it each viewer wants. Pure (no Three.js, no DOM) apart
// from the preferences' localStorage, so the layout is testable outside the browser.

export type Pane = 'terminal' | 'browser' | 'progress';

/** What a viewer has switched on: the agent's browser, Claude's own task list, and a lead's goal note. */
export interface PanePrefs {
  browser: boolean;
  tasks: boolean;
  note: boolean;
}

/** A screen at least this many pixels wide fits all three panes; a smaller one fits two at most. */
export const WIDE_SCREEN = 1000;

/**
 * The panes a screen `width` pixels wide shows, left to right: the terminal always, the browser while there's a page
 * to show, and the progress pane (the agent's task list, a lead's goal note) while there's any. A small screen fits
 * two: the browser wins while it's showing.
 */
export function screenPanes(width: number, has: { browser: boolean; progress: boolean }): { pane: Pane; x: number; w: number }[] {
  const progress = has.progress && (!has.browser || width >= WIDE_SCREEN);
  const shares: [Pane, number][] = has.browser && progress
    ? [['terminal', 0.4], ['browser', 0.35], ['progress', 0.25]]
    : has.browser
      ? [['terminal', 0.5], ['browser', 0.5]]
      : progress
        ? [['terminal', 0.66], ['progress', 0.34]]
        : [['terminal', 1]];
  let x = 0;
  return shares.map(([pane, share], i) => {
    const w = i === shares.length - 1 ? width - x : Math.round(width * share);
    const at = { pane, x, w };
    x += w;
    return at;
  });
}

const KEY = 'focus.screenPanes';
const DEFAULTS: PanePrefs = { browser: true, tasks: true, note: true };

function load(): PanePrefs {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<PanePrefs>;
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

/** This viewer's choice of panes, kept in their browser. `version` moves on each change, so screens know to redraw. */
export const screenPrefs = {
  current: load(),
  version: 0,
  set(pane: keyof PanePrefs, on: boolean): void {
    this.current = { ...this.current, [pane]: on };
    this.version++;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.current));
    } catch {
      // private window or blocked storage: the choice lasts until the page reloads
    }
  },
};
