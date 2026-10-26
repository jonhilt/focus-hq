// Which plugins Focus switches on for the whole ship (docs/plugins.md): FOCUS_PLUGINS when it's set, else the captain's
// choice in the ready room's Plugins tab (`Settings.plugins`). Focus can't start or stop a plugin while it runs, so a
// change to the choice waits for a restart. Pure, for the server and the browser alike.

/** What keeps the captain's switches from deciding: FOCUS_PLUGINS where Focus started, or a demo ship, which saves nothing. */
export type PluginsPinnedBy = 'FOCUS_PLUGINS' | 'demo';

/** A plugin of Focus's own that could be switched on, and the plugins it can't work without. */
export interface AvailablePlugin {
  id: string;
  requires: string[];
}

/**
 * The plugins Focus starts with (as FOCUS_PLUGINS names them: `all` stands for every one), and what pins them:
 * FOCUS_PLUGINS when it's set (even empty); else a demo ship has them all, since it saves no choice to start with;
 * else the captain's saved choice, none until they make one.
 */
export function pluginChoice(env: string | undefined, demo: boolean, saved: readonly string[] | undefined): { names: string[]; pinnedBy: PluginsPinnedBy | null } {
  if (env !== undefined) return { names: env.split(',').map((name) => name.trim()).filter(Boolean), pinnedBy: 'FOCUS_PLUGINS' };
  if (demo) return { names: ['all'], pinnedBy: 'demo' };
  return { names: saved ? [...saved] : [], pinnedBy: null };
}

/**
 * Whether the captain's choice differs from what Focus started with, so it takes a restart to apply (order aside). A
 * plugin chosen that isn't among `available` (gone from plugins/, or failing to load) can't start, so a restart wouldn't
 * change it, and doesn't count.
 */
export function restartPending(startedWith: readonly string[], chosen: readonly string[] | undefined, available: readonly AvailablePlugin[]): boolean {
  if (!chosen) return false;
  const now = new Set(startedWith);
  const next = new Set(chosen.filter((id) => available.some((a) => a.id === id)));
  return now.size !== next.size || [...next].some((id) => !now.has(id));
}

/**
 * The captain's choice with plugin `id` switched on or off. On brings whatever it requires on with it (and what they
 * require); off takes whatever requires it off with it, since Focus would leave those out anyway.
 */
export function switchShipPlugin(chosen: readonly string[], id: string, on: boolean, available: readonly AvailablePlugin[]): string[] {
  const requires = (p: string) => available.find((a) => a.id === p)?.requires ?? [];
  const next = new Set(chosen);
  const visit = (p: string, step: (q: string) => string[]) => {
    if (on ? next.has(p) : !next.has(p)) return;
    if (on) next.add(p);
    else next.delete(p);
    for (const q of step(p)) visit(q, step);
  };
  if (on) visit(id, requires);
  else visit(id, (p) => available.filter((a) => a.requires.includes(p)).map((a) => a.id));
  return [...next];
}
