import { describe, expect, it } from 'vitest';
import type { QaProof, QaReport } from '../../shared/types';
import { blocksWithProof, commandArgs, type CommandRun, proofOutcome, proofProblem, provenReport, screenshotOutcome, touchesUi } from './qaProofRules';

const report = (over: Partial<QaReport> = {}): QaReport => ({ verdict: 'fail', summary: 'Broken on restart.', checks: [], commands: [], captions: [], fixInstructions: 'Keep the hold.', ...over });
const test = (over: Partial<QaProof> = {}): QaProof => ({ kind: 'test', finding: 'loses the hold on restart', file: 'src/hold.proof.test.ts', command: 'pnpm vitest run src/hold.proof.test.ts', ...over });

const VITEST_FAIL = ` FAIL  src/hold.proof.test.ts > keeps the hold across a restart
AssertionError: expected 'idle' to be 'held' // Object.is equality

 Test Files  1 failed (1)
      Tests  1 failed (1)`;
const VITEST_UNLOADED = ` FAIL  src/hold.proof.test.ts [ src/hold.proof.test.ts ]
Error: Failed to load url ./hlod (resolved id: ./hlod) in src/hold.proof.test.ts. Does the file exist?

 Test Files  1 failed (1)
      Tests  no tests`;

describe('commandArgs', () => {
  it('splits plain words and quotes as a shell would', () => {
    expect(commandArgs('pnpm vitest run "src/a b.proof.test.ts" -t \'keeps it\'')).toEqual(['pnpm', 'vitest', 'run', 'src/a b.proof.test.ts', '-t', 'keeps it']);
    expect(commandArgs('  go   test ./pkg ')).toEqual(['go', 'test', './pkg']);
  });

  it('refuses a command that needs a shell, an open quote, or nothing', () => {
    for (const c of ['pnpm test | tail', 'cd x && pnpm test', 'pnpm test; rm -rf /', 'pnpm test > out', 'echo $HOME', 'echo `id`', 'say "unclosed', '   ']) expect(commandArgs(c)).toBeUndefined();
    expect(commandArgs('vitest run -t "a | b"')).toEqual(['vitest', 'run', '-t', 'a | b']);
  });
});

describe('proofProblem', () => {
  it('takes a test whose command names its file, a check with a command, and a numbered screenshot', () => {
    expect(proofProblem(test())).toBeUndefined();
    expect(proofProblem(test({ command: 'python -m pytest tests/test_hold_proof.py', file: 'tests/test_hold_proof.py' }))).toBeUndefined();
    expect(proofProblem({ kind: 'check', finding: 'x', command: 'pnpm run typecheck' })).toBeUndefined();
    expect(proofProblem({ kind: 'screenshot', finding: 'x', screenshot: 1 })).toBeUndefined();
  });

  it('says why it can’t check one', () => {
    expect(proofProblem(test({ command: undefined }))).toMatch(/no command/);
    expect(proofProblem(test({ command: 'pnpm vitest run src/hold.proof.test.ts | tail' }))).toMatch(/shell/);
    expect(proofProblem(test({ file: undefined }))).toMatch(/no test file/);
    expect(proofProblem(test({ file: '../elsewhere/x.proof.test.ts', command: 'vitest run ../elsewhere/x.proof.test.ts' }))).toMatch(/outside the repo/);
    expect(proofProblem(test({ file: '/etc/x.proof.test.ts', command: 'vitest run /etc/x.proof.test.ts' }))).toMatch(/outside the repo/);
    // the whole suite could fail for something else
    expect(proofProblem(test({ command: 'pnpm test' }))).toMatch(/doesn't name its file/);
    expect(proofProblem({ kind: 'screenshot', finding: 'x' })).toMatch(/no screenshot/);
  });
});

describe('proofOutcome', () => {
  const ran = (code: number | null, output: string): CommandRun => ({ code, output });

  it('holds for a test that fails on an assertion, with the line that says how', () => {
    expect(proofOutcome('test', ran(1, VITEST_FAIL))).toEqual({ outcome: 'failed', note: "AssertionError: expected 'idle' to be 'held' // Object.is equality" });
    expect(proofOutcome('test', ran(1, 'FAILED tests/test_hold_proof.py::test_restart - assert 0 == 1\n1 failed in 0.1s')).outcome).toBe('failed');
    expect(proofOutcome('test', ran(1, '--- FAIL: TestRestart (0.00s)\n    hold_proof_test.go:12: got idle, want held\nFAIL')).outcome).toBe('failed');
  });

  it('doesn’t for one that couldn’t load, compile or find a test: QA’s typo isn’t proof', () => {
    expect(proofOutcome('test', ran(1, VITEST_UNLOADED))).toEqual({ outcome: 'broken', note: 'it couldn\'t load what it imports' });
    expect(proofOutcome('test', ran(1, 'TypeError: (0 , __vite_ssr_import_1__.hodl) is not a function\n Tests  1 failed (1)')).outcome).toBe('broken');
    expect(proofOutcome('test', ran(1, 'No test files found, exiting with code 1'))).toEqual({ outcome: 'broken', note: 'it ran no tests' });
    expect(proofOutcome('test', ran(2, 'ImportError while importing test module\nERROR collecting tests/test_x_proof.py'))).toMatchObject({ outcome: 'broken' });
    expect(proofOutcome('test', ran(1, 'something went wrong'))).toEqual({ outcome: 'broken', note: 'its command failed without a test failing' });
  });

  it('doesn’t when the test passed, or the command timed out or couldn’t start', () => {
    expect(proofOutcome('test', ran(0, ' Tests  1 passed (1)')).outcome).toBe('passed');
    expect(proofOutcome('test', ran(null, VITEST_FAIL)).outcome).toBe('broken');
  });

  it('holds for a check that exits with a failure, unless its command isn’t there', () => {
    expect(proofOutcome('check', ran(2, "src/a.ts(3,1): error TS2322: Type 'string' is not assignable to type 'number'."))).toEqual({ outcome: 'failed', note: "src/a.ts(3,1): error TS2322: Type 'string' is not assignable to type 'number'." });
    expect(proofOutcome('check', ran(1, 'ERR_PNPM_NO_SCRIPT  Missing script: typechek')).outcome).toBe('broken');
    expect(proofOutcome('check', ran(0, '')).outcome).toBe('passed');
  });
});

describe('screenshotOutcome and touchesUi', () => {
  const ui = ['client/src/board.ts'];

  it('holds for a screenshot that goes on the PR, of a change to UI code', () => {
    expect(screenshotOutcome(9, { taken: 10, kept: 8 }, ui)).toEqual({ outcome: 'failed', note: 'screenshot 7 on this comment shows it' });
  });

  it('doesn’t for one that wasn’t taken or kept, or a change with no UI code', () => {
    expect(screenshotOutcome(3, { taken: 2, kept: 2 }, ui).outcome).toBe('broken');
    expect(screenshotOutcome(2, { taken: 10, kept: 8 }, ui)).toMatchObject({ outcome: 'broken', note: expect.stringMatching(/isn't one that goes on/) });
    expect(screenshotOutcome(1, { taken: 1, kept: 1 }, ['server/agents/qa.ts'])).toMatchObject({ outcome: 'broken', note: expect.stringMatching(/no UI code/) });
  });

  it('counts pages, components, styles and front-end folders as UI code', () => {
    expect(touchesUi(['src/Button.tsx'])).toBe(true);
    expect(touchesUi(['app/styles/site.scss'])).toBe(true);
    expect(touchesUi(['Pages/Index.cshtml'])).toBe(true);
    expect(touchesUi(['server/agents/qa.ts', 'docs/qa.md'])).toBe(false);
  });
});

describe('provenReport and blocksWithProof', () => {
  it('blocks a fail with a proof that held', () => {
    const r = provenReport(report(), [test({ outcome: 'failed' })]);
    expect(r).toMatchObject({ verdict: 'fail', proofs: [{ outcome: 'failed' }] });
    expect(r.advisory).toBeUndefined();
    expect(blocksWithProof(r)).toBe(true);
  });

  it('makes a fail without a proof that held a pass with advice, keeping QA’s findings', () => {
    for (const proofs of [[], [test({ outcome: 'passed' })], [test({ outcome: 'broken', note: 'it ran no tests' })]]) {
      const r = provenReport(report(), proofs);
      expect(r).toMatchObject({ verdict: 'pass', advisory: true, fixInstructions: 'Keep the hold.', summary: 'Broken on restart.' });
      expect(blocksWithProof(r)).toBe(false);
    }
  });

  it('leaves a pass a pass, whatever its proofs', () => {
    const r = provenReport(report({ verdict: 'pass', fixInstructions: undefined }), [test({ outcome: 'failed' })]);
    expect(r.verdict).toBe('pass');
    expect(r.advisory).toBeUndefined();
    expect(blocksWithProof(r)).toBe(false);
  });
});
