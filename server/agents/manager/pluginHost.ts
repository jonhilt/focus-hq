import type { PluginStates } from '../../../shared/types';
import type { BriefWork, PluginHost, PluginState } from '../../plugins/contract';
import type { Core } from './core';
import { Refused } from './core';

/** What the office lends a plugin that the manager doesn't have: where it runs, and its own repo. */
export interface Lent {
  demo: boolean;
  ownRepo: () => string | undefined;
}

/** A plugin's slot in `saved`, `fresh()` with what was saved on top (a field added since starts fresh). */
function slot<S extends object>(saved: () => PluginStates, id: string, fresh: () => S, changed: (state: S) => void): PluginState<S> {
  // what's saved under a plugin's id is the plugin's own: only this slot writes it
  const get = () => ({ ...fresh(), ...(saved()[id] as Partial<S> | undefined) });
  return {
    get,
    set: (patch) => {
      const state = { ...get(), ...patch };
      saved()[id] = state;
      changed(state);
    },
  };
}

/** What the office lends the plugin `id` (docs/plugins.md): the manager's seating, its terminals and toasts, and the store. */
export function pluginHost(core: Core, id: string, lent: Lent): PluginHost {
  return {
    demo: lent.demo,
    state: (fresh, how) => {
      const saved = how?.saved ?? true;
      return slot(() => (saved ? core.store.plugins : core.plugins.unsaved), id, fresh, () => {
        if (saved) core.store.save();
        core.hub.send({ type: 'plugin', id, state: core.plugins.stateOf(id) });
      });
    },
    projects: () => core.store.projects,
    agent: (agentId) => core.store.agents.get(agentId),
    ledger: () => core.store.ledger,
    ownRepo: lent.ownRepo,
    seat: (projectId, repo, work: BriefWork, crew) => {
      const brief = core.plugins.brief({ plugin: id, kind: work.kind });
      if (!brief) throw new Refused({ message: `${id} has no brief called ${work.kind}` });
      return core.seating.seat(projectId, repo, {
        id: work.id,
        task: 'brief',
        brief: { plugin: id, kind: work.kind, label: brief.label, icon: brief.icon },
        issue: { number: 0, title: work.title, url: '' },
        branch: work.branch,
        baseBranch: work.baseBranch,
      }, crew);
    },
    forget: (agentId) => void core.runtimes.delete(agentId),
    print: (agent, text) => core.print(agent, [{ kind: 'system', text }]),
    toast: (level, text, agentId) => core.hub.toast(level, text, agentId),
  };
}
