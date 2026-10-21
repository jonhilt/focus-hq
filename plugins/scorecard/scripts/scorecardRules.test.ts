import { describe, expect, it } from 'vitest';
import {
  effectMetrics, eslintCounts, failedTests, fenceMetrics, gateMetrics, opsMetrics, propertyTestFiles, render, resolveImport, scanSource, typecheckErrors, type GateResults, type Scorecard,
  type VitestReport,
} from './scorecardRules';

const scan = (source: string) => scanSource('a.ts', source);

describe('scanSource', () => {
  it('counts type assertions but not `as const`', () => {
    expect(scan('const a = x as Foo; const b = <Bar>y; const c = [1] as const;').typeAssertions).toBe(2);
  });

  it('counts non-null assertions and written-out any', () => {
    const counts = scan('function f(a: any): any[] { return [a!.b!]; }');
    expect(counts.nonNull).toBe(2);
    expect(counts.explicitAny).toBe(2);
  });

  it('counts suppressions only in comments, not in strings or templates', () => {
    const source = [
      '// eslint-disable-next-line no-console',
      '/* eslint-disable */',
      '// @ts-expect-error: the library is wrong',
      'const s = "// eslint-disable @ts-ignore";',
      'const t = `${s} // @ts-ignore ${s} /* eslint-disable */`;',
    ].join('\n');
    expect(scan(source)).toMatchObject({ lintDisables: 2, tsSuppressions: 1 });
  });

  it('counts each call that runs an Effect, however it is reached', () => {
    const source = `Effect.runPromise(a); runtime.runFork(b); Effect.runSyncExit(c); runCallback(d); Effect.run(e); runner.runPromised(f);`;
    expect(scan(source).effectRuns).toBe(4);
  });

  it('notices imports of effect and fast-check, and XState machines', () => {
    const counts = scan(`import { Schema } from 'effect/Schema'; import fc from 'fast-check'; const m = setup({}).createMachine({});`);
    expect(counts).toMatchObject({ importsEffect: true, importsFastCheck: true, machines: 1 });
    expect(scan(`import { x } from 'effective';`).importsEffect).toBe(false);
  });

  it('notices a file doing I/O: a Node module reaching outside, an await, a timer, a Promise or an AbortController', () => {
    for (const source of [
      `import { spawn } from 'node:child_process';`, `import fs from 'fs';`, `import { readFile } from 'node:fs/promises';`,
      `async function f() { await g(); }`, `setTimeout(f, 10);`, `const p = new Promise(f);`, `const c = new AbortController();`, `fetch(url);`,
    ]) expect(scan(source).doesIo, source).toBe(true);
  });

  it('leaves a file that only decides as not doing I/O, an XState machine or types from fs among them', () => {
    for (const source of [
      `import path from 'node:path'; export const f = (a: string) => path.join(a, 'b');`,
      `import { setup } from 'xstate'; export const m = setup({}).createMachine({});`,
      `import type { Stats } from 'node:fs'; export type R = () => Promise<Stats>;`,
      `import { type ChildProcess } from 'node:child_process'; export const alive = (c: ChildProcess) => !c.killed;`,
    ]) expect(scan(source).doesIo, source).toBe(false);
  });
});

describe('property tests', () => {
  const helper = [
    `import fc from 'fast-check';`,
    `export async function checkRestart() { await fc.assert(fc.property(fc.nat(), () => true)); }`,
    `export const checkAtOnce = () => fc.check(fc.property(fc.nat(), () => true));`,
    `export const now = (work: () => void) => work();`,
    `function quiet() { fc.assert(fc.property(fc.nat(), () => true)); }`,
  ].join('\n');

  it('names the exported functions that run fast-check, however fast-check is brought in', () => {
    expect(scanSource('h.ts', helper).propertyRunners).toEqual(['checkRestart', 'checkAtOnce']);
    expect(scan(`import * as fc from 'fast-check'; export default function run() { fc.assert(p); }`).propertyRunners).toEqual(['default']);
    expect(scan(`import { assert as holds } from 'fast-check'; export function run() { holds(p); }`).propertyRunners).toEqual(['run']);
    expect(scan(`import fc from 'fast-check'; export const arb = fc.nat(); export function run(t: T) { t.assert(p); }`).propertyRunners).toEqual([]);
  });

  it('keeps the names a file imports at runtime from its own files, not types or packages', () => {
    const counts = scan(`import { type A, checkRestart, now as soon } from './invariants'; import type { B } from '../b'; import * as c from '../c.js'; import d from './d'; import { e } from 'effect';`);
    expect(counts.localImports).toEqual([{ from: './invariants', names: ['checkRestart', 'now'] }, { from: '../c.js', names: ['*'] }, { from: './d', names: ['default'] }]);
  });

  it('finds the file an import reaches', () => {
    const files = new Set(['server/agents/invariants.ts', 'server/store/index.ts']);
    expect(resolveImport('server/agents/a.test.ts', './invariants', files)).toBe('server/agents/invariants.ts');
    expect(resolveImport('server/agents/a.test.ts', './invariants.js', files)).toBe('server/agents/invariants.ts');
    expect(resolveImport('server/agents/a.test.ts', '../store', files)).toBe('server/store/index.ts');
    expect(resolveImport('server/a.test.ts', './invariants', files)).toBeUndefined();
  });

  it('counts a test that imports fast-check, or calls a helper that runs its properties, but not one that only borrows from it', () => {
    const file = (name: string, source: string) => ({ file: name, ...scanSource(name, source) });
    const all = [
      file('server/agents/invariants.ts', helper),
      file('server/agents/direct.test.ts', `import fc from 'fast-check';`),
      file('server/agents/restart.test.ts', `import { checkRestart, type Subject } from './invariants';`),
      file('server/agents/whole.test.ts', `import * as inv from './invariants';`),
      file('server/agents/contract.test.ts', `import { now } from './invariants';`),
      file('server/agents/types.test.ts', `import type { checkRestart } from './invariants';`),
      file('server/other/far.test.ts', `import { checkRestart } from './invariants';`),
    ];
    const tests = all.filter((f) => f.file.endsWith('.test.ts'));
    expect(propertyTestFiles(tests, all).map((f) => f.file)).toEqual(['server/agents/direct.test.ts', 'server/agents/restart.test.ts', 'server/agents/whole.test.ts']);
  });
});

describe('effectMetrics', () => {
  const file = (importsEffect: boolean, doesIo: boolean) => ({ ...scan(''), importsEffect, doesIo });
  const value = (files: ReturnType<typeof file>[], key: string) => effectMetrics(files).find((m) => m.key === key)?.value;

  it('takes the share of the files doing I/O that are on Effect, leaving pure files out', () => {
    const files = [file(true, true), file(true, false), file(false, true), file(false, false), file(false, false)];
    expect(value(files, 'effect.ioShare')).toBeCloseTo(2 / 3);
    expect(value(files, 'effect.promiseIo')).toBe(1);
  });

  it('holds still when a pure file or an XState machine is added', () => {
    const files = [file(true, true), file(false, true)];
    const machine = { ...file(false, false), machines: 1 };
    expect(value([...files, file(false, false), machine], 'effect.ioShare')).toBe(value(files, 'effect.ioShare'));
  });

  it('slips when a file does I/O with Promises', () => {
    const files = [file(true, true), file(false, true)];
    expect(value([...files, file(false, true)], 'effect.ioShare')).toBeLessThan(value(files, 'effect.ioShare') ?? 0);
    expect(value([...files, file(false, true)], 'effect.promiseIo')).toBe(2);
  });

  it('reads no I/O at all as a share of 0', () => {
    expect(value([file(false, false)], 'effect.ioShare')).toBe(0);
  });
});

describe('the tools\' reports', () => {
  it('sums ESLint\'s errors and warnings over its files', () => {
    expect(eslintCounts([{ errorCount: 1, warningCount: 2 }, { errorCount: 0, warningCount: 3 }])).toEqual({ errors: 1, warnings: 5 });
  });

  it('counts tsc errors and the Effect language service\'s', () => {
    const output = "a.ts(1,1): error TS2322: no\nb.ts(2,2): error TS7006: no\nChecked 3 files.\n1 error, 0 warnings and 0 messages.";
    expect(typecheckErrors(output)).toBe(3);
    expect(typecheckErrors('Checked 376 files out of 376 files.\n0 errors, 0 warnings and 0 messages.')).toBe(0);
  });
});

const step = { pass: true, seconds: 10 };
const gate: GateResults = { typecheck: { ...step, errors: 0 }, lint: { ...step, errors: 0, warnings: 0 }, test: { ...step, tests: 5, failed: 0 }, build: step };

describe('gateMetrics', () => {
  it('passes only when every step does, and adds up the time', () => {
    const value = (g: GateResults, key: string) => gateMetrics(g).find((m) => m.key === key)?.value;
    expect(value(gate, 'gate.pass')).toBe(1);
    expect(value(gate, 'gate.seconds')).toBe(40);
    expect(value({ ...gate, build: { pass: false, seconds: 1 } }, 'gate.pass')).toBe(0);
  });
});

describe('failedTests', () => {
  const test = (title: string, status: string, failureMessages: string[] | null = null) => ({ ancestorTitles: ['the bridge'], title, status, failureMessages });
  const report = (testResults: VitestReport['testResults']): VitestReport => ({ numTotalTests: 0, numFailedTests: 0, testResults });

  it('names each failed test, why it failed, and how to run it again on the same seed', () => {
    const lines = failedTests(report([
      { name: '/repo/server/a.test.ts', status: 'failed', message: '', assertionResults: [
        test('seats the lead', 'passed'),
        test('sends the QA (officer) home', 'failed', ['AssertionError: expected 1 to be 2\n    at a.test.ts:4:2']),
      ] },
      { name: '/repo/server/b.test.ts', status: 'passed', message: '', assertionResults: [test('docks', 'passed')] },
    ]), '/repo', 7);
    expect(lines).toEqual([
      "server/a.test.ts › the bridge › sends the QA (officer) home: AssertionError: expected 1 to be 2\n"
        + "  FOCUS_TEST_SEED=7 pnpm test server/a.test.ts -t 'sends the QA \\(officer\\) home'",
    ]);
  });

  it('names a file that failed before any of its tests ran', () => {
    const lines = failedTests(report([{ name: '/repo/shared/c.test.ts', status: 'failed', message: "Cannot find module './gone'\nRequire stack", assertionResults: [] }]), '/repo', 1);
    expect(lines).toEqual(["shared/c.test.ts: Cannot find module './gone'\n  FOCUS_TEST_SEED=1 pnpm test shared/c.test.ts"]);
  });

  it('says nothing when everything passed', () => {
    expect(failedTests(report([{ name: '/repo/a.test.ts', status: 'passed', message: '', assertionResults: [test('docks', 'passed')] }]), '/repo', 1)).toEqual([]);
  });
});

describe('opsMetrics', () => {
  it('reads an empty ledger as zeros with no frictions', () => {
    const { metrics, frictions } = opsMetrics([], Date.now());
    expect(metrics.every((x) => x.value === 0)).toBe(true);
    expect(frictions).toEqual([]);
  });
});

describe('render', () => {
  const card = (typeAssertions: number, commit: string): Scorecard => ({
    v: 1, at: Date.UTC(2026, 9, 12, 9), commit, branch: 'main', dirty: false, notes: [], frictions: [{ key: 'shell: bash exit code 1', sessions: 48 }],
    metrics: [...gateMetrics(gate), ...fenceMetrics([{
      typeAssertions, nonNull: 0, explicitAny: 0, lintDisables: 0, tsSuppressions: 0, effectRuns: 0, importsEffect: false, doesIo: false, machines: 0, importsFastCheck: false, localImports: [], propertyRunners: [],
    }]), { section: 'office', key: 'office.merged', label: 'PRs merged', value: 3, better: 'none', format: 'count' }],
  });

  it('marks what climbed and what slipped since the scorecard before', () => {
    const text = render(card(200, 'bbbbbbbbbb'), card(222, 'aaaaaaaaaa'));
    expect(text).toContain('Changes since main @ aaaaaaaa');
    expect(text).toMatch(/Type assertions \(as T\)\s+200\s+▲ −22/);
    expect(text).toMatch(/Gate passes\s+yes$/m);
    expect(text).toContain('48 sessions  shell: bash exit code 1');
  });

  it('leaves out a change too small to show', () => {
    const was = card(200, 'aaaaaaaaaa');
    const now = card(200, 'bbbbbbbbbb');
    now.metrics.push({ section: 'office', key: 'office.wasted', label: 'Wasted', value: 5.42, better: 'lower', format: 'ratio' });
    was.metrics.push({ section: 'office', key: 'office.wasted', label: 'Wasted', value: 5.40, better: 'lower', format: 'ratio' });
    expect(render(now, was)).toMatch(/Wasted\s+5\.4$/m);
  });

  it('says so when there is nothing to compare with', () => {
    expect(render(card(1, 'cccccccc'))).toContain('No earlier scorecard to compare with');
  });
});
