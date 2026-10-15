import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import type { Agent, PluginStates } from '../../shared/types';
import type { BriefSpec, FocusPlugin, PluginHost, PluginParts } from './contract';
import { Plugins } from './registry';

const audit: BriefSpec = {
  label: 'Audit',
  icon: '🔎',
  assignment: 'You are the auditor.',
  summary: 'End with a title.',
  brief: () => Effect.succeed('Audit it.'),
  pullRequest: (summary) => ({ title: summary, body: '' }),
};

/** A plugin that adds `parts`, started on a host it never uses. */
const plugin = (id: string, parts: PluginParts): FocusPlugin => ({ id, start: () => parts });
// these plugins never reach for the host
const host = {} as PluginHost;

function started(saved: PluginStates, ...plugins: FocusPlugin[]): Plugins {
  const registry = new Plugins(() => saved);
  registry.start(plugins, () => host);
  return registry;
}

describe('Plugins', () => {
  it('finds a brief by its plugin and kind, while that plugin is on', () => {
    const plugins = started({}, plugin('auditor', { briefs: { audit } }));
    expect(plugins.brief({ plugin: 'auditor', kind: 'audit' })).toBe(audit);
    expect(plugins.brief({ plugin: 'auditor', kind: 'other' })).toBeUndefined();
    expect(plugins.brief({ plugin: 'climber', kind: 'climb' })).toBeUndefined();
    expect(plugins.brief(undefined)).toBeUndefined();
  });

  it('sends the browser only the states of the plugins switched on', () => {
    const plugins = started({ auditor: { audits: 2 }, climber: { cycles: 4 } }, plugin('auditor', {}), plugin('quiet', {}));
    expect(plugins.ids()).toEqual(['auditor', 'quiet']);
    expect(plugins.states()).toEqual({ auditor: { audits: 2 } });
    // the climber's state waits for it to be switched on again
    expect(plugins.dormant()).toEqual(['climber']);
  });

  it('tells only the agent’s own plugin that their pull request opened, and every plugin that one closed', () => {
    const heard: string[] = [];
    const listening = (id: string) => plugin(id, {
      prOpened: (_agent, pr) => void heard.push(`${id} opened #${pr.number}`),
      prClosed: (_repo, number) => void heard.push(`${id} closed #${number}`),
    });
    const plugins = started({}, listening('auditor'), listening('climber'));
    // only its brief matters here
    plugins.prOpened({ brief: { plugin: 'climber', kind: 'climb', label: 'Climb', icon: '🧗' } } as Agent, { number: 7, url: '' });
    plugins.prClosed('acme/shop', 7, true);
    expect(heard).toEqual(['climber opened #7', 'auditor closed #7', 'climber closed #7']);
  });

  it('has the captain merge a pull request when any plugin says so', () => {
    const plugins = started({}, plugin('a', { captainMerges: () => false }), plugin('b', { captainMerges: (pr) => pr.branch.startsWith('focus/climb-') }), plugin('c', {}));
    expect(plugins.captainMerges({ branch: 'focus/climb-ab12' })).toBe(true);
    expect(plugins.captainMerges({ branch: 'focus/7-cart' })).toBe(false);
  });

  it('logs and skips a hook that throws, so the others still hear', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const heard: string[] = [];
    const plugins = started({}, plugin('broken', { boardRefreshed: () => {
      throw new Error('nope');
    } }), plugin('fine', { boardRefreshed: (id) => void heard.push(id) }));
    plugins.boardRefreshed('shop');
    expect(heard).toEqual(['shop']);
    expect(error).toHaveBeenCalledWith('Plugin broken\'s boardRefreshed failed: nope');
    error.mockRestore();
  });

  it('won’t start two plugins with the same id', () => {
    expect(() => started({}, plugin('climber', {}), plugin('climber', {}))).toThrow(/Two plugins are called climber/);
  });
});
