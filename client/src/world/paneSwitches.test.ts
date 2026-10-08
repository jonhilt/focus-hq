import { describe, expect, it } from 'vitest';
import { COL, GAP, H, LEFT, PANE_SWITCHES, switchAt, switchLabel, W } from './paneSwitches';

const prefs = { browser: false, artifacts: true, tasks: true, note: true };
/** The texture coordinates of a point on the strip, in its canvas pixels (uv's y runs up the strip). */
const at = (x: number, y = H / 2) => ({ x: x / W, y: 1 - y / H });

describe('switchAt', () => {
  it('finds each switch along the strip, left to right', () => {
    PANE_SWITCHES.forEach((_, i) => expect(switchAt(at(LEFT + i * COL + COL / 2))).toBe(i));
  });

  it('is no switch on the label, in the gaps or off the edges', () => {
    expect(switchAt(at(LEFT / 2))).toBeUndefined();
    expect(switchAt(at(LEFT + COL - GAP / 2))).toBeUndefined();
    expect(switchAt(at(W - 5))).toBeUndefined();
    expect(switchAt(at(LEFT + COL / 2, 5))).toBeUndefined();
  });
});

describe('switchLabel', () => {
  it('says what pressing E does', () => {
    const browser = PANE_SWITCHES.find((s) => s.pane === 'browser')!;
    const tasks = PANE_SWITCHES.find((s) => s.pane === 'tasks')!;
    expect(switchLabel(browser, prefs)).toBe('Show the browser pane');
    expect(switchLabel(tasks, prefs)).toBe('Hide the tasks pane');
  });
});
