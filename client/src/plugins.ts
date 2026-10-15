/// <reference types="vite/client" />
// The plugins' parts in the browser (docs/plugins.md): each plugin folder's client.ts, found as the client's built.
// Only the plugins the office has switched on (`info.plugins`) show.
import { state } from './net/state';
import type { Ui } from './ui/context';

export interface ClientPlugin {
  /** The plugin's id, as the server knows it. */
  id: string;
  /** A card on the engineering station's overview, drawn again whenever the plugin's state, or an agent on a brief, changes. */
  engineering?(ui: Ui): HTMLElement | null;
}

const found = import.meta.glob<{ default: ClientPlugin }>('../../plugins/*/client.ts', { eager: true });

/** The plugins switched on that have a part in the browser. */
export function clientPlugins(): ClientPlugin[] {
  const on = new Set(state.info?.plugins ?? []);
  return Object.values(found).map((module) => module.default).filter((plugin) => on.has(plugin.id));
}
