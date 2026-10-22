// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { pluginEntries } from './pluginList';
import { type ClientPlugin, everyPlugin } from './plugins';

// The ready room's Plugins tab: what it lists, in what order, and that each of Focus's own plugins says what it costs.

const about = (name: string, cost: 'free' | 'background' = 'free') => ({ name, summary: '', adds: [], cost, costDetail: '' });

describe('the Plugins tab’s list', () => {
  it('lists the plugins switched on first, each group by name', () => {
    const plugins: ClientPlugin[] = [
      { id: 'b', about: about('Bravo') },
      { id: 'a', about: about('Alpha') },
      { id: 'c', about: about('Charlie') },
    ];
    expect(pluginEntries(plugins, ['c', 'b']).map((e) => [e.plugin.id, e.on])).toEqual([['b', true], ['c', true], ['a', false]]);
  });

  it('names a plugin that doesn’t describe itself by its project label, or its id, with its cost unknown', () => {
    const [labelled, bare] = pluginEntries([{ id: 'maps', project: { label: 'Maps', about: 'Draws maps' } }, { id: 'zed' }], []);
    expect(labelled?.about).toMatchObject({ name: 'Maps', summary: 'Draws maps', cost: null });
    expect(bare?.about).toMatchObject({ name: 'zed', cost: null });
  });
});

describe('Focus’s own plugins', () => {
  it('each says what it is, what it adds and what it costs', () => {
    const plugins = everyPlugin();
    expect(plugins.length).toBeGreaterThan(0);
    for (const plugin of plugins) {
      expect(plugin.about, plugin.id).toBeDefined();
      expect(plugin.about?.summary, plugin.id).not.toBe('');
      expect(plugin.about?.adds.length, plugin.id).toBeGreaterThan(0);
      expect(plugin.about?.costDetail, plugin.id).not.toBe('');
    }
  });
});
