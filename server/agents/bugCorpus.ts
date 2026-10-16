// The bug corpus (docs/bug-corpus.md): real bugs the office's agents shipped, each with a referee that can't be argued
// with. A fix that came with a test is a case when that test fails on the code just before the fix, for the bug's
// sake (an assertion, not a function that didn't exist yet), and passes on the fix. The rules are here, pure; git,
// the worktrees and vitest are in scripts/bugCorpus.ts.

/** How one test came out in a vitest run. */
export interface TestOutcome {
  file: string;
  name: string;
  passed: boolean;
  message: string;
}

/** A test file vitest couldn't load or run at all, and why. */
export interface LoadError {
  file: string;
  message: string;
}

export interface VitestRun {
  tests: TestOutcome[];
  loadErrors: LoadError[];
}

interface JsonAssertion {
  fullName?: string;
  title?: string;
  status?: string;
  failureMessages?: string[];
}

interface JsonFile {
  name?: string;
  status?: string;
  message?: string;
  assertionResults?: JsonAssertion[];
}

/** The tests in vitest's `--reporter=json` output, with file paths (in names and messages) made relative to `root`, so
 *  two runs in different worktrees read the same; skipped tests are left out. */
export function vitestRun(json: string, root: string): VitestRun {
  const files = (JSON.parse(json) as { testResults?: JsonFile[] }).testResults ?? [];
  const rel = (text: string) => text.replaceAll(`${root}/`, '');
  const tests: TestOutcome[] = [];
  const loadErrors: LoadError[] = [];
  for (const f of files) {
    const file = rel(f.name ?? '');
    const ran = (f.assertionResults ?? []).filter((a) => a.status === 'passed' || a.status === 'failed');
    if (f.status === 'failed' && !ran.some((a) => a.status === 'failed')) loadErrors.push({ file, message: rel(f.message ?? '') });
    for (const a of ran) tests.push({ file, name: a.fullName ?? a.title ?? '', passed: a.status === 'passed', message: rel((a.failureMessages ?? []).join('\n')) });
  }
  return { tests, loadErrors };
}

/** A failure that says the code under test didn't exist yet (what the fix added), not that it behaved wrongly: an import
 *  that isn't there. A value that isn't a function is the bug itself when it isn't an import (`todos.find is not a function`). */
const MISSING = /__vite_ssr_import_\d+__\.\w+\)? is not a (function|constructor)|Cannot find module|Failed to load url|does not provide an export/;
export const missingCode = (message: string) => MISSING.test(message);

export type Verdict =
  | 'reproduces' // at least one test fails before the fix for the bug's sake and passes on it: a case
  | 'passes-before' // its tests pass on the buggy code too: they don't see the bug
  | 'missing-code' // its tests fail before only because what they call didn't exist yet: a feature, not a referee
  | 'fails-after' // its tests don't pass on the fix itself (another era's dependencies, or a flaky test)
  | 'no-tests' // the fix changed no test vitest runs
  | 'unsteady'; // a test referees the bug on some runs and not others: no referee to trust

/** The tests that referee the bug: passing on the fix, failing before it on an assertion, in a file that loaded. */
export function refereeTests(before: VitestRun, after: VitestRun): TestOutcome[] {
  const failedBefore = new Map(before.tests.filter((t) => !t.passed).map((t) => [testKey(t), t]));
  const unloaded = new Set(before.loadErrors.map((e) => e.file));
  return after.tests.flatMap((t) => {
    const was = failedBefore.get(testKey(t));
    return t.passed && was && !unloaded.has(t.file) && !missingCode(was.message) ? [was] : [];
  });
}

const testKey = (t: { file: string; name: string }) => `${t.file}\u0000${t.name}`;

/** The referees on every one of several runs (before and after in pairs): a test that only sometimes fails before the fix,
 *  or only sometimes passes on it, is flaky, not a referee. */
export function steadyReferees(runs: { before: VitestRun; after: VitestRun }[]): TestOutcome[] {
  const [first, ...rest] = runs.map((r) => refereeTests(r.before, r.after));
  return (first ?? []).filter((t) => rest.every((more) => more.some((m) => testKey(m) === testKey(t))));
}

/** What several runs of a fix's tests say: the first run's verdict, unless its referees didn't hold on every run. */
export function steadyVerdict(runs: { before: VitestRun; after: VitestRun }[]): Verdict {
  const first = runs[0];
  if (!first) return 'no-tests';
  const v = verdict(first.before, first.after);
  return v === 'reproduces' && !steadyReferees(runs).length ? 'unsteady' : v;
}

export function verdict(before: VitestRun, after: VitestRun): Verdict {
  if (!after.tests.length && !after.loadErrors.length) return 'no-tests';
  if (!after.tests.some((t) => t.passed)) return 'fails-after';
  if (refereeTests(before, after).length) return 'reproduces';
  if (before.loadErrors.length || before.tests.some((t) => !t.passed)) return 'missing-code';
  return 'passes-before';
}

/** Files vitest would run (vitest.config.ts's include), among a commit's changed files. */
const TEST_FILE = /^(server|shared|client\/src|scripts|plugins|plugin-api)\/.*\.test\.ts$/;
export const vitestFiles = (files: string[]) => files.filter((f) => TEST_FILE.test(f));

/** A line a fix took out or changed: its file and its line number in the buggy version. */
export interface BuggyLine {
  file: string;
  line: number;
}

/** Each removed line of a unified diff (`git diff -U0`), where it was in the old version: where the bug was. Test files are left out. */
export function buggyLines(diff: string): BuggyLine[] {
  const out: BuggyLine[] = [];
  let file: string | undefined;
  let line = 0;
  for (const text of diff.split('\n')) {
    if (text.startsWith('--- ')) file = text === '--- /dev/null' ? undefined : text.replace(/^--- a\//, '');
    else if (text.startsWith('+++ ')) continue;
    else if (text.startsWith('@@')) line = Number(/-(\d+)/.exec(text)?.[1] ?? 0);
    else if (text.startsWith('-') && file && !/\.test\.ts$/.test(file)) out.push({ file, line: line++ });
  }
  return out;
}

/** One verified bug: the fix, the commit before it (the buggy code), the tests that referee it and where it was. */
export interface BugCase {
  fix: string;
  buggy: string;
  subject: string;
  kind: string;
  testFiles: string[];
  referees: { file: string; name: string; failure: string }[];
  buggyLines: BuggyLine[];
}

/** What's left of a failure message worth keeping in the corpus: its first lines. */
export const firstLines = (message: string, n = 3) => message.split('\n').filter((l) => l.trim()).slice(0, n).join('\n');

/** The curated list (scripts/bug-corpus/fixes.txt): `<sha> <kind>` a line, `#` comments and blank lines ignored. */
export function parseFixes(text: string): { sha: string; kind: string }[] {
  return text
    .split('\n')
    .map((l) => l.replace(/#.*/, '').trim())
    .filter(Boolean)
    .map((l) => {
      const [sha = '', kind = 'unclassified'] = l.split(/\s+/);
      return { sha, kind };
    });
}
