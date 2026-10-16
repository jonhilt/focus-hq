import { describe, expect, it } from 'vitest';
import { connections, flowsGone, isSource, mapOf, NAMES_KEPT, ownerOf, partFlows, problems, resolveImport } from './graph';
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

  it('reads Java too, but not its tests or its package and module declarations', () => {
    expect(isSource('src/main/java/a/App.java')).toBe(true);
    expect(['src/test/java/a/AppTest.java', 'a/AppTests.java', 'a/AppIT.java', 'src/main/java/a/package-info.java', 'src/main/java/module-info.java'].some(isSource)).toBe(false);
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
  it('counts imports across parts, busiest first, with what they take, and drops a part’s imports of itself', () => {
    const owner = (f: string) => ownerOf(f, model);
    const found = connections(
      [
        { from: 'server/a.ts', to: 'shared/t.ts', names: ['Agent', 'Goal'] },
        { from: 'server/b.ts', to: 'shared/t.ts', names: ['Goal'] },
        { from: 'server/agents/tools.ts', to: 'server/a.ts', names: ['default'] },
        { from: 'server/a.ts', to: 'server/b.ts', names: ['x'] },
        { from: 'client/x.ts', to: 'shared/t.ts', names: ['Goal'] },
      ],
      owner,
    );
    expect(found).toEqual([
      { from: 'server', to: 'shared', imports: 2, names: ['Goal', 'Agent'] },
      { from: 'tools', to: 'server', imports: 1, names: ['default'] },
    ]);
  });

  it('keeps the most imported names only', () => {
    const names = Array.from({ length: NAMES_KEPT + 3 }, (_, i) => `n${i}`);
    const [c] = connections([{ from: 'server/a.ts', to: 'shared/t.ts', names }], (f) => ownerOf(f, model));
    expect(c.names).toHaveLength(NAMES_KEPT);
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
    const map = mapOf('o/r', model, ['server/a.ts', 'server/agents/tools.ts', 'server/generated/g.ts', 'shared/t.ts', 'client/x.ts'], [{ from: 'server/a.ts', to: 'shared/t.ts', names: ['T'] }]);
    expect(map).toMatchObject({ repo: 'o/r', files: 4, mapped: 3, sizes: { server: 1, tools: 1, shared: 1 }, connections: [{ from: 'server', to: 'shared', imports: 1, names: ['T'] }], problems: [] });
  });
});

describe('partFlows', () => {
  it('gathers a recorded run’s flows part to part and by how they went, the most sent first, dropping a part’s to itself', () => {
    const owner = (f: string) => ownerOf(f, model);
    const found = partFlows(
      [
        { via: 'ws', name: 'agent', from: 'server/a.ts', to: 'shared/t.ts', count: 5 },
        { via: 'ws', name: 'board', from: 'server/b.ts', to: 'shared/t.ts', count: 9 },
        { via: 'http', name: 'GET /api/x', from: 'shared/t.ts', to: 'server/a.ts', count: 2 },
        { via: 'ws', name: 'toast', from: 'server/a.ts', to: 'server/b.ts', count: 3 },
      ],
      owner,
    );
    expect(found).toEqual([
      { from: 'server', to: 'shared', via: 'ws', count: 14, names: ['board', 'agent'] },
      { from: 'shared', to: 'server', via: 'http', count: 2, names: ['GET /api/x'] },
    ]);
  });
});

describe('flowsGone', () => {
  it('says to record again when the recording names files gone from the code', () => {
    const recording = { run: 'r', flows: [{ via: 'ws' as const, name: 'agent', from: 'server/old.ts', to: 'shared/t.ts', count: 1 }] };
    expect(flowsGone(recording, ['shared/t.ts'])).toEqual(['the recorded flows name server/old.ts, gone from the code since: record them again (pnpm run record-flows)']);
    expect(flowsGone(recording, ['shared/t.ts', 'server/old.ts'])).toEqual([]);
  });

  it('lays a recording over the map, with what it was', () => {
    const recording = { run: 'a demo run', commit: 'abc', flows: [{ via: 'ws' as const, name: 'agent', from: 'server/a.ts', to: 'shared/t.ts', count: 2 }] };
    const map = mapOf('o/r', model, ['server/a.ts', 'shared/t.ts'], [], recording);
    expect(map.flows).toEqual([{ from: 'server', to: 'shared', via: 'ws', count: 2, names: ['agent'] }]);
    expect(map.flowsRun).toEqual({ run: 'a demo run', commit: 'abc' });
    expect(mapOf('o/r', model, ['server/a.ts'], []).flows).toBeUndefined();
  });
});
