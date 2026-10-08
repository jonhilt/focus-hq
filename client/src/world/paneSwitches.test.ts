import { describe, expect, it } from 'vitest';
import { PANE_SWITCHES, switchAt, switchLabel, switchOn } from './paneSwitches';

const prefs = { browser: false, artifacts: true, tasks: true, note: true };

describe('switchAt', () => {
  it('finds each switch down the panel, top to bottom', () => {
    // uv's y runs up the panel: the first switch is just under the header
    expect(switchAt({ x: 0.5, y: 1 - 250 / 960 })).toBe(0);
    expect(switchAt({ x: 0.5, y: 1 - 550 / 960 })).toBe(2);
    expect(switchAt({ x: 0.5, y: 1 - 850 / 960 })).toBe(4);
  });

  it('is no switch on the header, in the gaps or off the sides', () => {
    expect(switchAt({ x: 0.5, y: 1 - 80 / 960 })).toBeUndefined();
    expect(switchAt({ x: 0.5, y: 1 - 330 / 960 })).toBeUndefined();
    expect(switchAt({ x: 0.01, y: 1 - 250 / 960 })).toBeUndefined();
  });
});

describe('switchLabel', () => {
  it('says what pressing E does', () => {
    const browser = PANE_SWITCHES.find((s) => s.pane === 'browser')!;
    const tasks = PANE_SWITCHES.find((s) => s.pane === 'tasks')!;
    expect(switchLabel(browser, prefs)).toBe('Show the browser pane');
    expect(switchLabel(tasks, prefs)).toBe('Hide the tasks pane');
  });

  it('keeps the terminal on', () => {
    expect(switchOn(PANE_SWITCHES[0], { ...prefs, tasks: false })).toBe(true);
    expect(switchLabel(PANE_SWITCHES[0], prefs)).toBe('The terminal always shows');
  });
});
