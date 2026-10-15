import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { crossings, importsOf, pluginOf, project, refusal } from './boundary';

/**
 * The plugins not yet moved behind plugin-api/, with how many of their imports still cross into the core or another
 * plugin's code: the counts may only fall (and are brought down here as they do), and a plugin leaves the list once it reaches none. Any plugin not listed,
 * a new one too, has to have none.
 */
const NOT_YET_BEHIND: Record<string, number> = { climber: 30, 'number-one': 72, retro: 31 };

const root = path.resolve(import.meta.dirname, '..');

describe('the line between the core and its plugins', () => {
  it('lets a plugin import its own files, plugin-api/ and another plugin’s types, and nothing else of the office', () => {
    expect(refusal('plugins/maps/server.ts', 'plugins/maps/shared.ts', false)).toBeUndefined();
    expect(refusal('plugins/maps/server.ts', 'plugin-api/server.ts', false)).toBeUndefined();
    expect(refusal('plugins/maps/server.ts', 'plugins/scores/types.ts', true)).toBeUndefined();
    expect(refusal('plugins/maps/server.ts', 'server/config.ts', true)).toBe('maps reaches into the core past plugin-api/');
    expect(refusal('plugins/maps/client.ts', 'client/src/ui/dom.ts', false)).toBe('maps reaches into the core past plugin-api/');
    expect(refusal('plugins/maps/scripts/run.ts', 'shared/types/index.ts', true)).toBe('maps reaches into the core past plugin-api/');
    expect(refusal('plugins/maps/server.ts', 'plugins/scores/scores.ts', false)).toMatch(/^maps reaches into scores's code/);
  });

  it('keeps the test kit to tests, and the core out of every plugin', () => {
    expect(refusal('plugins/maps/map.test.ts', 'plugin-api/testing.ts', false)).toBeUndefined();
    expect(refusal('plugins/maps/map.ts', 'plugin-api/testing.ts', false)).toBe('the test kit is for tests only');
    expect(refusal('server/routes.ts', 'plugins/maps/server.ts', true)).toBe('the core reaches into a plugin');
    expect(refusal('plugin-api/server.ts', 'plugins/maps/shared.ts', true)).toBe('the core reaches into a plugin');
    expect(refusal('server/routes.ts', 'server/config.ts', false)).toBeUndefined();
  });

  it('reads imports, re-exports and dynamic imports, and which are for types only', () => {
    const text = [
      "import { a } from './a';",
      "import type { B } from './b';",
      "import { type C, type D } from './c';",
      "import { type E, f } from './e';",
      "export { g } from './g';",
      "export type { H } from './h';",
      "const lazy = () => import('./i');",
      "const quoted = \"import { x } from './not-an-import'\";",
    ].join('\n');
    expect(importsOf('x.ts', text).map((i) => [i.spec, i.typeOnly])).toEqual([
      ['./a', false], ['./b', true], ['./c', true], ['./e', false], ['./g', false], ['./h', true], ['./i', false],
    ]);
  });

  it('finds an import planted past plugin-api/, resolved as the repo resolves it', () => {
    const { options } = project(root);
    const planted = path.join(root, 'plugins/cartography/planted.ts');
    const texts: Record<string, string> = { [planted]: "import { config } from '../../server/config';\nimport { h } from '../../plugin-api/client';\n" };
    expect(crossings(root, [planted], (f) => texts[f], options)).toEqual([
      { file: 'plugins/cartography/planted.ts', line: 1, spec: '../../server/config', to: 'server/config.ts', why: 'cartography reaches into the core past plugin-api/' },
    ]);
  });

  it('holds in the repo: the core reaches no plugin, and each plugin only as far as it’s allowed', () => {
    const { files, options } = project(root);
    const found = crossings(root, files, (f) => fs.readFileSync(f, 'utf8'), options);
    const say = (list: typeof found) => list.map((c) => `${c.file}:${c.line} ${c.spec}: ${c.why}`);
    expect(say(found.filter((c) => !pluginOf(c.file)))).toEqual([]);
    const plugins = new Set(fs.readdirSync(path.join(root, 'plugins'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name));
    for (const plugin of plugins) {
      const theirs = found.filter((c) => pluginOf(c.file) === plugin);
      const allowed = NOT_YET_BEHIND[plugin] ?? 0;
      if (allowed === 0) expect(say(theirs), `${plugin} imports only through plugin-api/`).toEqual([]);
      // exactly: one more is a new crossing to take out; one fewer, a count to bring down here
      else expect(theirs.length, `${plugin}'s crossings, NOT_YET_BEHIND says ${allowed}:\n${say(theirs).join('\n')}`).toBe(allowed);
    }
    // it parses every file in the repo: a second or two, longer while the rest of the suite runs beside it
  }, 30_000);
});
