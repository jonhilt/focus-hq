import type { PanePrefs } from './screenPanes';

// The strip of switches on the dado under a briefing room's viewscreen, to starboard: which panes every station
// screen (and the laptops at desks) shows beside the terminal, which always shows. The choice is this viewer's
// (screenPrefs), so every station's strip shows the same. Pure, so it's testable outside the browser: PaneSwitches
// (paneSwitchPanel.ts) draws it.

/** A switch on the strip: one of the viewer's panes. */
export interface PaneSwitch {
  pane: keyof PanePrefs;
  label: string;
  /** What it shows, for its hover label: "Hide the browser pane". */
  what: string;
}

export const PANE_SWITCHES: readonly PaneSwitch[] = [
  { pane: 'artifacts', label: 'Artifacts', what: 'artifacts pane' },
  { pane: 'browser', label: 'Browser', what: 'browser pane' },
  { pane: 'note', label: 'Goal', what: 'goal pane' },
  { pane: 'tasks', label: 'Tasks', what: 'tasks pane' },
];

export const W = 1600;
export const H = 200;
/** The margin round the strip, where the switches start after its LCARS label, and how wide each one's column is. */
export const PAD = 20;
export const LEFT = 330;
export const COL = (W - PAD - LEFT) / PANE_SWITCHES.length;
/** The gap after each switch, which is no switch. */
export const GAP = 20;

/** Which switch (index into PANE_SWITCHES) a point on the strip is on, from its texture coordinates. */
export function switchAt(uv: { x: number; y: number }): number | undefined {
  const [x, y] = [uv.x * W, (1 - uv.y) * H];
  if (x < LEFT || x >= W - PAD || y < PAD || y >= H - PAD) return undefined;
  const i = Math.floor((x - LEFT) / COL);
  return i < PANE_SWITCHES.length && x - LEFT - i * COL < COL - GAP ? i : undefined;
}

/** What aiming at a switch says: what pressing E on it does. */
export const switchLabel = (s: PaneSwitch, prefs: PanePrefs): string => `${prefs[s.pane] ? 'Hide' : 'Show'} the ${s.what}`;
