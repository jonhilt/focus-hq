import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import type { QaProof, QaReport } from '../../shared/types';
import { MAX_PROOFS, parseProofs, proofsToKeep, prove } from './qaProof';
import type { CommandRun } from './qaProofRules';

const report = (over: Partial<QaReport> = {}): QaReport => ({ verdict: 'fail', summary: 'Broken on restart.', checks: [], commands: [], captions: [], fixInstructions: 'Keep the hold.', ...over });
const test = (over: Partial<QaProof> = {}): QaProof => ({ kind: 'test', finding: 'loses the hold on restart', file: 'src/hold.proof.test.ts', command: 'pnpm vitest run src/hold.proof.test.ts', ...over });

const VITEST_FAIL = ` FAIL  src/hold.proof.test.ts > keeps the hold across a restart
AssertionError: expected 'idle' to be 'held' // Object.is equality

 Test Files  1 failed (1)
      Tests  1 failed (1)`;

describe('parseProofs', () => {
  it('keeps each proof with what its kind needs, and drops what it can’t read', () => {
    expect(parseProofs([
      { kind: 'test', finding: ' loses the hold ', file: 'a.proof.test.ts', command: 'vitest run a.proof.test.ts' },
      { kind: 'check', finding: 'doesn’t type-check', command: 'pnpm run typecheck', file: 'ignored' },
      { kind: 'screenshot', finding: 'blank page', screenshot: 2 },
      { kind: 'screenshot', finding: 'no number', screenshot: 'two' },
      { kind: 'vibes', finding: 'feels off' },
      null,
    ])).toEqual([
      { kind: 'test', finding: 'loses the hold', file: 'a.proof.test.ts', command: 'vitest run a.proof.test.ts' },
      { kind: 'check', finding: 'doesn’t type-check', command: 'pnpm run typecheck' },
      { kind: 'screenshot', finding: 'blank page', screenshot: 2 },
      { kind: 'screenshot', finding: 'no number', screenshot: undefined },
    ]);
    expect(parseProofs(undefined)).toEqual([]);
  });

  it(`checks at most ${MAX_PROOFS}`, () => {
    expect(parseProofs(Array.from({ length: 9 }, () => ({ kind: 'check', finding: 'x', command: 'make' })))).toHaveLength(MAX_PROOFS);
  });
});

describe('prove', () => {
  /** A checkout with `files` in it whose commands print `outputs` (by the file they name, else the command). */
  function rig(files: Record<string, string>, runs: Record<string, CommandRun>) {
    const ran: string[][] = [];
    return {
      ran,
      rig: {
        run: (args: string[]) => Effect.sync(() => (ran.push(args), runs[args.at(-1) ?? ''] ?? { code: 0, output: '' })),
        read: (file: string) => Effect.succeed(files[file]),
        changed: ['src/hold.ts'],
        shots: { taken: 0, kept: 0 },
      },
    };
  }

  it('runs each test where QA worked, and keeps the source of one that fails for the developer', () => {
    const { ran, rig: r } = rig({ 'src/hold.proof.test.ts': 'it("keeps the hold")' }, { 'src/hold.proof.test.ts': { code: 1, output: VITEST_FAIL } });
    const proven = Effect.runSync(prove(report({ proofs: [test()] }), r));
    expect(ran).toEqual([['pnpm', 'vitest', 'run', 'src/hold.proof.test.ts']]);
    expect(proven).toMatchObject({ verdict: 'fail', proofs: [{ outcome: 'failed', source: 'it("keeps the hold")', output: expect.stringContaining('AssertionError') }] });
  });

  it('runs nothing for a proof it can’t check, or a test that isn’t in the checkout: a fail on those is advice', () => {
    const { ran, rig: r } = rig({}, {});
    const proven = Effect.runSync(prove(report({ proofs: [test(), test({ command: 'pnpm test' }), { kind: 'screenshot', finding: 'blank', screenshot: 1 }] }), r));
    expect(ran).toEqual([]);
    expect(proven.proofs?.map((p) => p.note)).toEqual(["its file isn't in QA's checkout", "its command doesn't name its file, so it may run other tests", 'QA took 0 screenshots, not 1']);
    expect(proven).toMatchObject({ verdict: 'pass', advisory: true });
  });

  it('doesn’t keep the source of a probe that passed', () => {
    const { rig: r } = rig({ 'src/hold.proof.test.ts': 'source' }, {});
    expect(Effect.runSync(prove(report({ proofs: [test()] }), r)).proofs?.[0]).toEqual({ ...test(), outcome: 'passed', note: 'the test passed when Ops ran it' });
  });
});

describe('proofsToKeep', () => {
  it('hands the developer each test that held, with its source, to add to their branch, make pass and keep', () => {
    const lines = proofsToKeep(report({ proofs: [test({ outcome: 'failed', note: 'AssertionError', source: 'it("keeps the hold")' }), test({ file: 'b.proof.test.ts', outcome: 'passed' })] })).join('\n');
    expect(lines).toContain('`src/hold.proof.test.ts` fails with `pnpm vitest run src/hold.proof.test.ts`: AssertionError');
    expect(lines).toContain('it("keeps the hold")');
    expect(lines).toMatch(/Add it to your branch .*drop the `\.proof`.*keep it/);
    expect(lines).not.toContain('b.proof.test.ts');
  });

  it('is nothing when no proof held', () => {
    expect(proofsToKeep(report({ proofs: [test({ outcome: 'broken' })] }))).toEqual([]);
    expect(proofsToKeep(report())).toEqual([]);
  });
});
