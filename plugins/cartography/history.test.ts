import { describe, expect, it } from 'vitest';
import { COUPLING, type Commit, HISTORY_DAYS, historyOf, pointOf, readLog, SERIES_POINTS, seriesSpans, SWEEP_FILES } from './history';

describe('readLog', () => {
  it('reads each commit, the files it changed and how many lines, a binary file as none', () => {
    const text = '\x1eaaa\x1f2026-10-15T10:00:00+01:00\n\n3\t1\tserver/a.ts\n-\t-\tclient/logo.png\n\x1ebbb\x1f2026-10-14T09:00:00+01:00\n\n10\t0\tshared/t.ts\n';
    expect(readLog(text)).toEqual([
      { sha: 'aaa', date: '2026-10-15T10:00:00+01:00', files: [{ path: 'server/a.ts', lines: 4 }, { path: 'client/logo.png', lines: 0 }] },
      { sha: 'bbb', date: '2026-10-14T09:00:00+01:00', files: [{ path: 'shared/t.ts', lines: 10 }] },
    ]);
    expect(readLog('')).toEqual([]);
  });
});

/** A commit changing `paths`, a line each. */
const commit = (i: number, ...paths: string[]): Commit => ({ sha: `c${i}`, date: '2026-10-15', files: paths.map((path) => ({ path, lines: 1 })) });
const owner = (file: string) => file.split('/')[0];

describe('historyOf', () => {
  it('counts each part’s commits and lines, the most changed first, leaving out what no part owns', () => {
    const owned = (f: string) => (f.startsWith('docs/') ? undefined : owner(f));
    const h = historyOf([commit(1, 'server/a.ts', 'server/b.ts', 'shared/t.ts'), commit(2, 'server/a.ts'), commit(3, 'docs/x.md')], owned, []);
    expect(h.commits).toBe(2);
    expect(h.parts.map(({ id, commits, lines }) => ({ id, commits, lines }))).toEqual([{ id: 'server', commits: 2, lines: 3 }, { id: 'shared', commits: 1, lines: 1 }]);
  });

  it('counts each part’s commits over time, by the day for a young history, ending when the log was read', () => {
    const on = (i: number, date: string, ...paths: string[]): Commit => ({ ...commit(i, ...paths), date });
    const commits = [on(1, '2026-10-17T09:00:00Z', 'server/a.ts'), on(2, '2026-10-16T09:00:00Z', 'server/a.ts', 'client/b.ts'), on(3, '2026-10-14T09:00:00Z', 'client/b.ts')];
    const h = historyOf(commits, owner, [], Date.parse('2026-10-17T12:00:00Z'));
    expect(h.step).toBe(1);
    expect(h.series).toEqual([1, 0, 1, 1]);
    expect(h.parts.find((p) => p.id === 'server')?.series).toEqual([0, 0, 1, 1]);
    expect(h.parts.find((p) => p.id === 'client')?.series).toEqual([1, 0, 1, 0]);
  });

  it('finds the parts that change together, and says whether an import links them', () => {
    const commits = [
      ...Array.from({ length: 6 }, (_, i) => commit(i, 'server/a.ts', 'client/b.ts')),
      ...Array.from({ length: 6 }, (_, i) => commit(10 + i, 'server/a.ts', 'shared/t.ts')),
      commit(20, 'client/b.ts'),
      // together, but not often enough to say
      ...Array.from({ length: COUPLING.together - 1 }, (_, i) => commit(30 + i, 'shared/t.ts', 'plugins/p.ts')),
    ];
    const h = historyOf(commits, owner, [{ from: 'server', to: 'shared', imports: 4, names: ['T'] }]);
    expect(h.coupling).toEqual([
      // client and server: 6 of the 13 commits that touched either, and nothing imports across
      { a: 'client', b: 'server', together: 6, either: 13, imports: false },
      { a: 'server', b: 'shared', together: 6, either: 16, imports: true },
    ]);
  });

  it('counts a sweep’s changes, but doesn’t couple everything it touched', () => {
    const sweep = commit(1, ...Array.from({ length: SWEEP_FILES + 1 }, (_, i) => (i % 2 ? `server/${i}.ts` : `client/${i}.ts`)));
    const h = historyOf(Array.from({ length: COUPLING.together }, () => sweep), owner, []);
    expect(h.parts.map((p) => p.commits)).toEqual([COUPLING.together, COUPLING.together]);
    expect(h.coupling).toEqual([]);
  });
});

describe('seriesSpans', () => {
  const day = 24 * 3600 * 1000;
  it('cuts a history into at most SERIES_POINTS points, a day each while it’s young', () => {
    expect(seriesSpans(0, 13.5 * day)).toEqual({ step: 1, points: 14 });
    expect(seriesSpans(0, 200 * day)).toEqual({ step: Math.ceil(HISTORY_DAYS / SERIES_POINTS), points: Math.ceil(HISTORY_DAYS / Math.ceil(HISTORY_DAYS / SERIES_POINTS)) });
    expect(seriesSpans(5, 5)).toEqual({ step: 1, points: 1 });
  });

  it('puts a commit in the point its date falls in, the last ending at `until`, and none outside', () => {
    const spans = { step: 3, points: 4 };
    const until = Date.parse('2026-10-17T00:00:00Z');
    expect(pointOf('2026-10-16T12:00:00Z', until, spans)).toBe(3);
    expect(pointOf('2026-10-13T12:00:00Z', until, spans)).toBe(2);
    expect(pointOf('2026-09-01T00:00:00Z', until, spans)).toBe(-1);
    expect(pointOf('2026-10-18T00:00:00Z', until, spans)).toBe(-1);
  });
});
