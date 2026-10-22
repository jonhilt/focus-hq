import { describe, expect, it } from 'vitest';
import { bandOrder, chartRedraw, MINI_LINKS, miniature, miniatureKey } from './miniature';
import type { RepoMap } from './shared';
import { MAP } from './views.test';

const twoServers: RepoMap = {
  ...MAP,
  sizes: { api: 9, core: 1, db: 4, jobs: 1 },
  model: { ...MAP.model!, parts: [...MAP.model!.parts, { id: 'jobs', label: 'Jobs', layer: 'Server', kind: 'job', paths: ['j.ts'] }] },
  history: { days: 90, commits: 10, parts: [{ id: 'core', commits: 8, lines: 80 }, { id: 'api', commits: 2, lines: 5 }], coupling: [] },
};

describe('miniature', () => {
  it('stands each layer as a band, in the model’s order of layers, every part along its own', () => {
    const { bands, parts } = miniature([twoServers]);
    expect(bands.map((b) => b.layer)).toEqual(['Server', 'Domain', 'Data']);
    const band = (key: string) => parts.find((p) => p.key === key)?.band;
    expect([band('o/r#api'), band('o/r#jobs'), band('o/r#core'), band('o/r#db')]).toEqual([0, 0, 1, 2]);
    for (const p of parts) {
      expect(p.at).toBeGreaterThan(0);
      expect(p.at).toBeLessThan(1);
    }
  });

  it('makes the biggest part the biggest, the busiest the brightest, and colours a layer alike', () => {
    const { parts } = miniature([twoServers]);
    const part = (id: string) => parts.find((p) => p.key === `o/r#${id}`);
    expect(part('api')?.size).toBe(1);
    expect(part('core')?.size).toBeCloseTo(1 / 3, 9);
    expect(part('core')?.bright).toBe(1);
    expect(part('api')?.bright).toBe(0.25);
    // a part the history never saw changed is dim; with no history at all, nothing says any part is quiet
    expect(part('db')?.bright).toBe(0);
    expect(miniature([MAP]).parts.every((p) => p.bright === 1)).toBe(true);
    const still: RepoMap = { ...MAP, history: { days: 90, commits: 0, parts: [], coupling: [] } };
    expect(miniature([still]).parts.every((p) => p.bright === 1)).toBe(true);
    expect(part('jobs')?.colour).toBe(part('api')?.colour);
    expect(part('core')?.colour).not.toBe(part('api')?.colour);
  });

  it('links the parts that import each other, the heaviest first, and leaves out maps that failed', () => {
    const { parts, links, imports } = miniature([MAP, { ...MAP, repo: 'o/failed', error: 'No model' }]);
    expect(parts).toHaveLength(3);
    expect(imports).toBe(3);
    expect(links.map((l) => `${parts[l.from].key}>${parts[l.to].key} ${l.imports}`)).toEqual(['o/r#api>o/r#core 3', 'o/r#core>o/r#db 1', 'o/r#core>o/r#api 1']);
  });

  it('draws every heavy import, and the heaviest few whatever they weigh, but not every light one', () => {
    const many = Array.from({ length: MINI_LINKS.least + 4 }, (_, i) => `p${i}`);
    const map: RepoMap = {
      ...MAP,
      sizes: {},
      model: { parts: many.map((id) => ({ id, label: id, layer: 'One', kind: 'service', paths: [`${id}/`] })), views: [], ignore: [] },
      connections: [{ from: 'p0', to: 'p1', imports: MINI_LINKS.heavy + 1, names: [] }, ...many.slice(2).map((id) => ({ from: 'p0', to: id, imports: 1, names: [] }))],
    };
    const { links, imports } = miniature([map]);
    expect(imports).toBe(many.length - 1);
    expect(links).toHaveLength(MINI_LINKS.least);
    expect(links[0].imports).toBe(MINI_LINKS.heavy + 1);
  });

  it('is empty with nothing mapped, and changes its key with a new commit', () => {
    expect(miniature([])).toEqual({ bands: [], parts: [], links: [], imports: 0 });
    expect(miniatureKey([MAP])).not.toBe(miniatureKey([{ ...MAP, commit: 'abc' }]));
  });
});

describe('chartRedraw', () => {
  it('draws a chart again when its project’s maps change, and leaves it while they don’t', () => {
    const first = chartRedraw('', [MAP]);
    expect(first).toEqual({ key: miniatureKey([MAP]), miniature: miniature([MAP]) });
    expect(chartRedraw(first?.key ?? '', [MAP])).toBeUndefined();
    expect(chartRedraw(first?.key ?? '', [{ ...MAP, commit: 'abc' }])?.key).toBe(miniatureKey([{ ...MAP, commit: 'abc' }]));
  });

  it('draws a project with no maps once, as unmapped', () => {
    expect(chartRedraw('', [])).toEqual({ key: 'unmapped', miniature: miniature([]) });
    expect(chartRedraw('unmapped', [])).toBeUndefined();
  });
});

describe('bandOrder', () => {
  it('stands each part beside what it’s tied to, so the lines between bands run short', () => {
    // top band: a, b; bottom band: c, d. a is tied to d and b to c, so the bottom band swaps to sit under them
    const at = bandOrder([0, 0, 1, 1], [{ from: 0, to: 3, imports: 9 }, { from: 1, to: 2, imports: 9 }]);
    expect(at[0] < at[1]).toBe(at[3] < at[2]);
  });

  it('spaces each band’s parts evenly, and keeps the model’s order where nothing pulls', () => {
    expect(bandOrder([0, 0, 0, 1], [])).toEqual([1 / 6, 0.5, 5 / 6, 0.5]);
  });
});
