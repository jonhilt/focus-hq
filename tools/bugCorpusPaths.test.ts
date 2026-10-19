import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

// it runs real git, which a busy machine can slow past vitest's 5 s (testBudgets.test.ts)
vi.setConfig({ testTimeout: 30_000 });

type Case = { fix: string; buggy: string; testFiles: string[]; referees: { file: string }[]; buggyLines: { file: string }[] };
const corpus = JSON.parse(readFileSync('tools/bug-corpus/corpus.json', 'utf8')) as { cases: Case[] };

/** Which of `objects` (`<sha>^{commit}` or `<sha>:<file>`) this clone has: one git call for them all, not one apiece. */
function present(objects: readonly string[]): Set<string> {
  const out = execFileSync('git', ['cat-file', '--batch-check=%(objectname)'], { input: `${objects.join('\n')}\n`, encoding: 'utf8' });
  return new Set(out.trimEnd().split('\n').flatMap((line, i) => (line.endsWith(' missing') ? [] : [objects[i]])));
}

// The corpus records real fixes at their own commits, so the paths in it must be the ones those commits had (a
// folder renamed since, like scripts/ to tools/, keeps its old name there). Cases whose commits aren't in this clone
// are skipped.
describe('bug corpus paths', () => {
  const commits = present(corpus.cases.flatMap((c) => [`${c.fix}^{commit}`, `${c.buggy}^{commit}`]));
  const known = (sha: string) => commits.has(`${sha}^{commit}`);
  const missingFrom = (named: { sha: string; file: string }[]) => {
    const wanted = named.map((n) => `${n.sha}:${n.file}`);
    const there = present(wanted);
    return named.filter((_, i) => !there.has(wanted[i])).map((n) => `${n.sha.slice(0, 7)}:${n.file}`);
  };

  it('names test files and referees as they were at the fix commit', () => {
    const named = corpus.cases.filter((c) => known(c.fix)).flatMap((c) => [...c.testFiles, ...c.referees.map((r) => r.file)].map((file) => ({ sha: c.fix, file })));
    expect(missingFrom(named)).toEqual([]);
  });

  it('names buggy lines as they were at the buggy commit', () => {
    const named = corpus.cases.filter((c) => known(c.buggy)).flatMap((c) => c.buggyLines.map((l) => ({ sha: c.buggy, file: l.file })));
    expect(missingFrom(named)).toEqual([]);
  });
});
