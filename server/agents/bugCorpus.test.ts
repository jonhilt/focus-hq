import { describe, expect, it } from 'vitest';
import { blameLine, buggyLines, catchesBug, introduced, owners, ruledOut, parseFixes, prNumber, refereeTests, steadyReferees, steadyVerdict, verdict, vitestFiles, vitestRun, type VitestRun } from './bugCorpus';

const ROOT = '/tmp/wt';
const json = (files: object[]) => JSON.stringify({ testResults: files });
const file = (name: string, assertions: [string, 'passed' | 'failed' | 'skipped', string?][], status = 'passed', message = '') => ({
  name: `${ROOT}/${name}`,
  status,
  message,
  assertionResults: assertions.map(([fullName, s, failure]) => ({ fullName, status: s, failureMessages: failure ? [failure] : [] })),
});
const runOf = (...files: object[]): VitestRun => vitestRun(json(files), ROOT);

describe('vitestRun', () => {
  it('reads each test with its file relative to the worktree, leaving skipped ones out', () => {
    const run = runOf(file('server/a.test.ts', [['a works', 'passed'], ['a breaks', 'failed', 'AssertionError: expected 1 to be 2'], ['later', 'skipped']], 'failed'));
    expect(run.tests).toEqual([
      { file: 'server/a.test.ts', name: 'a works', passed: true, message: '' },
      { file: 'server/a.test.ts', name: 'a breaks', passed: false, message: 'AssertionError: expected 1 to be 2' },
    ]);
    expect(run.loadErrors).toEqual([]);
  });

  it('counts a failed file with no failed test as one that never loaded', () => {
    const run = runOf(file('server/b.test.ts', [], 'failed', `Cannot find module './x' imported from ${ROOT}/server/b.test.ts`));
    expect(run.loadErrors).toEqual([{ file: 'server/b.test.ts', message: "Cannot find module './x' imported from server/b.test.ts" }]);
  });
});

describe('verdict', () => {
  const after = runOf(file('server/a.test.ts', [['keeps the hold', 'passed'], ['still works', 'passed']]));

  it('is a case when a test fails before the fix on an assertion and passes on it', () => {
    const before = runOf(file('server/a.test.ts', [['keeps the hold', 'failed', "AssertionError: expected 'idle' to be 'held'"], ['still works', 'passed']], 'failed'));
    expect(verdict(before, after)).toBe('reproduces');
    expect(refereeTests(before, after).map((t) => t.name)).toEqual(['keeps the hold']);
  });

  it("isn't a case when the test only fails because what it calls didn't exist yet", () => {
    const before = runOf(file('server/a.test.ts', [['keeps the hold', 'failed', 'TypeError: (0 , __vite_ssr_import_1__.contextLevel) is not a function'], ['still works', 'passed']], 'failed'));
    expect(verdict(before, after)).toBe('missing-code');
  });

  it("is a case when what isn't a function is the bug's own value, not an import", () => {
    const before = runOf(file('server/a.test.ts', [['keeps the hold', 'failed', 'TypeError: todos.find is not a function'], ['still works', 'passed']], 'failed'));
    expect(verdict(before, after)).toBe('reproduces');
  });

  it("isn't a case when the test file couldn't load before the fix", () => {
    const before = runOf(file('server/a.test.ts', [], 'failed', 'SyntaxError: does not provide an export named x'));
    expect(verdict(before, after)).toBe('missing-code');
  });

  it("isn't a case when its tests pass on the buggy code too", () => {
    expect(verdict(after, after)).toBe('passes-before');
  });

  it("isn't a case when its tests don't pass on the fix itself", () => {
    const broken = runOf(file('server/a.test.ts', [['keeps the hold', 'failed', 'AssertionError']], 'failed'));
    expect(verdict(broken, broken)).toBe('fails-after');
  });

  it('says so when there was no test to run', () => {
    expect(verdict(runOf(), runOf())).toBe('no-tests');
  });

  it('only counts a test as a referee if the very same test passes after', () => {
    const before = runOf(file('server/a.test.ts', [['renamed since', 'failed', 'AssertionError']], 'failed'));
    expect(refereeTests(before, after)).toEqual([]);
  });
});

describe('steady referees', () => {
  const after = runOf(file('server/a.test.ts', [['keeps the hold', 'passed'], ['reopens', 'passed']]));
  const bothFail = runOf(file('server/a.test.ts', [['keeps the hold', 'failed', 'AssertionError'], ['reopens', 'failed', 'AssertionError']], 'failed'));
  const oneFails = runOf(file('server/a.test.ts', [['keeps the hold', 'failed', 'AssertionError'], ['reopens', 'passed']], 'failed'));

  it('keeps only the tests that referee the bug on every run', () => {
    expect(steadyReferees([{ before: bothFail, after }, { before: oneFails, after }]).map((t) => t.name)).toEqual(['keeps the hold']);
  });

  it("drops a referee whose test doesn't pass on the fix every time", () => {
    const flakyAfter = runOf(file('server/a.test.ts', [['keeps the hold', 'failed', 'AssertionError'], ['reopens', 'passed']], 'failed'));
    expect(steadyReferees([{ before: oneFails, after }, { before: oneFails, after: flakyAfter }])).toEqual([]);
  });

  it('calls a fix unsteady when it reproduced once but no referee held on every run', () => {
    const reopensOnly = runOf(file('server/a.test.ts', [['keeps the hold', 'passed'], ['reopens', 'failed', 'AssertionError']], 'failed'));
    expect(steadyVerdict([{ before: oneFails, after }, { before: reopensOnly, after }])).toBe('unsteady');
    expect(steadyVerdict([{ before: oneFails, after }, { before: bothFail, after }])).toBe('reproduces');
  });

  it('calls a fix unsteady when only a later run reproduced it', () => {
    expect(steadyVerdict([{ before: after, after }, { before: oneFails, after }])).toBe('unsteady');
  });
});

describe('vitestFiles', () => {
  it('keeps only the test files vitest would run', () => {
    expect(vitestFiles(['server/a.ts', 'server/a.test.ts', 'plugins/x/y.test.ts', 'docs/a.test.ts', 'client/src/z.test.ts'])).toEqual([
      'server/a.test.ts',
      'plugins/x/y.test.ts',
      'client/src/z.test.ts',
    ]);
  });
});

describe('buggyLines', () => {
  it('places each line the fix took out where it was in the buggy version, leaving tests out', () => {
    const diff = [
      'diff --git a/server/x.ts b/server/x.ts',
      'index 1..2 100644',
      '--- a/server/x.ts',
      '+++ b/server/x.ts',
      '@@ -10,2 +10,1 @@',
      '-  held = false;',
      '-  stop();',
      '+  stop();',
      '@@ -40 +39 @@',
      '-  return a;',
      '+  return b;',
      'diff --git a/server/x.test.ts b/server/x.test.ts',
      '--- a/server/x.test.ts',
      '+++ b/server/x.test.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ].join('\n');
    expect(buggyLines(diff)).toEqual([
      { file: 'server/x.ts', line: 10 },
      { file: 'server/x.ts', line: 11 },
      { file: 'server/x.ts', line: 40 },
    ]);
  });

  it("reads a removed line that starts with '-- ' as a removed line, not a file's header", () => {
    const diff = ['diff --git a/server/x.ts b/server/x.ts', '--- a/server/x.ts', '+++ b/server/x.ts', '@@ -5,2 +5 @@', '--- a comment', '-x--;', '+x++;'].join('\n');
    expect(buggyLines(diff)).toEqual([
      { file: 'server/x.ts', line: 5 },
      { file: 'server/x.ts', line: 6 },
    ]);
  });

  it('has nothing for a file the fix created', () => {
    expect(buggyLines(['diff --git a/server/new.ts b/server/new.ts', '--- /dev/null', '+++ b/server/new.ts', '@@ -0,0 +1 @@', '+x'].join('\n'))).toEqual([]);
  });
});

describe('parseFixes', () => {
  it('reads a sha and a kind a line, ignoring comments and blank lines', () => {
    expect(parseFixes('# fixes\nabc123 lifecycle  # the hold\n\ndef456\n')).toEqual([
      { sha: 'abc123', kind: 'lifecycle' },
      { sha: 'def456', kind: 'unclassified' },
    ]);
  });
});

describe('introduced', () => {
  const referees = [{ file: 'server/a.test.ts', name: 'keeps the hold' }];
  const catches = runOf(file('server/a.test.ts', [['keeps the hold', 'failed', "AssertionError: expected 'idle' to be 'held'"]], 'failed'));
  const passes = runOf(file('server/a.test.ts', [['keeps the hold', 'passed']]));
  const cantRun = runOf(file('server/a.test.ts', [], 'failed', "Cannot find module './hold'"));
  const missing = runOf(file('server/a.test.ts', [['keeps the hold', 'failed', 'TypeError: (0 , __vite_ssr_import_1__.hold) is not a function']], 'failed'));

  it('says a commit brought the bug in when its referees fail on it and not on the commit before', () => {
    expect(introduced([catches, catches], [passes, passes], referees)).toBe('introduced');
  });

  it('says the first commit of all brought it in', () => {
    expect(introduced([catches], 'root', referees)).toBe('introduced');
  });

  it("can't say a commit brought the bug in when the referees can't run on the one before", () => {
    expect(introduced([catches], [cantRun], referees)).toBe('first-testable');
    expect(introduced([catches], [missing], referees)).toBe('first-testable');
    expect(introduced([catches], [passes, cantRun], referees)).toBe('first-testable');
  });

  it('says the bug is older when a referee already fails on the commit before', () => {
    expect(introduced([catches], [passes, catches], referees)).toBe('older');
  });

  it('says the bug came later when the referees pass on the commit', () => {
    expect(introduced([catches, passes], [passes], referees)).toBe('not-buggy');
  });

  it("can't tell when the referees can't run on the commit", () => {
    expect(introduced([cantRun], [cantRun], referees)).toBe('untestable');
    expect(introduced([missing], [missing], referees)).toBe('untestable');
  });

  it('only listens to the referee tests, not others in the same file', () => {
    const otherFails = runOf(file('server/a.test.ts', [['keeps the hold', 'passed'], ['something else', 'failed', 'AssertionError']], 'failed'));
    expect(introduced([catches], [otherFails], referees)).toBe('introduced');
  });
});

describe('prNumber', () => {
  it('reads the pull request GitHub appended to a squash-merged subject', () => {
    expect(prNumber('Move the rest of the agent manager into parts (#212)')).toBe(212);
    expect(prNumber('Tell a lead to carry on, not stop (#192) (#196)')).toBe(196);
    expect(prNumber('Merge pull request #392 from jonhilt/focus/okay-so (#12)')).toBe(392);
    expect(prNumber('A direct commit to main')).toBeUndefined();
  });
});

describe('blameLine', () => {
  it("reads a line's owner and where the line was in it, through a move", () => {
    const porcelain = ['8a8401a 12 40 1', 'author Lead', 'summary Carry on with your API key', 'filename server/agents/comms.ts', '\tagent.held = false;'].join('\n');
    expect(blameLine(porcelain)).toEqual({ sha: '8a8401a', file: 'server/agents/comms.ts', line: 12 });
  });

  it('has nothing for empty output', () => {
    expect(blameLine('')).toBeUndefined();
  });
});

describe('catchesBug', () => {
  const referees = [{ file: 'server/a.test.ts', name: 'keeps the hold' }];
  it('only counts a referee failing on an assertion', () => {
    expect(catchesBug(runOf(file('server/a.test.ts', [['keeps the hold', 'failed', 'AssertionError']], 'failed')), referees)).toBe(true);
    expect(catchesBug(runOf(file('server/a.test.ts', [['keeps the hold', 'failed', 'TypeError: (0 , __vite_ssr_import_1__.x) is not a function']], 'failed')), referees)).toBe(false);
    expect(catchesBug(runOf(file('server/a.test.ts', [['another', 'failed', 'AssertionError']], 'failed')), referees)).toBe(false);
  });
});

describe('owners', () => {
  it('puts the commit that last touched most of the lines first, ties to the earlier line', () => {
    expect(owners(['b', 'a', 'a', 'b', 'c'])).toEqual(['b', 'a', 'c']);
  });
});

describe('ruledOut', () => {
  it('rules a suspect out only when the referees say the bug was older or not there yet', () => {
    expect(['introduced', 'first-testable', 'untestable', 'older', 'not-buggy'].filter((v) => ruledOut(v as never))).toEqual(['older', 'not-buggy']);
  });
});
