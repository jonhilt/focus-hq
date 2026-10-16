import { describe, expect, it } from 'vitest';
import { findings, FINDINGS_MAX, headline } from './findings';
import type { RepoMap } from './shared';
import { MAP } from './views.test';

// API and Core import each other; Core and the Store don't, but change together; three parts import the hub
const map: RepoMap = {
  ...MAP,
  model: { ...MAP.model!, parts: [...MAP.model!.parts, { id: 'ui', label: 'UI', layer: 'Client', kind: 'ui', paths: ['u.ts'] }, { id: 'hub', label: 'Hub', layer: 'Shared', kind: 'service', paths: ['h.ts'] }] },
  connections: [
    ...MAP.connections,
    { from: 'api', to: 'hub', imports: 4, names: ['x'] },
    { from: 'core', to: 'hub', imports: 2, names: ['y'] },
    { from: 'ui', to: 'hub', imports: 1, names: ['z'] },
  ],
  history: {
    days: 90,
    commits: 50,
    parts: [{ id: 'hub', commits: 30, lines: 900 }, { id: 'api', commits: 10, lines: 100 }],
    coupling: [{ a: 'ui', b: 'db', together: 8, either: 20, imports: false }, { a: 'api', b: 'core', together: 9, either: 12, imports: true }],
  },
};

describe('findings', () => {
  it('says where to look, the worst of each kind first, each on the cells it is about', () => {
    const found = findings(map);
    expect(found.map((f) => f.kind)).toEqual(['ripple', 'hidden', 'tangle']);
    expect(found[0].sentence).toBe('Hub is imported by 3 parts and changed in 30 commits in 90 days: its changes reach furthest.');
    expect(found[0].cells).toEqual([{ from: 'api', to: 'hub' }, { from: 'core', to: 'hub' }, { from: 'ui', to: 'hub' }]);
    expect(found[1].sentence).toBe('UI and Store changed together in 8 of 20 commits with no import between them: what ties them isn’t on the map.');
    expect(found[2].sentence).toBe('API and Core import each other (3 one way, 1 back): a change to either tends to need the other.');
    expect(found[2].cells).toEqual([{ from: 'api', to: 'core' }, { from: 'core', to: 'api' }]);
  });

  it('says two parts that change together talk over the wire, when a recorded run says they do', () => {
    const talking: RepoMap = { ...map, flows: [{ from: 'ui', to: 'db', via: 'http', names: ['GET /x'], count: 2 }] };
    expect(findings(talking).find((f) => f.kind === 'hidden')?.sentence).toMatch(/they talk over the wire, which this grid doesn’t show\.$/);
  });

  it('keeps to a few, and finds nothing where nothing stands out', () => {
    expect(findings(map).length).toBeLessThanOrEqual(FINDINGS_MAX);
    expect(findings({ ...MAP, connections: [{ from: 'api', to: 'core', imports: 1, names: ['a'] }] })).toEqual([]);
  });

  it('heads the matrix with its size and what stands out, in a line', () => {
    expect(headline(map)).toBe('5 parts, 6 connections: 1 pair imports each other; 1 pair changes together with no import between them.');
    expect(headline({ ...MAP, connections: [] })).toBe('3 parts, 0 connections: no two parts import each other.');
  });
});
