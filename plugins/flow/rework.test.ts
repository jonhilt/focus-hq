import { describe, expect, it } from 'vitest';
import { commitLines, countedFiles, countsFile, landedCommits, parentCount, REWORK_MS, reworkLines, reworkTotals, settledAt, survivalOf, survivingLines } from './rework';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);

describe('survivingLines', () => {
  it('counts the lines of a blame that still come from the pull request’s commits', () => {
    const porcelain = [
      `${A} 1 1 2`, 'author Lt. L', 'filename x.ts', '\tconst a = 1;',
      `${A} 2 2`, '\tconst b = 2;',
      `${B} 7 3 1`, 'author Someone', 'filename x.ts', '\tconst c = 3;',
      `${C} 1 4 1`, 'filename x.ts', `\t${A} 9 9 is in the code, not a header`,
    ].join('\n');
    expect(survivingLines(porcelain, new Set([A]))).toBe(2);
    expect(survivingLines(porcelain, new Set([A, C]))).toBe(3);
    expect(survivingLines('', new Set([A]))).toBe(0);
  });
});

describe('countsFile', () => {
  it('leaves out lines no one writes by hand', () => {
    expect(['server/agents/flow.ts', 'docs/flow.md', 'blender/kit.py'].every(countsFile)).toBe(true);
    expect(['pnpm-lock.yaml', 'client/public/ship/deck.glb', 'docs/board.jpg', 'dist/index.js', 'Courses.Api/packages.lock.json'].some(countsFile)).toBe(false);
  });
});

describe('reworkTotals', () => {
  const pr = (pr: number, added: number, survived: number, settled = true) => ({ repo: 'o/web', pr, mergedAt: 0, added, survived, settled });
  it('sums the lines added and reworked, and names the pull requests with the most', () => {
    const t = reworkTotals([pr(1, 100, 90), pr(2, 50, 50), pr(3, 20, 0, false), pr(4, 10, 12)]);
    expect(t).toMatchObject({ prs: 4, settled: 3, added: 180, reworked: 30, rate: 30 / 180 });
    expect(t.worst.map((p) => [p.pr, p.reworked])).toEqual([[3, 20], [1, 10]]);
    expect(reworkLines(t)).toEqual([
      '  rework after merge: 30 of 180 lines added were changed or deleted within 7 days (17%) · 4 pull requests, 3 past 7 days (the rest so far)',
      '       20 of 20    web#3',
      '       10 of 100   web#1',
    ]);
  });

  it('says so when there’s nothing to measure', () => {
    expect(reworkLines(reworkTotals([]))).toEqual(['  rework after merge: no merged pull requests to measure']);
  });
});

describe('landedCommits', () => {
  const c = (oid: string, subject: string) => ({ oid, subject });
  const own = [c('p1', 'Store saved items'), c('p2', 'Show them in the header')];
  it('keeps a merged pull request’s own commits under a true merge commit', () => {
    expect([...landedCommits(own, 'm', 2, [])]).toEqual(['p1', 'p2', 'm']);
  });

  it('adds the commits it was rebased onto the base as, by their messages, and not the base’s own before them', () => {
    const chain = [c('r2', 'Show them in the header'), c('r1', 'Store saved items'), c('older', 'Someone else’s fix')];
    expect([...landedCommits(own, 'r2', 1, chain)]).toEqual(['p1', 'p2', 'r2', 'r1']);
  });

  it('counts a squash as its one commit, leaving the base’s commits before it alone', () => {
    const chain = [c('s', 'Saved items (#12)'), c('older', 'Someone else’s fix')];
    expect([...landedCommits(own, 's', 1, chain)]).toEqual(['p1', 'p2', 's']);
  });
});

describe('settledAt', () => {
  it('is REWORK_DAYS after the merge once that has passed, and nothing while it is still counting', () => {
    expect(settledAt(1000, 1000 + REWORK_MS)).toBe(1000 + REWORK_MS);
    expect(settledAt(1000, 999 + REWORK_MS)).toBeUndefined();
  });
});

describe('what git says', () => {
  const sha = (c: string) => c.repeat(40);
  it('counts a merge commit\'s parents from its rev-list line', () => {
    expect(parentCount(`${sha('m')} ${sha('a')} ${sha('b')}\n`)).toBe(2);
    expect(parentCount(`${sha('s')} ${sha('a')}`)).toBe(1);
  });

  it('reads a log of hashes and subjects, a commit a line', () => {
    expect(commitLines(`${sha('a')} Store saved items\n${sha('b')} Show them: in the header\n`)).toEqual([
      { oid: sha('a'), subject: 'Store saved items' },
      { oid: sha('b'), subject: 'Show them: in the header' },
    ]);
  });
});

describe('countedFiles', () => {
  it('keeps the hand-written files that gained lines', () => {
    const files = [{ path: 'src/a.ts', additions: 3 }, { path: 'src/b.ts', additions: 0 }, { path: 'pnpm-lock.yaml', additions: 90 }];
    expect(countedFiles(files)).toEqual([{ path: 'src/a.ts', additions: 3 }]);
  });
});

describe('survivalOf', () => {
  it('sums lines added and surviving, never counting more of a file as surviving than it gained', () => {
    expect(survivalOf([{ additions: 10, surviving: 4 }, { additions: 2, surviving: 5 }])).toEqual({ added: 12, survived: 6 });
    expect(survivalOf([])).toEqual({ added: 0, survived: 0 });
  });
});
