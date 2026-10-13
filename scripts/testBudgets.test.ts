import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// A test that runs real git takes a couple of seconds alone, but well past vitest's 5 s on a busy machine (several
// agents' gates at once), where it fails the gate on nothing but load. Such a file sets a budget fit for git, as
// mergeBase.test.ts does.
const ROOT = path.resolve(import.meta.dirname, '..');
const testFiles = ['server', 'shared', 'client/src', 'scripts'].flatMap((dir) =>
  readdirSync(path.join(ROOT, dir), { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.test.ts') && !f.includes('node_modules'))
    .map((f) => path.join(dir, f)),
);

/** Whether a test file runs git itself, and whether it gives its tests the time that takes. */
const runsGit = (source: string) => /execFileSync\(\s*'git'/.test(source);
const hasBudget = (source: string) => /vi\.setConfig\(\{\s*testTimeout:/.test(source);

describe('test budgets', () => {
  it('tells a file that runs git from one that doesn’t, and sees its budget', () => {
    expect(runsGit("const git = (cwd) => execFileSync('git', args, { cwd })")).toBe(true);
    expect(runsGit("execFileSync('node', ['-v'])")).toBe(false);
    expect(hasBudget('vi.setConfig({ testTimeout: 30_000 });')).toBe(true);
    expect(hasBudget('it(\'x\', () => {}, 30_000);')).toBe(false);
  });

  it('gives every test file that runs real git a budget fit for a busy machine', () => {
    const unbudgeted = testFiles.filter((f) => {
      const source = readFileSync(path.join(ROOT, f), 'utf8');
      return runsGit(source) && !hasBudget(source);
    });
    expect(unbudgeted).toEqual([]);
  });
});
