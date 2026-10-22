// The ready room's Plugins tab, decided: which plugins it lists, in what order, and how each one's cost reads.
import type { ClientPlugin, PluginAbout, PluginCost } from './plugins';

/** A plugin as the Plugins tab lists it: what it says about itself, and whether Focus has it switched on. */
export interface PluginEntry {
  plugin: ClientPlugin;
  about: PluginAbout | Omit<PluginAbout, 'cost' | 'costDetail'> & { cost: null; costDetail: string };
  /** Focus has it switched on now. */
  on: boolean;
  /** The captain has it switched on for the ship: it's on from Focus's next start. */
  chosen: boolean;
}

/** How a plugin's switch for the whole ship reads: on or off, or changing once Focus restarts. */
export function shipStatus(e: Pick<PluginEntry, 'on' | 'chosen'>): string {
  if (e.on === e.chosen) return e.on ? 'On' : 'Off';
  return e.chosen ? 'On after a restart' : 'Off after a restart';
}

/** How each cost reads on its badge, and its tone (a `.chip` class): the more it can spend unasked, the louder. */
export const COST_BADGE: Record<PluginCost, { label: string; tone: 'ok' | 'warn' | 'bad' }> = {
  'free': { label: 'No tokens', tone: 'ok' },
  'on-demand': { label: 'Tokens when you ask', tone: 'warn' },
  'per-turn': { label: 'Tokens every lead turn', tone: 'warn' },
  'background': { label: 'Tokens in the background', tone: 'bad' },
};

/**
 * Every plugin, those switched on first, each by name; one that doesn't describe itself is listed by what it says in
 * a project's settings, or by its id, with its cost unknown. `chosen` is the captain's choice for the next start.
 */
export function pluginEntries(every: readonly ClientPlugin[], on: readonly string[], chosen: readonly string[] = on): PluginEntry[] {
  const switched = new Set(on);
  const next = new Set(chosen);
  return every
    .map((plugin): PluginEntry => ({
      plugin,
      about: plugin.about ?? { name: plugin.project?.label ?? plugin.id, summary: plugin.project?.about ?? '', adds: [], cost: null, costDetail: 'It doesn’t say what it costs.' },
      on: switched.has(plugin.id),
      chosen: next.has(plugin.id),
    }))
    .sort((a, b) => Number(b.on) - Number(a.on) || a.about.name.localeCompare(b.about.name));
}
