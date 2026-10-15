import { describe, expect, it } from 'vitest';
import { modelError } from '../../shared/systemModel';
import type { RepoMap } from './shared';
import { openingView, viewModel, viewsOf } from './views';

const map: RepoMap = {
  repo: 'o/r',
  files: 3,
  mapped: 3,
  sizes: { api: 1, core: 1, db: 1 },
  model: {
    parts: [
      { id: 'api', label: 'API', layer: 'Server', kind: 'route', paths: ['a.ts'] },
      { id: 'core', label: 'Core', layer: 'Server', kind: 'service', paths: ['c.ts'] },
      { id: 'db', label: 'Store', layer: 'Data', kind: 'store', paths: ['d.ts'] },
    ],
    views: [{ id: 'front', question: 'What does the API reach?', parts: ['api', 'core'] }],
    ignore: [],
  },
  connections: [
    { from: 'api', to: 'core', imports: 3 },
    { from: 'core', to: 'db', imports: 1 },
  ],
  problems: [],
};

describe('viewsOf', () => {
  it('puts the whole map first, with every part, then the model’s views', () => {
    expect(viewsOf(map).map((v) => [v.id, v.parts.length])).toEqual([['whole', 3], ['front', 2]]);
    expect(viewsOf({ ...map, model: undefined })).toEqual([]);
  });
});

describe('viewModel', () => {
  it('draws only the view’s parts and the connections between them, labelled with their imports', () => {
    const [, front] = viewsOf(map);
    const model = viewModel(map, front);
    expect(model.nodes.map((n) => [n.id, n.symbol])).toEqual([['api', 'a.ts'], ['core', 'c.ts']]);
    expect(model.edges).toEqual([{ from: 'api', to: 'core', kind: 'calls', label: '3 imports' }]);
    expect(modelError(model)).toBeUndefined();
  });
});

describe('openingView', () => {
  it('opens on the model’s first view, or the whole map when it has none', () => {
    expect(openingView(map)).toBe('front');
    expect(openingView({ ...map, model: map.model && { ...map.model, views: [] } })).toBe('whole');
  });
});
