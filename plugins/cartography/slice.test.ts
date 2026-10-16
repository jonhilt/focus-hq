import { describe, expect, it } from 'vitest';
import type { RepoMap } from './shared';
import { changesAnything, readNumstat, SLICE_PARTS, sliceChange, sliceView } from './slice';
import { MAP } from './views.test';

// main: api → core → db, core → api. The branch adds a jobs part that uses db, and core stops importing api.
const branch: RepoMap = {
  ...MAP,
  model: { ...MAP.model!, parts: [...MAP.model!.parts, { id: 'jobs', label: 'Jobs', layer: 'Server', kind: 'job', paths: ['j.ts'] }] },
  connections: [MAP.connections[0], MAP.connections[1], { from: 'jobs', to: 'db', imports: 2, names: ['save'] }],
};

describe('readNumstat', () => {
  it('reads each file and its lines, a binary one as none', () => {
    expect(readNumstat('3\t1\ta.ts\n-\t-\tlogo.png\n\n')).toEqual([{ path: 'a.ts', lines: 4 }, { path: 'logo.png', lines: 0 }]);
  });
});

describe('sliceChange', () => {
  const change = sliceChange(MAP, branch, [{ path: 'c.ts', lines: 2 }, { path: 'j.ts', lines: 40 }, { path: 'a.ts', lines: 2 }, { path: 'stray.ts', lines: 5 }, { path: 'README.md', lines: 9 }]);

  it('says which parts its files fall in, the most lines first, and the source no part owns', () => {
    expect(change.touched).toEqual([{ part: 'jobs', files: 1, lines: 40 }, { part: 'api', files: 1, lines: 2 }, { part: 'core', files: 1, lines: 2 }]);
    expect(change.unowned).toEqual(['stray.ts']);
  });

  it('says which parts it adds and drops, and which imports it makes and breaks', () => {
    expect(change.added).toEqual(['jobs']);
    expect(change.removed).toEqual([]);
    expect(change.gained.map((c) => `${c.from}>${c.to}`)).toEqual(['jobs>db']);
    expect(change.lost.map((c) => `${c.from}>${c.to}`)).toEqual(['core>api']);
    expect(changesAnything(change)).toBe(true);
    expect(changesAnything(sliceChange(MAP, MAP, []))).toBe(false);
  });

  it('draws the parts it touches and those its imports run between, with the lost imports put back', () => {
    const { map, view } = sliceView(MAP, branch, change, 'What does it change?');
    expect(view.parts).toEqual(['jobs', 'api', 'core', 'db']);
    expect(map.connections.map((c) => `${c.from}>${c.to}`)).toContain('core>api');
    expect(view.question).toBe('What does it change?');
  });

  it('keeps a part the branch dropped on the map, so it can show it going', () => {
    const dropped: RepoMap = { ...MAP, model: { ...MAP.model!, parts: MAP.model!.parts.filter((p) => p.id !== 'db') }, connections: [MAP.connections[0]] };
    const c = sliceChange(MAP, dropped, []);
    expect(c.removed).toEqual(['db']);
    const { map, view } = sliceView(MAP, dropped, c, 'q');
    expect(view.parts).toContain('db');
    expect(map.model?.parts.map((p) => p.id)).toContain('db');
  });

  it('shows no more than SLICE_PARTS parts', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, label: `P${i}`, layer: 'Server', kind: 'service' as const, paths: [`p${i}.ts`] }));
    const big: RepoMap = { ...MAP, model: { ...MAP.model!, parts: many }, connections: [] };
    const c = sliceChange(big, big, many.map((p) => ({ path: p.paths[0], lines: 1 })));
    expect(sliceView(big, big, c, 'q').view.parts).toHaveLength(SLICE_PARTS);
  });
});
