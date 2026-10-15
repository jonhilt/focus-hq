import { describe, expect, it } from 'vitest';
import type { RepoMap } from './shared';
import { coverage, fitInto, hallViews, openingView, pickView, screenVersion, viewList, viewsOf } from './views';

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

describe('hallViews', () => {
  it('hangs every repo’s own views first, then each repo’s whole map, leaving out maps that failed', () => {
    const other: RepoMap = { ...MAP, repo: 'o/other' };
    const failed: RepoMap = { ...MAP, repo: 'o/failed', error: 'No model' };
    expect(hallViews([MAP, other, failed]).map(({ map, view }) => `${map.repo}#${view.id}`)).toEqual(['o/r#front', 'o/other#front', 'o/r#whole', 'o/other#whole']);
  });
});

describe('screenVersion', () => {
  it('changes with the commit mapped, and with the view', () => {
    const [whole, front] = viewsOf(MAP);
    expect(screenVersion(MAP, front)).not.toBe(screenVersion({ ...MAP, commit: 'abc' }, front));
    expect(screenVersion(MAP, front)).not.toBe(screenVersion(MAP, whole));
  });
});

describe('fitInto', () => {
  it('fits a drawing in a box as big as it goes without stretching, in the middle', () => {
    expect(fitInto(200, 100, { x: 0, y: 0, w: 400, h: 400 })).toEqual({ x: 0, y: 100, w: 400, h: 200 });
  });
});

describe('viewList', () => {
  it('lists each repo\'s views with their questions, or why it has none', () => {
    expect(viewList([MAP, { ...MAP, repo: 'o/bare', model: undefined, error: 'No model yet' }])).toBe(
      "o/r's views:\n- whole: every part, as a dependency matrix\n- front: What does the API reach? (2 parts)\n\no/bare: no views (No model yet).",
    );
  });
});

describe('pickView', () => {
  it('finds a view by id, and says when there\'s none or more than one repo has it', () => {
    const other: RepoMap = { ...MAP, repo: 'o/other', model: MAP.model && { ...MAP.model, views: [] } };
    expect(pickView([MAP, other], 'front')).toMatchObject({ map: { repo: 'o/r' }, view: { id: 'front' } });
    expect(pickView([MAP], 'nope')).toEqual({ error: 'There\'s no view "nope".' });
    expect(pickView([MAP, other], 'whole')).toEqual({ error: 'More than one repo has a view "whole": say which with repo (o/r, o/other).' });
  });
});
