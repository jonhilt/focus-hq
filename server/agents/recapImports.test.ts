import { describe, expect, it } from 'vitest';
import type { RecapPrimitive } from './recap';
import { backedMap, importSpecifiers, primitivesToRead, resolveImport } from './recapImports';

const primitive = (id: string, ...paths: string[]): RecapPrimitive => ({ id, group: 'g', impact: 'composes', change: 'c', paths });

describe('what a source file imports', () => {
  it('is every module it names: import from, export from, bare import, import() and require()', () => {
    const source = [
      "import { a } from './a';",
      "import type { B } from \"../b/b.js\";",
      "export * from './c';",
      "import './d.css';",
      "const e = await import('./e');",
      "const f = require('./f');",
      "import x from 'effect';",
    ].join('\n');
    expect(importSpecifiers(source)).toEqual(['./a', '../b/b.js', './c', './d.css', './e', './f', 'effect']);
  });

  it('lands a relative import beside the file importing it, and a package’s nowhere', () => {
    expect(resolveImport('focus/plugins/cos/needCard.ts', '../../plugin-api/client')).toBe('focus/plugin-api/client');
    expect(resolveImport('focus/plugins/cos/needCard.ts', './merging')).toBe('focus/plugins/cos/merging');
    expect(resolveImport('focus/plugins/cos/needCard.ts', 'effect')).toBeUndefined();
  });
});

describe('an arrow on the map', () => {
  const card = primitive('comms-card', 'focus/plugins/cos/needCard.ts');
  const merging = primitive('merge-press', 'focus/plugins/cos/merging.ts');
  const api = primitive('plugin-api', 'focus/plugin-api/');
  const sources = new Map([
    ['focus/plugins/cos/needCard.ts', "import { mergePr } from '../../plugin-api/client';\nimport { mergePress } from './merging.js';"],
    ['focus/plugins/cos/merging.ts', "import type { MergeAction } from '../../plugin-api/shared';"],
    ['focus/plugin-api/client.ts', "export const x = 1;"],
  ]);

  it('is backed when a file of one imports one of the other, either way round, a .js written for a .ts and a folder alike', () => {
    const map = backedMap([card, merging, api], [
      { from: 'comms-card', to: 'merge-press', label: 'what the button does' },
      { from: 'merge-press', to: 'comms-card', label: 'answers it' },
      { from: 'comms-card', to: 'plugin-api', label: 'merges' },
    ], sources);
    expect(map.map((s) => s.backed)).toEqual([true, true, true]);
  });

  it('isn’t, with no import between them; and one to anything else is left as it was', () => {
    const lanes = primitive('inbox-lanes', 'focus/plugins/cos/lanes.ts');
    const map = backedMap([card, lanes], [{ from: 'comms-card', to: 'inbox-lanes', label: 'files it' }, { from: 'captain', to: 'comms-card', label: 'presses' }], sources);
    expect(map).toEqual([{ from: 'comms-card', to: 'inbox-lanes', label: 'files it', backed: false }, { from: 'captain', to: 'comms-card', label: 'presses' }]);
  });

  it('needs only the files of primitives at both ends of one read', () => {
    expect(primitivesToRead([card, merging, api], [{ from: 'comms-card', to: 'merge-press', label: '' }, { from: 'captain', to: 'plugin-api', label: '' }])).toEqual([card, merging]);
  });
});
