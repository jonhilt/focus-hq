// State saved before parts of the office became plugins (docs/plugins.md), carried into the plugins' own slots as
// state.json is read. A step can go once every office has started on a version past it.
import type { Brief, PluginStates } from '../../shared/types';

/** What a saved state.json may hold from before: a plugin's state at the top, and agents on a task that's now a brief. */
export interface SavedBeforePlugins {
  climb?: unknown;
  plugins?: PluginStates;
  agents?: { task: string; brief?: Brief }[];
}

/** The climber's climbs, from before it was a plugin (the climber plugin, plugins/climber). */
const CLIMB: Brief = { plugin: 'climber', kind: 'climb', label: 'Climb', icon: '🧗' };

/** Moves what `raw` holds from before into the plugins' slots, in place. */
export function fromBeforePlugins(raw: SavedBeforePlugins): void {
  raw.plugins ??= {};
  if (raw.climb && !('climber' in raw.plugins)) raw.plugins.climber = raw.climb;
  delete raw.climb;
  for (const agent of raw.agents ?? []) {
    if (agent.task !== 'climb') continue;
    agent.task = 'brief';
    agent.brief = CLIMB;
  }
}
