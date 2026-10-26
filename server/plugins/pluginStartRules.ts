import type { FocusPlugin } from './contract';

// Which of the plugins switched on start, in what order, and which are left out and why. Pure, so it's unit tested
// (pluginStartRules.test.ts); registry.ts starts them.

/**
 * The order plugins start in: each after every plugin it requires. One whose requirement isn't among `plugins` (not
 * switched on, or itself left out), or that requires itself round a loop, is left out, saying why. Two plugins with one
 * id is a mistake in FOCUS_PLUGINS, and stops Focus.
 */
export function startOrder(plugins: FocusPlugin[]): { order: FocusPlugin[]; leftOut: { id: string; why: string }[] } {
  const byId = new Map<string, FocusPlugin>();
  for (const plugin of plugins) {
    if (byId.has(plugin.id)) throw new Error(`Two plugins are called ${plugin.id}`);
    byId.set(plugin.id, plugin);
  }
  const order: FocusPlugin[] = [];
  const leftOut: { id: string; why: string }[] = [];
  const state = new Map<string, 'visiting' | 'started' | 'out'>();
  const visit = (plugin: FocusPlugin, path: string[]): boolean => {
    const seen = state.get(plugin.id);
    if (seen === 'started') return true;
    if (seen === 'out') return false;
    if (seen === 'visiting') return false;
    state.set(plugin.id, 'visiting');
    for (const need of plugin.requires ?? []) {
      const required = byId.get(need);
      const why = !required ? `it requires ${need}, which isn't switched on (add it to FOCUS_PLUGINS)`
        : path.includes(need) || need === plugin.id ? `it requires ${need}, which requires it back (${[...path, plugin.id, need].join(' → ')})`
          : visit(required, [...path, plugin.id]) ? undefined : `it requires ${need}, which is left out`;
      if (why) {
        state.set(plugin.id, 'out');
        leftOut.push({ id: plugin.id, why });
        return false;
      }
    }
    state.set(plugin.id, 'started');
    order.push(plugin);
    return true;
  };
  for (const plugin of plugins) visit(plugin, []);
  return { order, leftOut };
}
