import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { errorMessage } from '../util';
import type { FocusPlugin } from './contract';

/**
 * Where a plugin named in FOCUS_PLUGINS lives: a bare name is a folder under Focus's own plugins/, a path (with a
 * slash, relative to where Focus was started) is a plugin folder anywhere; either way, its server.ts.
 */
export function pluginEntry(name: string, root: string, cwd = process.cwd()): string {
  const dir = name.includes('/') || name.includes(path.sep) ? path.resolve(cwd, name) : path.join(root, 'plugins', name);
  return path.join(dir, 'server.ts');
}

/** What `FOCUS_PLUGINS=all` stands for: every folder under Focus's own plugins/ that has a server.ts, by name. */
export const ALL = 'all';

/**
 * The plugins FOCUS_PLUGINS names, with `all` standing for every one of `folders` (Focus's own plugins/, in
 * order) where it's listed; a plugin named twice is loaded once, where it's first named.
 */
export function pluginNames(names: string[], folders: string[]): string[] {
  return [...new Set(names.flatMap((name) => (name === ALL ? folders : [name])))];
}

/** The plugin folders under Focus's own plugins/: each with a server.ts. */
export function ownPlugins(root: string): string[] {
  const dir = path.join(root, 'plugins');
  const names = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
  return names.filter((name) => fs.existsSync(pluginEntry(name, root)));
}

const isPlugin = (value: unknown): value is FocusPlugin =>
  typeof value === 'object' && value !== null && 'id' in value && typeof value.id === 'string' && 'start' in value && typeof value.start === 'function';

/**
 * Loads the plugins FOCUS_PLUGINS names, in its order (`all`: every one under Focus's own plugins/). One that
 * can't be found or loaded is left out, saying why, so a typo in the list never keeps Focus from starting.
 */
export async function loadPlugins(names: string[], root: string): Promise<FocusPlugin[]> {
  const plugins: FocusPlugin[] = [];
  for (const name of pluginNames(names, names.includes(ALL) ? ownPlugins(root) : [])) {
    const entry = pluginEntry(name, root);
    if (!fs.existsSync(entry)) {
      console.error(`Plugin ${name}: there's no ${entry}, so it's left out`);
      continue;
    }
    try {
      const module: unknown = await import(pathToFileURL(entry).href);
      const plugin = typeof module === 'object' && module !== null && 'default' in module ? module.default : undefined;
      if (!isPlugin(plugin)) throw new Error(`${entry} doesn't default-export a plugin (an id and a start function)`);
      plugins.push(plugin);
    } catch (err) {
      console.error(`Plugin ${name} didn't load, so it's left out: ${errorMessage(err)}`);
    }
  }
  return plugins;
}
