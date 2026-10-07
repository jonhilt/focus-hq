// What a station's screen shows side by side, and which of it each viewer wants. Pure (no Three.js, no DOM) apart
// from the preferences' localStorage, so the layout is testable outside the browser.

export type Pane = 'terminal' | 'browser' | 'artifact' | 'progress';

/** What a viewer has switched on: the agent's browser, a lead's artifacts, Claude's own task list, and a lead's goal note. */
export interface PanePrefs {
  browser: boolean;
  artifacts: boolean;
  tasks: boolean;
  note: boolean;
}

/** A screen at least this many pixels wide fits all three panes; a smaller one fits two at most. */
export const WIDE_SCREEN = 1000;

/**
 * The panes a screen `width` pixels wide shows, left to right: the terminal always, then what the agent has to show
 * (a lead's artifact, which they put up for the captain on purpose, wins over the page their browser has up), and the
 * progress pane (the agent's task list, a lead's goal note) while there's any. A small screen fits two: what there is
 * to show wins. An artifact gets the most room.
 */
export function screenPanes(width: number, has: { browser: boolean; artifact?: boolean; progress: boolean }): { pane: Pane; x: number; w: number }[] {
  const shown: Pane | undefined = has.artifact ? 'artifact' : has.browser ? 'browser' : undefined;
  const progress = has.progress && (!shown || width >= WIDE_SCREEN);
  const big = shown === 'artifact';
  const shares: [Pane, number][] = shown && progress
    ? [['terminal', big ? 0.3 : 0.4], [shown, big ? 0.45 : 0.35], ['progress', 0.25]]
    : shown
      ? [['terminal', big ? 0.4 : 0.5], [shown, big ? 0.6 : 0.5]]
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
const DEFAULTS: PanePrefs = { browser: true, artifacts: true, tasks: true, note: true };

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
