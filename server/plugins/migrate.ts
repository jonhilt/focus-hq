// State saved before parts of the office became plugins (docs/plugins.md), carried into the plugins' own slots as
// state.json is read. A step can go once every office has started on a version past it.
import type { Brief, PluginStates } from '../../shared/types';

/** What a saved state.json may hold from before: a plugin's state at the top, and agents on a task that's now a brief. */
export interface SavedBeforePlugins {
  climb?: unknown;
  retro?: unknown;
  plugins?: PluginStates;
  agents?: { task: string; brief?: Brief; lead?: { flow?: unknown } }[];
}

/** The climber's climbs, from before it was a plugin (the climber plugin, plugins/climber). */
const CLIMB: Brief = { plugin: 'climber', kind: 'climb', label: 'Climb', icon: '🧗' };

/**
 * Whether a retro saved before (the retro plugin, plugins/retro) is worth carrying over: one that ran, or has drafts.
 * The office saved the retro whether one had ever run or not, and carrying an untouched one over would have every office
 * without the retro warn that its saved state is waiting.
 */
function retroWorthKeeping(retro: unknown): boolean {
  if (!retro || typeof retro !== 'object') return false;
  const { status, drafts } = retro as { status?: unknown; drafts?: unknown };
  return (status !== undefined && status !== 'idle') || (Array.isArray(drafts) && drafts.length > 0);
}

/** Moves what `raw` holds from before into the plugins' slots, in place. */
export function fromBeforePlugins(raw: SavedBeforePlugins): void {
  raw.plugins ??= {};
  if (raw.climb && !('climber' in raw.plugins)) raw.plugins.climber = raw.climb;
  delete raw.climb;
  if (retroWorthKeeping(raw.retro) && !('retro' in raw.plugins)) raw.plugins.retro = raw.retro;
  delete raw.retro;
  for (const agent of raw.agents ?? []) {
    // a goal's flow (the flow plugin, plugins/flow) is worked out again as the office starts, so there's nothing to move
    delete agent.lead?.flow;
    if (agent.task !== 'climb') continue;
    agent.task = 'brief';
    agent.brief = CLIMB;
  }
}
