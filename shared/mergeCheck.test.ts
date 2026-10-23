import { describe, expect, it } from 'vitest';
import { gateStep, mergeCheckLine, mergeCheckOn, mergeCheckScripts, type MergeTrial, mergeTreeConflicts, mergeVerdict, refusalComment, trialOutcome } from './mergeCheck';

const heads = { base: 'bbbbbbb1111', head: 'hhhhhhh2222' };
const passed: MergeTrial = { kind: 'checked', ...heads, merge: 'mmmmmmm3333', results: [{ command: 'pnpm install --frozen-lockfile', ok: true }, { command: 'pnpm run typecheck', ok: true }] };
const failed: MergeTrial = { kind: 'checked', ...heads, merge: 'mmmmmmm3333', results: [{ command: 'pnpm run typecheck', ok: true }, { command: 'pnpm run lint', ok: false, output: 'src/a.ts\n  1:1 error no-unused-vars' }] };
const conflicts: MergeTrial = { kind: 'conflicts', ...heads, files: ['src/a.ts', 'src/b.ts'] };

describe('mergeCheckScripts', () => {
  it('runs the default checks the repo has, and none without a package.json', () => {
    expect(mergeCheckScripts({ typecheck: 'tsc', test: 'vitest run', build: 'vite build' })).toEqual(['typecheck', 'test']);
    expect(mergeCheckScripts(undefined)).toEqual([]);
  });

  it('runs the project’s choice instead, and none for an empty one', () => {
    expect(mergeCheckScripts({ typecheck: 'tsc', lint: 'eslint .', 'test:unit': 'vitest' }, ['lint', 'test:unit', 'e2e'])).toEqual(['lint', 'test:unit']);
    expect(mergeCheckScripts({ typecheck: 'tsc' }, [])).toEqual([]);
  });

  it('runs only a repo’s own merge-check script when it has one', () => {
    expect(mergeCheckScripts({ typecheck: 'tsc', 'merge-check': 'make ci' }, ['typecheck'])).toEqual(['merge-check']);
  });

  it('skips npm’s placeholder test script', () => {
    expect(mergeCheckScripts({ test: 'echo "Error: no test specified" && exit 1' })).toEqual([]);
  });
});

describe('gateStep', () => {
  it('tries the merge the first time', () => {
    expect(gateStep(heads, {})).toEqual({ kind: 'try' });
  });

  it('reuses a trial of the same base and head, so trying again runs nothing', () => {
    expect(gateStep(heads, { cached: failed })).toEqual({ kind: 'reuse', trial: failed });
    expect(gateStep({ base: 'bbbbbbb', head: 'hhhhhhh' }, { cached: passed })).toEqual({ kind: 'reuse', trial: passed });
  });

  it('tries again once the base or the head moved, or when the last trial couldn’t run', () => {
    expect(gateStep({ ...heads, base: 'ccccccc' }, { cached: passed })).toEqual({ kind: 'try' });
    expect(gateStep({ ...heads, head: 'ddddddd' }, { cached: passed })).toEqual({ kind: 'try' });
    expect(gateStep(heads, { cached: { kind: 'broken', ...heads, reason: 'disk full' } })).toEqual({ kind: 'try' });
  });

  it('refuses a PR that moved on from the commit the caller means to merge', () => {
    expect(gateStep(heads, { want: 'eeeeeee', cached: passed })).toEqual({ kind: 'refuse', reason: 'it moved on to hhhhhhh since eeeeeee' });
    expect(gateStep(heads, { want: 'hhhhhhh' })).toEqual({ kind: 'try' });
  });

  it('refuses when it can’t tell the head', () => {
    expect(gateStep({ base: 'b', head: '' }, {}).kind).toBe('refuse');
  });
});

describe('mergeVerdict', () => {
  it('lets through a merge whose checks all pass, or one with none to run', () => {
    expect(mergeVerdict(passed)).toEqual({ kind: 'merge', said: 'its merge with the base passes 2 checks' });
    expect(mergeVerdict({ ...passed, results: [] })).toEqual({ kind: 'merge', said: 'it merges cleanly (no checks to run)' });
  });

  it('refuses a merge a check fails on, naming it', () => {
    expect(mergeVerdict(failed)).toEqual({ kind: 'refuse', reason: '`pnpm run lint` fails on its merge with the base at bbbbbbb' });
  });

  it('refuses a conflicting merge, and one it couldn’t check', () => {
    expect(mergeVerdict(conflicts)).toEqual({ kind: 'refuse', reason: 'it conflicts with its base at bbbbbbb (src/a.ts, src/b.ts)' });
    expect(mergeVerdict({ kind: 'broken', reason: 'git fetch failed' })).toEqual({ kind: 'refuse', reason: 'Focus couldn’t check the merge: git fetch failed' });
  });
});

describe('the merge check on the board', () => {
  it('shows only on the head it’s about', () => {
    const check = { state: 'refused' as const, head: 'hhhhhhh2222', reason: 'it conflicts' };
    expect(mergeCheckOn({ headSha: 'hhhhhhh' }, check)).toBe(check);
    expect(mergeCheckOn({ headSha: 'fffffff' }, check)).toBeUndefined();
    expect(mergeCheckOn({}, check)).toBeUndefined();
  });

  it('reads as where it stands', () => {
    expect(mergeCheckLine({ state: 'queued', head: 'h', behind: 41 })).toBe('queued behind #41');
    expect(mergeCheckLine({ state: 'checking', head: 'h' })).toBe('checking the merge');
    expect(mergeCheckLine({ state: 'refused', head: 'h', reason: 'it conflicts' })).toBe('merge refused: it conflicts');
  });
});

describe('what a refusal leaves', () => {
  it('comments on the PR with the commands and the end of the failing one’s output', () => {
    const comment = refusalComment(failed, mergeVerdict(failed).kind === 'refuse' ? '`pnpm run lint` fails' : '');
    expect(comment).toContain('`pnpm run lint` fails');
    expect(comment).toContain('✅ `pnpm run typecheck` · ❌ `pnpm run lint`');
    expect(comment).toContain('no-unused-vars');
    expect(comment).toContain('merge it anyway');
  });

  it('writes the outcome in the ledger', () => {
    expect(trialOutcome(passed)).toEqual({ outcome: 'passed' });
    expect(trialOutcome(failed)).toEqual({ outcome: 'failed', failed: 'pnpm run lint' });
    expect(trialOutcome(conflicts)).toEqual({ outcome: 'conflicts', failed: 'src/a.ts, src/b.ts' });
    expect(trialOutcome({ kind: 'broken', reason: 'no clone' })).toEqual({ outcome: 'broken', failed: 'no clone' });
  });
});

describe('mergeTreeConflicts', () => {
  it('reads the conflicted files after the tree, up to the blank line', () => {
    expect(mergeTreeConflicts('6c53df2\nsrc/a.ts\nsrc/b.ts\n\nAuto-merging src/a.ts\n')).toEqual(['src/a.ts', 'src/b.ts']);
    expect(mergeTreeConflicts('6c53df2\n')).toEqual([]);
  });
});
