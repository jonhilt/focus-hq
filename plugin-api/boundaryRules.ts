// Which imports cross the line between the core and its plugins (docs/plugins.md): a plugin reaches Focus only through
// plugin-api/ (testing.ts from its tests alone), another plugin only through that plugin's api.ts, and the core never
// reaches a plugin. boundary.ts reads the imports. Pure, so it's tested (boundaryRules.test.ts).

/** Which plugin a file belongs to (its folder under plugins/), or undefined for the core's files. */
export const pluginOf = (file: string): string | undefined => /^plugins\/([^/]+)\//.exec(file)?.[1];

const isTest = (file: string) => file.endsWith('.test.ts');

/** Whether `from` may import `to` (both from the repo's root): undefined if it may, else why not. */
export function refusal(from: string, to: string): string | undefined {
  const plugin = pluginOf(from);
  const target = pluginOf(to);
  if (!plugin) return target ? 'the core reaches into a plugin' : undefined;
  if (target === plugin) return undefined;
  if (target) return to === `plugins/${target}/api.ts` ? undefined : `${plugin} reaches into ${target} past its api.ts`;
  if (to === 'plugin-api/testing.ts') return isTest(from) ? undefined : 'the test kit is for tests only';
  if (to.startsWith('plugin-api/')) return undefined;
  return `${plugin} reaches into the core past plugin-api/`;
}
