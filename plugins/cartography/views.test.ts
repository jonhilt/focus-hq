import { describe, expect, it } from 'vitest';
import type { RepoMap } from './shared';
import { coverage, openingView, viewsOf } from './views';

export const MAP: RepoMap = {
  repo: 'o/r',
  files: 4,
  mapped: 3,
  sizes: { api: 1, core: 1, db: 1 },
  model: {
    parts: [
      { id: 'api', label: 'API', layer: 'Server', kind: 'route', paths: ['a.ts'], does: 'Answers requests' },
      { id: 'core', label: 'Core', layer: 'Domain', kind: 'service', paths: ['c.ts'] },
      { id: 'db', label: 'Store', layer: 'Data', kind: 'store', paths: ['d.ts'] },
    ],
    views: [{ id: 'front', question: 'What does the API reach?', parts: ['api', 'core'] }],
    ignore: [],
  },
  connections: [
    { from: 'api', to: 'core', imports: 3, names: ['handle', 'Order'] },
    { from: 'core', to: 'db', imports: 1, names: ['save'] },
    { from: 'core', to: 'api', imports: 1, names: ['Route'] },
  ],
  problems: [],
};

describe('viewsOf', () => {
  it('puts the whole map first, with every part, then the model’s views', () => {
    expect(viewsOf(MAP).map((v) => [v.id, v.parts.length])).toEqual([['whole', 3], ['front', 2]]);
    expect(viewsOf({ ...MAP, model: undefined })).toEqual([]);
  });
});

describe('openingView', () => {
  it('opens on the model’s first view, or the whole map when it has none', () => {
    expect(openingView(MAP)).toBe('front');
    expect(openingView({ ...MAP, model: MAP.model && { ...MAP.model, views: [] } })).toBe('whole');
  });
});

describe('coverage', () => {
  it('says how much of the repo the parts own', () => {
    expect(coverage(MAP)).toBe('3 parts own 3 of 4 source files (75%) · 3 connections, read from the imports');
  });
});
