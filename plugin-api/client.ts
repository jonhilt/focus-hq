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
export { h } from '../client/src/ui/dom';

/** The office as the browser has it now, read-only: what a plugin's views may show. */
export const office = {
  get projects(): readonly Project[] {
    return state.projects;
  },
};

/** Calls one of plugin `id`'s own routes (`/api/plugins/<id><path>`), POSTing `body`; rejects with the office's word on why. */
export const callPlugin = <T>(id: string, path: string, body?: unknown): Promise<T> => api.plugin<T>(id, path, body);
