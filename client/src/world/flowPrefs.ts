// What this viewer wants to see in the transporter rooms: the flow hologram over the consoles (flowHologram.ts), and
// whether the tactical display shows the run as a rail map (railMapScreen.ts) or as LCARS operations. Their choice,
// kept in their browser like the screen's panes (screenPanes.ts).

/** Whether a choice kept under `key` is on: on unless it's been switched `off` (or, with `fallback` false, until it's switched `on`). */
function load(key: string, fallback = true): boolean {
  try {
    const kept = localStorage.getItem(key);
    return kept === null ? fallback : kept !== 'off';
  } catch {
    return fallback;
  }
}

function keep(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? 'on' : 'off');
  } catch {
    // private window or blocked storage: the choice lasts until the page reloads
  }
}

/** On unless this viewer switched it off, from a transporter console. `version` moves on each change, so screens know to redraw. */
export const flowPrefs = {
  on: load('focus.flowHologram'),
  version: 0,
  set(on: boolean): void {
    this.on = on;
    this.version++;
    keep('focus.flowHologram', on);
  },
};

/** The rail map on the tactical display unless this viewer switched to the LCARS view, with E on it. */
export const railPrefs = {
  on: load('focus.railMap'),
  set(on: boolean): void {
    this.on = on;
    keep('focus.railMap', on);
  },
};
