import { describe, expect, it } from 'vitest';
import {
  direction, eslintCounts, fenceMetrics, gateMetrics, officeMetrics, render, scanSource, typecheckErrors, type GateResults, type Metric, type Scorecard,
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

describe('direction', () => {
  const m = (value: number, better: Metric['better'], format: Metric['format'] = 'count'): Metric => ({ section: 'fence', key: 'k', label: 'k', value, better, format });

  it('reads a drop as a climb when lower is better, and a rise as one when higher is', () => {
    expect(direction(m(3, 'lower'), 5)).toBe('better');
    expect(direction(m(7, 'lower'), 5)).toBe('worse');
    expect(direction(m(7, 'higher'), 5)).toBe('better');
    expect(direction(m(5, 'lower'), 5)).toBe('same');
  });

  it('lets time wobble up to 10% before calling it a change', () => {
    expect(direction(m(10.9, 'lower', 'seconds'), 10)).toBe('same');
    expect(direction(m(11.5, 'lower', 'seconds'), 10)).toBe('worse');
  });

  it('never calls a number with no better side a climb or a slip', () => {
    expect(direction(m(9, 'none'), 5)).toBe('same');
  });
});

describe('officeMetrics', () => {
  it('reads an empty ledger as zeros with no frictions', () => {
    const { metrics, frictions } = officeMetrics([], Date.now());
    expect(metrics.every((x) => x.value === 0)).toBe(true);
    expect(frictions).toEqual([]);
  });
});

describe('render', () => {
  const card = (typeAssertions: number, commit: string): Scorecard => ({
    v: 1, at: Date.UTC(2026, 9, 12, 9), commit, branch: 'main', dirty: false, notes: [], frictions: [{ key: 'shell: bash exit code 1', sessions: 48 }],
    metrics: [...gateMetrics(gate), ...fenceMetrics([{
      typeAssertions, nonNull: 0, explicitAny: 0, lintDisables: 0, tsSuppressions: 0, effectRuns: 0, importsEffect: false, machines: 0, importsFastCheck: false,
    }]), { section: 'office', key: 'office.merged', label: 'PRs merged', value: 3, better: 'none', format: 'count' }],
  });

  it('marks what climbed and what slipped since the scorecard before', () => {
    const text = render(card(200, 'bbbbbbbbbb'), card(222, 'aaaaaaaaaa'));
    expect(text).toContain('Changes since aaaaaaaa on main');
    expect(text).toMatch(/Type assertions \(as T\)\s+200\s+▲ −22/);
    expect(text).toMatch(/Gate passes\s+yes$/m);
    expect(text).toContain('48 sessions  shell: bash exit code 1');
  });

  it('says so when there is nothing to compare with', () => {
    expect(render(card(1, 'cccccccc'))).toContain('No earlier scorecard to compare with');
  });
});
