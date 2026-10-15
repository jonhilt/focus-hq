// Which plugins a project has switched on (docs/plugins.md): a plugin that works per project does nothing for a project
// until it's switched on there, in the project's settings. Pure, for the office and the browser alike.
import type { Project } from './types';

/** A plugin's id as the office takes one: lowercase letters, digits and dashes. */
const ID = /^[a-z][a-z0-9-]{0,40}$/;

/** Whether plugin `id` is switched on for `project` (missing = off). */
export const pluginOn = (project: Pick<Project, 'plugins'> | undefined, id: string): boolean => !!project?.plugins?.includes(id);

/** A project's plugins with `id` switched on or off, in the order they were switched on. Throws, in words, for a bad id. */
export function switchPlugin(plugins: readonly string[] | undefined, id: string, on: boolean): string[] {
  if (!ID.test(id)) throw new Error(`“${id}” isn’t a plugin’s id`);
  const rest = (plugins ?? []).filter((p) => p !== id);
  return on ? [...rest, id] : rest;
}
