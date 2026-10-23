// What the ship puts on its page for the console and for the tools that drive it in a browser (tools/demoShip.ts,
// gaps, zfight, flows, themeShots; the browser tool's hint). main.ts sets it last, once the ship has loaded, so a
// tool that waits for it waits for the ship; until then it's missing.
import type { ShipState } from './net/state';
import type { Player } from './player';
import type { Ui } from './ui/context';
import type { World } from './world/ship';

export interface FocusHQ {
  state: ShipState;
  world: World;
  player: Player;
  ui: Ui;
}

declare global {
  interface Window {
    focusHQ?: FocusHQ;
  }
}
