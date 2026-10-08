import type { PanePrefs } from './screenPanes';

// The switches beside a briefing room's big screen, to starboard of it: which panes every station screen (and the
// laptops at desks) shows beside the terminal. The choice is this viewer's (screenPrefs), so every station's panel
// shows the same. Pure, so it's testable outside the browser: PaneSwitches (paneSwitchPanel.ts) draws it.

/** A switch on the panel: the terminal's, which stays on, or one of the viewer's panes. */
export interface PaneSwitch {
  pane: keyof PanePrefs | 'terminal';
  label: string;
  /** What it shows, for its hover label: "Hide the browser pane". */
  what: string;
}

export const PANE_SWITCHES: readonly PaneSwitch[] = [
  { pane: 'terminal', label: 'Terminal', what: 'terminal' },
  { pane: 'artifacts', label: 'Artifacts', what: 'artifacts pane' },
  { pane: 'browser', label: 'Browser', what: 'browser pane' },
  { pane: 'note', label: 'Goal', what: 'goal pane' },
  { pane: 'tasks', label: 'Tasks', what: 'tasks pane' },
];

export const W = 800;
export const H = 960;
/** The header bar's height, and where the switches start and how tall each one's row is (canvas pixels). */
export const HEADER = 150;
export const TOP = 190;
export const ROW = 150;
export const PAD = 40;

/** Which switch (index into PANE_SWITCHES) a point on the panel is on, from its texture coordinates. */
export function switchAt(uv: { x: number; y: number }): number | undefined {
  const [x, y] = [uv.x * W, (1 - uv.y) * H];
  if (x < PAD || x >= W - PAD || y < TOP) return undefined;
  const i = Math.floor((y - TOP) / ROW);
  // the gap under each switch is no switch
  return i < PANE_SWITCHES.length && y - TOP - i * ROW < ROW - 20 ? i : undefined;
}

/** Whether a switch is on: the terminal always is. */
export const switchOn = (s: PaneSwitch, prefs: PanePrefs): boolean => s.pane === 'terminal' || prefs[s.pane];

/** What aiming at a switch says: what pressing E on it does. */
export function switchLabel(s: PaneSwitch, prefs: PanePrefs): string {
  if (s.pane === 'terminal') return 'The terminal always shows';
  return `${prefs[s.pane] ? 'Hide' : 'Show'} the ${s.what}`;
}
