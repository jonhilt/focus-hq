// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { Agent, Project } from '../../shared/types';
import { type ClientPlugin, everyGoalButtons, goalsFor, hudStats, openPluginPanel, pluginChair, pluginHails, pluginPanels, projectSettings } from './plugins';
import type { Ui } from './ui/context';
import { hailStat } from './ui/hails';

// The plugins' generic hooks in the browser, as docs/plugins.md promises them, each given the plugins switched on.

const ui = {} as Ui;
const project = (plugins?: Project['plugins']): Project => ({ id: 'p', name: 'Shop', color: '#fff', repos: [], maxAgents: 2, autoAssign: false, autoLabel: '', createdAt: 0, ...(plugins && { plugins }) });

describe('a plugin’s stat on the HUD', () => {
  it('is left out when its hud throws, and the rest are kept, an element of its own included', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const el = document.createElement('div');
    const plugins: ClientPlugin[] = [
      { id: 'broken', hud: () => { throw new Error('no state'); } },
      { id: 'plain', hud: () => ({ text: '3 open' }) },
      { id: 'drawn', hud: () => ({ text: '1 waiting', el }) },
      { id: 'quiet', hud: () => null },
    ];
    expect(hudStats(plugins)).toEqual([{ text: '3 open' }, { text: '1 waiting', el }]);
    expect(error).toHaveBeenCalledWith('The broken plugin\'s HUD stat failed', expect.any(Error));
    error.mockRestore();
  });
});

describe('a plugin’s panel and chair', () => {
  it('opens the panel of a plugin switched on, and nothing for one that’s off or has none', () => {
    const open = vi.fn();
    const plugins: ClientPlugin[] = [{ id: 'inbox', panel: { label: 'Inbox', open } }, { id: 'bare' }];
    openPluginPanel('inbox', ui, plugins);
    expect(open).toHaveBeenCalledWith(ui);
    expect(() => openPluginPanel('bare', ui, plugins)).not.toThrow();
    openPluginPanel('inbox', ui, []);
    expect(open).toHaveBeenCalledTimes(1);
    expect(pluginPanels(plugins).map((p) => p.id)).toEqual(['inbox']);
  });

  it('puts the first plugin’s thing in a chair, and nothing with none switched on', () => {
    const first = { at: 'bridge' as const, label: 'First', use: vi.fn() };
    const second = { at: 'bridge' as const, label: 'Second', use: vi.fn() };
    expect(pluginChair('bridge', [{ id: 'a', chair: first }, { id: 'b', chair: second }])).toBe(first);
    expect(pluginChair('bridge', [])).toBeUndefined();
  });
});

describe('a plugin’s settings in a project', () => {
  it('shows only while it’s switched on there', () => {
    const el = document.createElement('label');
    const plugin: ClientPlugin = { id: 'judge', project: { label: 'Judge', about: 'a', settings: () => [el] } };
    expect(projectSettings(plugin, project(), ui)).toEqual([]);
    expect(projectSettings(plugin, project(['judge']), ui)).toEqual([el]);
  });
});

describe('a plugin’s view of every goal', () => {
  it('is what L opens away from a holodeck; in one, its goals; with none, the first shown project’s', () => {
    expect(goalsFor('here', 'first', true)).toEqual({ projectId: 'here' });
    expect(goalsFor(undefined, 'first', true)).toBe('every');
    expect(goalsFor(undefined, 'first', false)).toEqual({ projectId: 'first' });
    expect(goalsFor(undefined, undefined, false)).toBeNull();
  });

  it('puts a way back out to it in a project’s goals panel, and nothing without one', () => {
    const open = vi.fn();
    const [button] = everyGoalButtons(ui, [{ id: 'inbox', everyGoal: { label: 'Comms', open } }]);
    expect(button?.textContent).toBe('◂ Comms');
    button?.click();
    expect(open).toHaveBeenCalledWith(ui);
    expect(everyGoalButtons(ui, [{ id: 'bare' }])).toEqual([]);
  });
});

describe('what waits on the captain, on the HUD', () => {
  const lead = { id: 'a1', name: 'Lt. Vale', status: 'done', task: 'lead', lead: { title: 'W' } } as Agent;

  it('is counted by the core when no plugin counts it its own way', () => {
    expect(pluginHails([{ id: 'bare' }])).toBe(false);
    const stat = hailStat([{ kind: 'turn', agent: lead }], false);
    expect(stat?.textContent).toBe('🖖 1 waiting on you');
    expect(stat?.title).toBe('💬 Lt. Vale: Waiting for your reply');
  });

  it('steps aside for a plugin that hails the captain itself, and says nothing when nothing waits', () => {
    expect(pluginHails([{ id: 'inbox', hails: true }])).toBe(true);
    expect(hailStat([{ kind: 'turn', agent: lead }], true)).toBeNull();
    expect(hailStat([], false)).toBeNull();
  });
});
