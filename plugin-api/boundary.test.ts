import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { crossings, importsOf, pluginsNamed, project } from './boundary';
import { pluginOf } from './boundaryRules';

const root = path.resolve(import.meta.dirname, '..');

describe('the line between the core and its plugins', () => {
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

  it('holds in the repo: the core reaches no plugin, and no plugin reaches past plugin-api/ or another’s api.ts', () => {
    const { files, options } = project(root);
    const found = crossings(root, files, (f) => fs.readFileSync(f, 'utf8'), options);
    const say = (list: typeof found) => list.map((c) => `${c.file}:${c.line} ${c.spec}: ${c.why}`);
    expect(say(found.filter((c) => !pluginOf(c.file)))).toEqual([]);
    // none at all is fine: the core stands on its own
    const folder = path.join(root, 'plugins');
    const plugins = fs.existsSync(folder) ? fs.readdirSync(folder, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];
    for (const plugin of plugins) expect(say(found.filter((c) => pluginOf(c.file) === plugin)), `${plugin} imports only through plugin-api/ and other plugins' api.ts`).toEqual([]);
    // it parses every file in the repo: a second or two, longer while the rest of the suite runs beside it
  }, 30_000);

  it('finds the core reaching a plugin by its id written out', () => {
    expect(pluginsNamed('ui.openPlugin("maps");\nconst on = pluginOn(project, \'maps\');')).toEqual([{ line: 1, id: 'maps' }, { line: 2, id: 'maps' }]);
    expect(pluginsNamed("await shot(page, 'x', 'ui.openPlugin(`scores`)');\nfetch('/api/plugins/scores/inbox');")).toEqual([{ line: 1, id: 'scores' }, { line: 2, id: 'scores' }]);
    expect(pluginsNamed('const s = pluginState<Scores>(\'scores\');')).toEqual([{ line: 1, id: 'scores' }]);
    // by a variable, as `Plugins` does, or a word that only looks like one
    expect(pluginsNamed('openPlugin(id); pluginOn(p, plugin.id); fetch(`/api/plugins/${id}${path}`); const flow = \'flow\';')).toEqual([]);
  });

  it('holds in the repo: no core file reaches a plugin by its id', () => {
    const { files } = project(root);
    const core = files.map((f) => path.relative(root, f).split(path.sep).join('/')).filter((f) => !pluginOf(f) && !f.endsWith('.test.ts'));
    const named = core.flatMap((f) => pluginsNamed(fs.readFileSync(path.join(root, f), 'utf8')).map((n) => `${f}:${n.line} ${n.id}`));
    expect(named).toEqual([]);
  });
});
