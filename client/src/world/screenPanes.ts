// What a station's screen shows side by side, and which of it each viewer wants. Pure (no Three.js, no DOM) apart
// from the preferences' localStorage, so the layout is testable outside the browser.

import { openQuestion } from '../../../shared/artifacts';
import type { Agent } from '../../../shared/types';
import type { Interaction } from './builder';

export type Pane = 'terminal' | 'browser' | 'artifact' | 'progress';

/** What a viewer has switched on: the agent's browser, a lead's artifacts, Claude's own task list, and a lead's goal note. */
export interface PanePrefs {
  browser: boolean;
  artifacts: boolean;
  tasks: boolean;
  note: boolean;
}

/** A screen at least this many pixels wide fits all three columns; a smaller one fits two at most. */
export const WIDE_SCREEN = 1000;
/** A screen at least this wide, like a briefing room's viewscreen, puts a lead's artifact and browser side by side. */
export const VIEWSCREEN = 1600;
/** How much of the middle column a lead's artifact takes when their browser shares it: the browser has the rest. */
const ARTIFACT_SHARE = 0.58;

/** Where a pane is on the screen, in its layout's pixels, from the top left of the panes' area. */
export interface PaneAt {
  pane: Pane;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The panes a screen `width` × `height` pixels shows, in columns left to right: the terminal always, then what the
 * agent has to show (a lead's artifact, which they put up for the captain on purpose, over the page their browser has
 * up when there are both, or beside it on a viewscreen), and the progress column (the agent's task list, a lead's
 * goal note) while there's any. A small screen fits two columns: what there is to show wins. An artifact gets the
 * most room.
 */
export function screenPanes(width: number, height: number, has: { browser: boolean; artifact?: boolean; progress: boolean }): PaneAt[] {
  const shown = has.artifact || has.browser;
  const progress = has.progress && (!shown || width >= WIDE_SCREEN);
  const big = !!has.artifact;
  const side = has.artifact && has.browser && width >= VIEWSCREEN;
  const shares: [Pane | 'shown', number][] = side
    ? progress
      ? [['terminal', 0.24], ['artifact', 0.31], ['browser', 0.27], ['progress', 0.18]]
      : [['terminal', 0.3], ['artifact', 0.38], ['browser', 0.32]]
    : shown && progress
    ? [['terminal', big ? 0.3 : 0.4], ['shown', big ? 0.45 : 0.35], ['progress', 0.25]]
    : shown
      ? [['terminal', big ? 0.4 : 0.5], ['shown', big ? 0.6 : 0.5]]
      : progress
        ? [['terminal', 0.66], ['progress', 0.34]]
        : [['terminal', 1]];
  let x = 0;
  return shares.flatMap(([column, share], i): PaneAt[] => {
    const w = i === shares.length - 1 ? width - x : Math.round(width * share);
    const at = x;
    x += w;
    if (column !== 'shown') return [{ pane: column, x: at, y: 0, w, h: height }];
    if (!has.artifact) return [{ pane: 'browser', x: at, y: 0, w, h: height }];
    if (!has.browser) return [{ pane: 'artifact', x: at, y: 0, w, h: height }];
    const top = Math.round(height * ARTIFACT_SHARE);
    return [{ pane: 'artifact', x: at, y: 0, w, h: top }, { pane: 'browser', x: at, y: top, w, h: height - top }];
  });
}

/** Which pane (as `screenPanes` laid them out) a point on the screen is on, if any. */
export function paneAt(panes: readonly PaneAt[], x: number, y: number): Pane | undefined {
  return panes.find((p) => x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h)?.pane;
}

/**
 * What using a pane of a lead's big screen does, and what aiming at it says: the artifacts pane opens what they've
 * shown or asked up close, and the rest open their panel on that view (the terminal on whatever it was on).
 */
export function paneUse(pane: Pane, lead: Agent): { interaction: Interaction; label: () => string } {
  const { id, name } = lead;
  switch (pane) {
    case 'artifact':
      return { interaction: { kind: 'screen', id }, label: () => (openQuestion(lead) ? `Answer ${name}’s question` : `Look at what ${name} has shown up close`) };
    case 'browser':
      return { interaction: { kind: 'agent', id, view: 'browser' }, label: () => `Look at ${name}’s browser up close` };
    case 'progress':
      return lead.lead?.note
        ? { interaction: { kind: 'agent', id, view: 'goal' }, label: () => `Look at ${name}’s goal and to-dos` }
        : { interaction: { kind: 'agent', id, view: 'tasks' }, label: () => `Look at ${name}’s tasks` };
    case 'terminal':
      return { interaction: { kind: 'agent', id }, label: () => `Look at ${name}’s session up close` };
  }
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
