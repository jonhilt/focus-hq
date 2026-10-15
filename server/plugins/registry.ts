import type { Agent, Brief, PluginStates } from '../../shared/types';
import { errorMessage } from '../util';
import type { BriefSpec, FocusPlugin, PluginHost, PluginParts, PluginRoute } from './contract';

/**
 * The plugins the office started (docs/plugins.md), and the core's one way to them: it asks here rather than knowing
 * any plugin by name. A hook that throws is logged and skipped, so one plugin's bug never stops the office's loops.
 */
export class Plugins {
  private readonly parts = new Map<string, PluginParts>();

  /** `saved` is the office's saved state of every plugin, by id (`Store.plugins`). */
  constructor(private readonly saved: () => PluginStates) {}

  /** Starts each plugin with what the office lends it (`lend`). */
  start(plugins: FocusPlugin[], lend: (plugin: FocusPlugin) => PluginHost): void {
    for (const plugin of plugins) {
      if (this.parts.has(plugin.id)) throw new Error(`Two plugins are called ${plugin.id}`);
      this.parts.set(plugin.id, plugin.start(lend(plugin)));
    }
  }

  /** The plugins switched on, by id. */
  ids(): string[] {
    return [...this.parts.keys()];
  }

  /** Each plugin's state, for the browser: only those switched on (a plugin switched off keeps its state for later). */
  states(): PluginStates {
    const saved = this.saved();
    return Object.fromEntries(this.ids().flatMap((id) => (id in saved ? [[id, saved[id]]] : [])));
  }

  /** What an agent's brief is, while its plugin is on. */
  brief(brief: Pick<Brief, 'plugin' | 'kind'> | undefined): BriefSpec | undefined {
    return brief && this.parts.get(brief.plugin)?.briefs?.[brief.kind];
  }

  routes(): { plugin: string; route: PluginRoute }[] {
    return [...this.parts].flatMap(([plugin, parts]) => (parts.routes ?? []).map((route) => ({ plugin, route })));
  }

  boardRefreshed(projectId: string): void {
    this.each('boardRefreshed', (parts) => parts.boardRefreshed?.(projectId));
  }

  /** Only the agent's own plugin hears that their pull request opened. */
  prOpened(agent: Agent, pr: { number: number; url: string }): void {
    const parts = agent.brief && this.parts.get(agent.brief.plugin);
    if (parts) this.safely(agent.brief?.plugin ?? '', 'prOpened', () => parts.prOpened?.(agent, pr));
  }

  prClosed(repo: string, number: number, merged: boolean): void {
    this.each('prClosed', (parts) => parts.prClosed?.(repo, number, merged));
  }

  /** Whether any plugin says only the captain merges this pull request. */
  captainMerges(pr: { branch: string }): boolean {
    return [...this.parts].some(([id, parts]) => this.safely(id, 'captainMerges', () => parts.captainMerges?.(pr)) === true);
  }

  private each(hook: string, call: (parts: PluginParts) => void): void {
    for (const [id, parts] of this.parts) this.safely(id, hook, () => call(parts));
  }

  private safely<T>(id: string, hook: string, call: () => T): T | undefined {
    try {
      return call();
    } catch (err) {
      console.error(`Plugin ${id}'s ${hook} failed: ${errorMessage(err)}`);
      return undefined;
    }
  }
}
