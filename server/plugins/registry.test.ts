import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import type { LedgerEvent } from '../../shared/ledger';
import type { Agent, PluginStates } from '../../shared/types';
import type { BriefSpec, FocusPlugin, PluginHost, PluginParts } from './contract';
import { Plugins, startOrder } from './registry';

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
  it('tells every plugin a project changed, one that throws not stopping the rest', () => {
    const heard: string[] = [];
    const plugins = started({}, plugin('broken', { projectChanged: () => { throw new Error('boom'); } }), plugin('maps', { projectChanged: (id) => heard.push(id) }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    plugins.projectChanged('p1');
    expect(heard).toEqual(['p1']);
  });

  it('gathers the tools the plugins add to a lead’s office, with whose they are', () => {
    const map = { name: 'map', description: 'A map', input: {}, run: () => Promise.resolve('shown') };
    const plugins = started({}, plugin('cartography', { leadTools: [map] }), plugin('quiet', {}));
    expect(plugins.leadTools()).toEqual([{ plugin: 'cartography', tool: map }]);
  });

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

  it('tells every plugin of each agent’s turn and each line in the ledger, and skips one that throws', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const heard: string[] = [];
    const plugins = started({},
      plugin('broken', {
        turn: () => {
          throw new Error('nope');
        },
        ledgerRecorded: () => {
          throw new Error('nor this');
        },
      }),
      plugin('watcher', {
        turn: (agent, phase) => void heard.push(`${agent.id} ${phase}`),
        ledgerRecorded: (event) => void heard.push(`${event.kind} #${event.seq}`),
      }));
    plugins.turn({ id: 'lead_1' } as Agent, 'start');
    plugins.ledgerRecorded({ kind: 'qa-verdict', repo: 'acme/shop', pr: 7, verdict: 'pass', at: 1, projectId: 'p', seq: 3 } as LedgerEvent);
    plugins.turn({ id: 'lead_1' } as Agent, 'end');
    expect(heard).toEqual(['lead_1 start', 'qa-verdict #3', 'lead_1 end']);
    expect(error).toHaveBeenCalledWith('Plugin broken\'s turn failed: nope');
    expect(error).toHaveBeenCalledWith('Plugin broken\'s ledgerRecorded failed: nor this');
    error.mockRestore();
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

  it('reaches what a required plugin provides, and nothing it didn’t require', () => {
    const lent = new Map<string, PluginHost>();
    const registry = new Plugins(() => ({}));
    const uses = (id: string): FocusPlugin => ({ id, requires: ['scorecard'], start: (h) => (lent.set(id, h), {}) });
    registry.start([uses('climber'), plugin('scorecard', { provides: { latest: 7 } }), { id: 'other', start: (h) => (lent.set('other', h), {}) }], (p) => ({
      ...host,
      uses: <T extends object>(other: string) => {
        if (!registry.requires(p.id, other)) throw new Error(`${p.id} doesn't require ${other}`);
        return registry.provided(other) as T;
      },
    }));
    expect(lent.get('climber')?.uses<{ latest: number }>('scorecard')).toEqual({ latest: 7 });
    expect(() => lent.get('other')?.uses('scorecard')).toThrow(/doesn't require scorecard/);
  });
});

describe('startOrder', () => {
  const needs = (id: string, ...requires: string[]): FocusPlugin => ({ id, requires, start: () => ({}) });
  const ids = (r: ReturnType<typeof startOrder>) => r.order.map((p) => p.id);

  it('starts each plugin after the ones it requires, whatever order FOCUS_PLUGINS names them in', () => {
    expect(ids(startOrder([needs('climber', 'scorecard'), needs('scorecard')]))).toEqual(['scorecard', 'climber']);
    expect(ids(startOrder([needs('a', 'b'), needs('b', 'c'), needs('c')]))).toEqual(['c', 'b', 'a']);
  });

  it('leaves out a plugin whose requirement isn’t switched on, and the plugins that require it in turn', () => {
    const r = startOrder([needs('climber', 'scorecard'), needs('auditor', 'climber'), needs('voice')]);
    expect(ids(r)).toEqual(['voice']);
    expect(r.leftOut).toEqual([
      { id: 'climber', why: 'it requires scorecard, which isn\'t switched on (add it to FOCUS_PLUGINS)' },
      { id: 'auditor', why: 'it requires climber, which is left out' },
    ]);
  });

  it('leaves out plugins that require each other round a loop', () => {
    const r = startOrder([needs('a', 'b'), needs('b', 'a'), needs('c')]);
    expect(ids(r)).toEqual(['c']);
    expect(r.leftOut.map((o) => o.id).sort()).toEqual(['a', 'b']);
    expect(r.leftOut[0].why).toMatch(/requires it back/);
  });

  it('won’t start two plugins with the same id', () => {
    expect(() => startOrder([needs('climber'), needs('climber')])).toThrow(/Two plugins are called climber/);
  });
});
