import type { Agent, Brief, PluginStates } from '../../shared/types';
import { errorMessage } from '../util';
import type { BriefSpec, FocusPlugin, PluginHost, PluginParts, PluginRoute } from './contract';

/**
 * The plugins the office started (docs/plugins.md), and the core's one way to them: it asks here rather than knowing
 * any plugin by name. A hook that throws is logged and skipped, so one plugin's bug never stops the office's loops.
 */
export class Plugins {
  private readonly parts = new Map<string, PluginParts>();
  /** What each started plugin requires, by id. */
  private readonly required = new Map<string, string[]>();
  /** Each plugin's state that isn't saved, by id: read again as the office starts (`PluginHost.state` with `saved: false`). */
  readonly unsaved: PluginStates = {};

  /** `saved` is the office's saved state of every plugin, by id (`Store.plugins`). */
  constructor(private readonly saved: () => PluginStates) {}

  /** The plugins switched on that didn't start, and why (a requirement that isn't on). */
  readonly leftOut: { id: string; why: string }[] = [];

  /** Starts each plugin with what the office lends it (`lend`), every one after the plugins it requires. */
  start(plugins: FocusPlugin[], lend: (plugin: FocusPlugin) => PluginHost): void {
    const { order, leftOut } = startOrder(plugins);
    for (const out of leftOut) console.error(`Plugin ${out.id} is left out: ${out.why}`);
    this.leftOut.push(...leftOut);
    for (const plugin of order) {
      this.required.set(plugin.id, plugin.requires ?? []);
      this.parts.set(plugin.id, plugin.start(lend(plugin)));
    }
  }

  /** Whether the started plugin `id` declared that it requires `other`. */
  requires(id: string, other: string): boolean {
    return this.required.get(id)?.includes(other) ?? false;
  }

  /** What a started plugin provides the plugins that require it. */
  provided(id: string): object | undefined {
    return this.parts.get(id)?.provides;
  }

  /** The plugins switched on, by id. */
  ids(): string[] {
    return [...this.parts.keys()];
  }

  /** Each plugin's state, for the browser: only those switched on (a plugin switched off keeps its state for later). */
  states(): PluginStates {
    return Object.fromEntries(this.ids().flatMap((id) => {
      const state = this.stateOf(id);
      return state === undefined ? [] : [[id, state]];
    }));
  }

  /** A plugin's state as the browser has it: what's saved, with what isn't over it. */
  stateOf(id: string): unknown {
    const saved = this.saved()[id];
    const unsaved = this.unsaved[id];
    const both = typeof saved === 'object' && saved !== null && typeof unsaved === 'object' && unsaved !== null;
    return both ? { ...saved, ...unsaved } : unsaved ?? saved;
  }

  /** The plugins with state saved from before that aren't switched on now (probably missing from FOCUS_PLUGINS). */
  dormant(): string[] {
    return Object.keys(this.saved()).filter((id) => !this.parts.has(id));
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

/**
 * The order plugins start in: each after every plugin it requires. One whose requirement isn't among `plugins` (not
 * switched on, or itself left out), or that requires itself round a loop, is left out, saying why. Two plugins with one
 * id is a mistake in FOCUS_PLUGINS, and stops the office.
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