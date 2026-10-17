import { describe, expect, it } from 'vitest';
import { changedLines, changedSummary, crapScore, distribution, type FileCoverage, functionsIn, overByFile, score, summary, touched, type Scored } from './crapScore';

describe('crapScore', () => {
  it('is just the complexity when fully covered', () => {
    expect(crapScore(12, 1)).toBe(12);
  });

  it('is complexity squared plus complexity with no coverage', () => {
    expect(crapScore(6, 0)).toBe(42);
  });

  it('crosses 30 at about complexity 12 half covered', () => {
    expect(crapScore(12, 0.5)).toBe(30);
  });
});

describe('functionsIn', () => {
  const only = (source: string) => functionsIn('a.ts', source);

  it('counts a straight-line function as 1', () => {
    expect(only('function f() { return 1; }')).toMatchObject([{ name: 'f', complexity: 1, line: 1 }]);
  });

  it('counts each if, loop, case, catch, ternary and logical operator', () => {
    const source = `function f(a, b = 1) {
      if (a) {}
      for (const x of a) {}
      while (a) {}
      switch (a) { case 1: break; case 2: break; default: }
      try {} catch {}
      const c = a ? 1 : 2;
      return a && b || c ?? a?.b;
    }`;
    // 1 + default param + if + for + while + 2 cases + catch + ternary + && + || + ?? + ?.
    expect(only(source)[0].complexity).toBe(13);
  });

  it("keeps a nested function's branches out of its parent's count", () => {
    const fns = only('function outer(a) { if (a) {} return [1].map((x) => x ? 1 : 2); }');
    expect(fns.map((f) => [f.name, f.complexity])).toEqual([['outer', 2], ['(callback to [1].map)', 2]]);
  });

  it('names methods after their class, and arrows after what they are assigned to', () => {
    const fns = only('class Ship { warp() {} constructor() {} }\nconst engage = () => 1;');
    expect(fns.map((f) => f.name)).toEqual(['Ship.warp', 'Ship.constructor', 'engage']);
  });

  it('records where each function starts and ends, lines from 1', () => {
    expect(only('\nfunction f() {\n  return 1;\n}')[0]).toMatchObject({ line: 2, column: 0, endLine: 4, endColumn: 1 });
  });
});

describe('score', () => {
  const source = 'function outer(a) {\n  if (a) return 1;\n  return [1].map((x) => {\n    return x;\n  });\n}';
  const fns = functionsIn('a.ts', source);
  const coverage = (covered: boolean[]): FileCoverage => ({
    statements: [
      { line: 2, column: 2, covered: covered[0] },
      { line: 2, column: 9, covered: covered[1] },
      { line: 3, column: 2, covered: covered[2] },
      { line: 4, column: 4, covered: covered[3] },
    ],
    functions: [],
  });

  it("gives each statement to the innermost function it's in", () => {
    const [outer, inner] = score(fns, coverage([true, false, true, false]));
    expect(outer.coverage).toBeCloseTo(2 / 3);
    expect(inner.coverage).toBe(0);
  });

  it('scores a file the tests never loaded as uncovered', () => {
    const [outer] = score(fns, undefined);
    expect(outer).toMatchObject({ coverage: 0, crap: crapScore(2, 0) });
  });

  it('counts a function with no statements of its own as covered if it ran', () => {
    const [arrow] = score(functionsIn('a.ts', 'const double = (x) => x * 2;'), { statements: [], functions: [{ line: 1, covered: true }] });
    expect(arrow.coverage).toBe(1);
  });
});

describe('changedLines', () => {
  it('reads the new side of each hunk, per file, and skips pure deletions', () => {
    const diff = [
      'diff --git a/server/a.ts b/server/a.ts',
      '--- a/server/a.ts',
      '+++ b/server/a.ts',
      '@@ -3,0 +4,2 @@',
      '@@ -10 +12 @@',
      '@@ -20,3 +23,0 @@',
      'diff --git a/server/gone.ts b/server/gone.ts',
      '--- a/server/gone.ts',
      '+++ /dev/null',
      '@@ -1,5 +0,0 @@',
    ].join('\n');
    expect([...changedLines(diff)]).toEqual([['server/a.ts', [[4, 5], [12, 12]]]]);
  });
});

describe('touched', () => {
  const fn = functionsIn('a.ts', '\n\nfunction f() {\n  return 1;\n}')[0];

  it('is true when a changed range overlaps the function', () => {
    expect(touched(fn, new Map([['a.ts', [[4, 4]]]]))).toBe(true);
  });

  it('is false for changes outside it or in another file', () => {
    expect(touched(fn, new Map([['a.ts', [[1, 2]]], ['b.ts', [[3, 5]]]]))).toBe(false);
  });
});

describe('reports', () => {
  const rows = score(functionsIn('a.ts', 'function simple() {}\nfunction tangled(a) { if (a) {} if (a) {} if (a) {} if (a) {} if (a) {} if (a) {} }'), undefined);

  it('buckets functions by score', () => {
    // simple: 1; tangled: complexity 7, uncovered, 56
    expect(distribution(rows)).toEqual([1, 0, 0, 1, 0]);
  });

  it('summarises the scope with the riskiest first', () => {
    const text = summary(rows, 10);
    expect(text).toContain('2 functions, 1 over 30 (50.0%)');
    expect(text.indexOf('tangled')).toBeLessThan(text.indexOf('simple'));
  });

  it("lists only touched functions over the line in a branch's summary", () => {
    const text = changedSummary(rows, new Map([['a.ts', [[2, 2]]]]), 'main');
    expect(text).toContain('Touched since main: 1 functions, total CRAP 56, 1 over 30');
    expect(text).toContain('a.ts:2 tangled');
  });
});

describe('overByFile', () => {
  const fn = (file: string, crap: number): Scored => ({ file, name: 'f', line: 1, column: 0, endLine: 2, endColumn: 0, complexity: 1, coverage: 0, crap });

  it('counts each file\'s functions over 30, leaving out files with none and a function at exactly 30', () => {
    expect(overByFile([fn('b.ts', 31), fn('a.ts', 90), fn('a.ts', 40), fn('a.ts', 30), fn('c.ts', 12)])).toEqual({ 'a.ts': 2, 'b.ts': 1 });
  });
});
