// The plugin API's browser part (docs/plugins.md): the contract a plugin's client.ts default-exports, a read-only view
// of the office's state, its own routes, and the station's UI kit. The browser's own state and REST client stay the
// core's: a plugin reads what `office` shows and calls only its own routes.
import type { Project } from '../shared/types';
import { api } from '../client/src/net/api';
import { state } from '../client/src/net/state';

export * from './shared';
export type { ClientPlugin, EngineeringGo, EngineeringPart, EngineeringView, GoalPart, GoalStrip, GoalTagPlace, HallScreen, StationSays } from '../client/src/plugins';
export { pluginState } from '../client/src/plugins';
export type { Ui } from '../client/src/ui/context';
export { busy, h, timeAgo } from '../client/src/ui/dom';
/** The LCARS kit, for what a plugin draws on a canvas (the MSD, a goal board's strip, a hall's screen). */
export { fitText, UI_FONT } from '../client/src/world/canvas';
export type { Box } from '../client/src/world/msd';
export { LCARS, LCARS_FONT, LCARS_STATUS } from '../client/src/world/starship';

/** The office as the browser has it now, read-only: what a plugin's views may show. */
export const office = {
  get projects(): readonly Project[] {
    return state.projects;
  },
};

/** Calls `fn` whenever plugin `id`'s state changes in the browser; returns what stops it. */
export const onPluginState = (id: string, fn: () => void): (() => void) => state.on('plugin', (changed) => changed === id && fn());

/** Calls one of plugin `id`'s own routes (`/api/plugins/<id><path>`), POSTing `body`; rejects with the office's word on why. */
export const callPlugin = <T>(id: string, path: string, body?: unknown): Promise<T> => api.plugin<T>(id, path, body);
