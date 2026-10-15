import { describe, expect, it } from 'vitest';
import { pluginOn, switchPlugin } from './projectPlugins';

describe('a project’s plugins', () => {
  it('are off until switched on', () => {
    expect(pluginOn({}, 'cartography')).toBe(false);
    expect(pluginOn(undefined, 'cartography')).toBe(false);
    expect(pluginOn({ plugins: ['cartography'] }, 'cartography')).toBe(true);
  });

  it('switch on and off one at a time, each listed once', () => {
    expect(switchPlugin(undefined, 'cartography', true)).toEqual(['cartography']);
    expect(switchPlugin(['cartography'], 'cartography', true)).toEqual(['cartography']);
    expect(switchPlugin(['cartography', 'flow'], 'cartography', false)).toEqual(['flow']);
    expect(switchPlugin([], 'flow', false)).toEqual([]);
  });

  it('refuses what isn’t a plugin’s id', () => {
    expect(() => switchPlugin([], 'Not An Id', true)).toThrow('isn’t a plugin’s id');
  });
});
