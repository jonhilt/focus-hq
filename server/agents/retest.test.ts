import { describe, expect, it } from 'vitest';
import type { QaReview } from '../../shared/types';
import { carriedComment, checkCommands, rangeDiffUnchanged, retestStep, type SinceVerdict } from './retest';

const review = (status: QaReview['status'], sha = 'aaaaaaa1111'): QaReview => ({ projectId: 'p', repo: 'o/r', number: 1, title: 't', status, sha, requestedAt: 0 });
const merge = { sha: 'mmmmmmm', mergesBase: true, clean: true };
const since = (over: Partial<SinceVerdict> = {}): SinceVerdict => ({ head: 'bbbbbbb2222', descends: true, commits: [merge], sameChanges: true, ...over });

describe('retestStep', () => {
  it('skips a head that already has a verdict, passed or failed', () => {
    expect(retestStep(review('passed'), 'aaaaaaa', null).kind).toBe('skip');
    expect(retestStep(review('failed'), 'aaaaaaa1111', null).kind).toBe('skip');
  });

  it('re-tests with no verdict, or after a fail', () => {
    expect(retestStep(undefined, 'bbbbbbb2222', since()).kind).toBe('retest');
    expect(retestStep(review('error'), 'bbbbbbb2222', since()).kind).toBe('retest');
    expect(retestStep(review('failed'), 'bbbbbbb2222', since()).kind).toBe('retest');
  });

  it('runs only the checks when a clean merge of the base is all that came in', () => {
    expect(retestStep(review('passed'), 'bbbbbbb2222', since())).toEqual({ kind: 'checks-only', head: 'bbbbbbb2222', passed: 'aaaaaaa1111' });
    expect(retestStep(review('passed'), 'bbbbbbb2222', since({ commits: [merge, { ...merge, sha: 'nnnnnnn' }] })).kind).toBe('checks-only');
  });

  it('re-tests a real change, a conflicted merge, a rewrite or anything git couldn’t tell', () => {
    const step = (s: SinceVerdict | null) => retestStep(review('passed'), 'bbbbbbb2222', s).kind;
    expect(step(since({ commits: [merge, { sha: 'c', mergesBase: false, clean: true }] }))).toBe('retest');
    expect(step(since({ commits: [{ ...merge, clean: false }] }))).toBe('retest');
    expect(step(since({ sameChanges: false }))).toBe('retest');
    expect(step(since({ descends: false }))).toBe('retest');
    expect(step(since({ commits: [] }))).toBe('retest');
    expect(step(since({ head: 'ccccccc3333' }))).toBe('retest');
    expect(step(null)).toBe('retest');
  });
});

describe('checkCommands', () => {
  it('runs typecheck, lint and tests when the project has them', () => {
    expect(checkCommands({ test: 'vitest run', build: 'vite build', typecheck: 'tsc', lint: 'eslint .' }, 'npm')).toEqual([['npm', 'run', 'typecheck'], ['npm', 'run', 'lint'], ['npm', 'test']]);
  });

  it('runs them with the project’s package manager', () => {
    expect(checkCommands({ test: 'vitest run', typecheck: 'tsc', lint: 'eslint .' }, 'pnpm')).toEqual([['pnpm', 'run', 'typecheck'], ['pnpm', 'run', 'lint'], ['pnpm', 'test']]);
    expect(checkCommands({ test: 'vitest run', typecheck: 'tsc', lint: 'eslint .' }, 'pnpm', ['typecheck'])).toEqual([['pnpm', 'run', 'typecheck']]);
  });

  it('finds none in npm’s placeholder test script or no package.json', () => {
    expect(checkCommands({ test: 'echo "Error: no test specified" && exit 1' }, 'npm')).toEqual([]);
    expect(checkCommands(undefined, 'pnpm')).toEqual([]);
  });
});

describe('rangeDiffUnchanged', () => {
  it('is true only when every commit pair is the same', () => {
    expect(rangeDiffUnchanged('1:  abc1234 = 1:  abc1234 Add header\n2:  def5678 = 2:  def5678 Tests\n')).toBe(true);
    expect(rangeDiffUnchanged('1:  abc1234 ! 1:  fff1234 Add header\n    @@ diff')).toBe(false);
    expect(rangeDiffUnchanged('-:  ------- > 1:  fff1234 New')).toBe(false);
    expect(rangeDiffUnchanged('')).toBe(false);
  });
});

it('carriedComment says it was a merge of the base only, and where the checks were green', () => {
  const body = carriedComment('main', 'bbbbbbb2222', 'aaaaaaa1111', ['npm test']);
  expect(body).toContain('Merge of main only; checks green at `bbbbbbb`');
  expect(body).toContain('`aaaaaaa`');
});
