import { describe, expect, it } from 'vitest';
import { MINIATURE, miniature, miniatureKey } from './miniature';
import type { RepoMap } from './shared';
import { MAP } from './views.test';

const twoServers: RepoMap = {
  ...MAP,
  sizes: { api: 9, core: 1, db: 4, jobs: 1 },
  model: { ...MAP.model!, parts: [...MAP.model!.parts, { id: 'jobs', label: 'Jobs', layer: 'Server', kind: 'job', paths: ['j.ts'] }] },
};

describe('miniature', () => {
  it('stands each layer as a ring, the first on top, every part over the table', () => {
    const { parts } = miniature([twoServers]);
    const y = (key: string) => parts.find((p) => p.key === key)?.y;
    expect(y('o/r#api')).toBe(MINIATURE.high);
    expect(y('o/r#jobs')).toBe(MINIATURE.high);
    expect(y('o/r#db')).toBeCloseTo(MINIATURE.low, 9);
    for (const p of parts) expect(Math.hypot(p.x, p.z) + p.size).toBeLessThan(MINIATURE.radius + MINIATURE.biggest);
  });

  it('makes the biggest part the biggest, and colours a layer alike', () => {
    const { parts } = miniature([twoServers]);
    const api = parts.find((p) => p.key === 'o/r#api');
    expect(api?.size).toBe(MINIATURE.biggest);
    expect(parts.find((p) => p.key === 'o/r#jobs')?.colour).toBe(api?.colour);
    expect(parts.find((p) => p.key === 'o/r#core')?.colour).not.toBe(api?.colour);
  });

  it('links the parts that import each other, and leaves out maps that failed', () => {
    const { parts, links } = miniature([MAP, { ...MAP, repo: 'o/failed', error: 'No model' }]);
    expect(parts).toHaveLength(3);
    expect(links.map(([a, b]) => `${parts[a].key}>${parts[b].key}`)).toEqual(['o/r#api>o/r#core', 'o/r#core>o/r#db', 'o/r#core>o/r#api']);
  });

  it('is empty with nothing mapped, and changes its key with a new commit', () => {
    expect(miniature([])).toEqual({ parts: [], links: [] });
    expect(miniatureKey([MAP])).not.toBe(miniatureKey([{ ...MAP, commit: 'abc' }]));
  });
});
