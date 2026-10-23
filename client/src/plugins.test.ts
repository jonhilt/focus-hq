// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { Agent, Project } from '../../shared/types';
import { type ClientPlugin, everyGoalButtons, goalClaim, goalHolders, goalsFor, goalsPanelViews, hudStats, openPluginPanel, pluginChair, pluginHails, pluginPanels, pluginSettings, projectSettings } from './plugins';
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

describe('a plugin’s own settings', () => {
  it('are what it gives, none when it has none, and none, logged, when they throw', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const el = document.createElement('div');
    expect(pluginSettings({ id: 'set', settings: () => [el] }, ui)).toEqual([el]);
    expect(pluginSettings({ id: 'bare' }, ui)).toEqual([]);
    expect(pluginSettings({ id: 'broken', settings: () => { throw new Error('no state'); } }, ui)).toEqual([]);
    expect(error).toHaveBeenCalledWith('The broken plugin\'s settings failed', expect.any(Error));
    error.mockRestore();
  });
});

describe('a plugin’s view in a project’s goals panel', () => {
  it('is there for a plugin switched on, and on for the project if it works per project, in order', () => {
    const el = document.createElement('div');
    const view = (label: string) => ({ label, readout: (id: string) => `${label} in ${id}`, render: () => el });
    const plugins: ClientPlugin[] = [
      { id: 'ship-wide', goalsView: view('Ship') },
      { id: 'threads', project: { label: 'Threads', about: '' }, goalsView: view('Threads') },
      { id: 'elsewhere', project: { label: 'Elsewhere', about: '' }, goalsView: view('Elsewhere') },
      { id: 'bare' },
    ];
    const views = goalsPanelViews(ui, project(['threads']), plugins);
    expect(views.map((v) => [v.key, v.label, v.readout()])).toEqual([['plugin:ship-wide', 'Ship', 'Ship in p'], ['plugin:threads', 'Threads', 'Threads in p']]);
    expect(views[1]?.render()).toBe(el);
    expect(goalsPanelViews(ui, project(), plugins).map((v) => v.key)).toEqual(['plugin:ship-wide']);
  });

  it('shows nothing, logged, where its readout or view throws, and no readout where it has none', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const [broken] = goalsPanelViews(ui, project(), [{ id: 'broken', goalsView: { label: 'Broken', readout: () => { throw new Error('no state'); }, render: () => { throw new Error('no state'); } } }]);
    expect(broken?.readout()).toBe('');
    expect(broken?.render()).toBeNull();
    expect(error).toHaveBeenCalledWith('The broken plugin\'s goals view failed', expect.any(Error));
    const [plain] = goalsPanelViews(ui, project(), [{ id: 'plain', goalsView: { label: 'Plain', render: () => document.createElement('p') } }]);
    expect(plain?.readout()).toBe('');
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

describe('a plugin’s hold on a goal’s move', () => {
  const lead = { id: 'a1', projectId: 'p' } as Agent;
  const holder = (key: string) => ({ key, label: key, colour: '#fc9' });

  it('shows the pills of plugins switched on, and of a per-project one only where it’s on', () => {
    const plugins: ClientPlugin[] = [
      { id: 'everywhere', goal: { holder: holder('everywhere') } },
      { id: 'per-project', project: { label: 'P', about: '' }, goal: { holder: holder('per-project') } },
      { id: 'no-pill', goal: { move: () => ({ why: 'mine' }) } },
    ];
    expect(goalHolders(lead, plugins, project()).map((h) => h.key)).toEqual(['everywhere']);
    expect(goalHolders(lead, plugins, project(['per-project'])).map((h) => h.key)).toEqual(['everywhere', 'per-project']);
    // a claim from a plugin with no pill, or off for the project, isn't heard
    expect(goalClaim(lead, 0, plugins.slice(1), project())).toBeUndefined();
  });

  it('takes the first plugin’s claim, leaving out one whose move throws', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const plugins: ClientPlugin[] = [
      { id: 'broken', goal: { holder: holder('broken'), move: () => { throw new Error('no read'); } } },
      { id: 'quiet', goal: { holder: holder('quiet'), move: () => undefined } },
      { id: 'cos', goal: { holder: { key: 'cos', label: 'Chief of staff', colour: '#fc9' }, move: (_, now) => ({ why: 'Carry on', counter: String(now) }) } },
      { id: 'later', goal: { holder: holder('later'), move: () => ({ why: 'too late' }) } },
    ];
    expect(goalClaim(lead, 7, plugins, project())).toEqual({ key: 'cos', label: 'Chief of staff', why: 'Carry on', counter: '7' });
    expect(error).toHaveBeenCalledWith('The broken plugin\'s move on a goal failed', expect.any(Error));
    error.mockRestore();
  });

  it('passes on a plugin handing the move to the captain', () => {
    const plugins: ClientPlugin[] = [{ id: 'cos', goal: { holder: holder('cos'), move: () => ({ why: 'A card for you', captain: true }) } }];
    expect(goalClaim(lead, 0, plugins, project())).toEqual({ key: 'cos', label: 'cos', why: 'A card for you', captain: true });
  });

  it('passes on a quiet hand-over to the captain, and quiet alone as nothing', () => {
    const quiet = (captain: boolean): ClientPlugin[] => [{ id: 'cos', goal: { holder: holder('cos'), move: () => ({ why: 'You’ve read it', captain, quiet: true }) } }];
    expect(goalClaim(lead, 0, quiet(true), project())).toEqual({ key: 'cos', label: 'cos', why: 'You’ve read it', captain: true, quiet: true });
    expect(goalClaim(lead, 0, quiet(false), project())).toEqual({ key: 'cos', label: 'cos', why: 'You’ve read it' });
  });
});
