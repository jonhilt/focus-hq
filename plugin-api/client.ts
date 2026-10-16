// The plugin API's browser part (docs/plugins.md): the contract a plugin's client.ts default-exports, a read-only view
// of the office's state, its own routes, and the station's UI kit. The browser's own state and REST client stay the
// core's: a plugin reads what `office` shows and calls only its own routes.
import type { ReportCard } from '../shared/ledger';
import type { Agent, Project } from '../shared/types';
import { api } from '../client/src/net/api';
import { state } from '../client/src/net/state';

export * from './shared';
export type { ClientPlugin, EngineeringGo, EngineeringPart, EngineeringView, GoalPart, GoalStrip, GoalTagPlace, HallHost, HallScreen, PluginSpace, ShipHost, ShipPart, StationSays } from '../client/src/plugins';
export { pluginState } from '../client/src/plugins';
export type { Ui } from '../client/src/ui/context';
export { busy, h, timeAgo } from '../client/src/ui/dom';
export { Switch } from '../client/src/ui/panels';
/** Markdown made safe to show, and the station's bars of the open frictions. */
export { markdownHtml } from '../client/src/ui/terminal';
export { frictionBars } from '../client/src/ui/frictionBars';
/** The LCARS kit, for what a plugin draws on a canvas (the MSD, a goal board's strip, a hall's screen). */
export { canvasTexture, fitText, makeCanvas, UI_FONT } from '../client/src/world/canvas';
/** What a plugin's ship part needs to stand things in the holodeck and in a space of its own. */
export { OVERLAY_LAYER } from '../client/src/world/frame';
export { Hologram, hover } from '../client/src/world/hologram';
export { around, SPACE } from './layout';
export type { Place } from '../client/src/world/office';
export type { Box } from '../client/src/world/msd';
export { LCARS, LCARS_FONT, LCARS_STATUS } from '../client/src/world/starship';

/** The office as the browser has it now, read-only: what a plugin's views may show. */
export const office = {
  get projects(): readonly Project[] {
    return state.projects;
  },
  /** An agent by id, as the browser has them now. */
  agent: (id: string): Readonly<Agent> | undefined => state.agents.get(id),
  /** The ledger's report card as the office last sent it: none until it has. */
  get report(): Readonly<ReportCard> | null {
    return state.report;
  },
};

/** Calls `fn` whenever plugin `id`'s state changes in the browser; returns what stops it. */
export const onPluginState = (id: string, fn: () => void): (() => void) => state.on('plugin', (changed) => changed === id && fn());

/** Calls one of plugin `id`'s own routes (`/api/plugins/<id><path>`), POSTing `body`; rejects with the office's word on why. */
export const callPlugin = <T>(id: string, path: string, body?: unknown): Promise<T> => api.plugin<T>(id, path, body);
