import { describe, expect, it } from 'vitest';
import { connections, isSource, mapOf, ownerOf, problems, resolveImport } from './graph';
import type { ArchitectureModel } from './shared';

const model: ArchitectureModel = {
  parts: [
    { id: 'server', label: 'Server', layer: 'Server', kind: 'service', paths: ['server/'] },
    { id: 'tools', label: 'Tools', layer: 'Server', kind: 'handler', paths: ['server/agents/tools.ts'] },
    { id: 'shared', label: 'Shared', layer: 'Shared', kind: 'type', paths: ['shared/'] },
  ],
  views: [],
  ignore: ['server/generated/'],
};

describe('isSource', () => {
  it('reads code, not tests or declarations', () => {
    expect(['a.ts', 'b/c.tsx', 'd.mjs', 'e.js'].every(isSource)).toBe(true);
    expect(['a.test.ts', 'b.spec.tsx', 'c.d.ts', 'd.css', 'e.py'].some(isSource)).toBe(false);
  });
});

describe('resolveImport', () => {
  const files = new Set(['server/a.ts', 'server/b/index.ts', 'shared/types.ts', 'client/x.tsx']);

  it('finds an extensionless import, an index, and a .js that means .ts', () => {
    expect(resolveImport('server/main.ts', './a', files)).toBe('server/a.ts');
    expect(resolveImport('server/main.ts', './b', files)).toBe('server/b/index.ts');
    expect(resolveImport('server/main.ts', '../shared/types.js', files)).toBe('shared/types.ts');
    expect(resolveImport('server/main.ts', '../client/x', files)).toBe('client/x.tsx');
  });

  it('leaves packages and files it doesn’t have', () => {
    expect(resolveImport('server/main.ts', 'effect', files)).toBeUndefined();
    expect(resolveImport('server/main.ts', './missing', files)).toBeUndefined();
  });
});

describe('ownerOf', () => {
  it('gives a file to the part with the longest path over it', () => {
    expect(ownerOf('server/agents/tools.ts', model)).toBe('tools');
    expect(ownerOf('server/agents/other.ts', model)).toBe('server');
  });

  it('leaves ignored files, and files no part has, unowned', () => {
    expect(ownerOf('server/generated/x.ts', model)).toBeUndefined();
    expect(ownerOf('client/x.ts', model)).toBeUndefined();
  });

  it('takes a folder path as a folder, not a prefix of a name', () => {
    expect(ownerOf('shared-old/x.ts', model)).toBeUndefined();
  });
});

describe('connections', () => {
  it('counts imports across parts, busiest first, and drops a part’s imports of itself', () => {
    const owner = (f: string) => ownerOf(f, model);
    const found = connections(
      [
        ['server/a.ts', 'shared/t.ts'],
        ['server/b.ts', 'shared/t.ts'],
        ['server/agents/tools.ts', 'server/a.ts'],
        ['server/a.ts', 'server/b.ts'],
        ['client/x.ts', 'shared/t.ts'],
      ],
      owner,
    );
    expect(found).toEqual([
      { from: 'server', to: 'shared', imports: 2 },
      { from: 'tools', to: 'server', imports: 1 },
    ]);
  });
});

describe('problems', () => {
  it('names a path that’s gone from the code, and a part that owns nothing', () => {
    const drifted: ArchitectureModel = {
      ...model,
      parts: [...model.parts, { id: 'old', label: 'Old', layer: 'Server', kind: 'service', paths: ['server/old.ts', 'server/gone/'] }, { id: 'dup', label: 'Dup', layer: 'Server', kind: 'service', paths: ['server/'] }],
    };
    const files = ['server/a.ts', 'server/agents/tools.ts', 'shared/t.ts'];
    expect(problems(drifted, files, { server: 1, tools: 1, shared: 1 })).toEqual([
      "old: server/old.ts, server/gone/ aren't in the code",
      'dup owns no code: other parts claim all of it',
    ]);
  });
});

describe('mapOf', () => {
  it('counts the files it looks at (not the ignored ones), how many parts own, and each part’s', () => {
    const map = mapOf('o/r', model, ['server/a.ts', 'server/agents/tools.ts', 'server/generated/g.ts', 'shared/t.ts', 'client/x.ts'], [['server/a.ts', 'shared/t.ts']]);
    expect(map).toMatchObject({ repo: 'o/r', files: 4, mapped: 3, sizes: { server: 1, tools: 1, shared: 1 }, connections: [{ from: 'server', to: 'shared', imports: 1 }], problems: [] });
  });
});
