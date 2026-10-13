// Whether this viewer wants the flow hologram over the transporter consoles (flowHologram.ts): their choice, kept in
// their browser like the screen's panes (screenPanes.ts).

const KEY = 'focus.flowHologram';

function load(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

/** On unless this viewer switched it off, from a transporter console. `version` moves on each change, so screens know to redraw. */
export const flowPrefs = {
  on: load(),
  version: 0,
  set(on: boolean): void {
    this.on = on;
    this.version++;
    try {
      localStorage.setItem(KEY, on ? 'on' : 'off');
    } catch {
      // private window or blocked storage: the choice lasts until the page reloads
    }
  },
};
