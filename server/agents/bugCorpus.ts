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

/** What several runs of a fix's tests say: a case when its referees held on every run; unsteady when any run reproduced
 *  the bug but no referee held on all of them; otherwise the first run's verdict. */
export function steadyVerdict(runs: { before: VitestRun; after: VitestRun }[]): Verdict {
  const first = runs[0];
  if (!first) return 'no-tests';
  if (steadyReferees(runs).length) return 'reproduces';
  return runs.some((r) => verdict(r.before, r.after) === 'reproduces') ? 'unsteady' : verdict(first.before, first.after);
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
  // a file's header runs from `diff --git` to its first hunk: a removed line reading `-- x` shows as `--- x` in a hunk
  let header = false;
  for (const text of diff.split('\n')) {
    if (text.startsWith('diff --git ')) header = true;
    else if (header && text.startsWith('--- ')) file = text === '--- /dev/null' ? undefined : text.replace(/^--- a\//, '');
    else if (text.startsWith('@@')) {
      header = false;
      line = Number(/-(\d+)/.exec(text)?.[1] ?? 0);
    } else if (!header && text.startsWith('-') && file && !/\.test\.ts$/.test(file)) out.push({ file, line: line++ });
  }
  return out;
}

/** One line's owner from `git blame --porcelain -L n,n`: the commit that last touched it, and where the line was in it (file and line). */
export function blameLine(porcelain: string): { sha: string; file: string; line: number } | undefined {
  const [head, ...rest] = porcelain.split('\n');
  const [sha, line] = (head ?? '').split(' ');
  const file = rest.find((l) => l.startsWith('filename '))?.slice('filename '.length);
  return sha && line && file ? { sha, file, line: Number(line) } : undefined;
}

/** The commits that last touched a bug's lines (one sha a line, from `git blame`), most lines first: the suspects. */
export function owners(shas: string[]): string[] {
  const count = new Map<string, number>();
  for (const sha of shas) count.set(sha, (count.get(sha) ?? 0) + 1);
  // Map keeps first-seen order, and sort is stable: ties go to the owner of the earlier line
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([sha]) => sha);
}

/** A suspect the referee tests rule out: the bug was already there before it, or not there yet on it. */
export const ruledOut = (v: Introduced) => v === 'older' || v === 'not-buggy';

export type Introduced =
  | 'introduced' // a referee fails on the commit and passes on the one before it: it brought the bug in
  | 'first-testable' // a referee fails on the commit and can't run on the one before: the bug is here or older, no telling which
  | 'older' // a referee already fails on the commit before: the bug is older than it
  | 'not-buggy' // the referees pass on the commit: the bug came later
  | 'untestable'; // the referees can't run on the commit (what they call didn't exist yet)

/** Whether a commit brought a bug in, from its referee tests run several times on the commit and on the one before it
 *  (none for the first commit of all). A commit before that the referees can't run on says nothing either way. */
export function introduced(atCommit: VitestRun[], atParent: VitestRun[] | 'root', referees: { file: string; name: string }[]): Introduced {
  const wanted = new Set(referees.map(testKey));
  const catches = (run: VitestRun) => catchesBug(run, referees);
  const passes = (run: VitestRun) => run.tests.some((t) => wanted.has(testKey(t)) && t.passed);
  const ran = (run: VitestRun) => run.tests.some((t) => wanted.has(testKey(t)) && (t.passed || !missingCode(t.message)));
  if (!atCommit.length || !atCommit.every(catches)) return atCommit.some(ran) ? 'not-buggy' : 'untestable';
  if (atParent === 'root') return 'introduced';
  if (atParent.some(catches)) return 'older';
  return atParent.length && atParent.every(passes) ? 'introduced' : 'first-testable';
}

/** Whether one run of a bug's referee tests catches it: one of them fails on an assertion, in a file that loaded. */
export function catchesBug(run: VitestRun, referees: { file: string; name: string }[]): boolean {
  const wanted = new Set(referees.map(testKey));
  return run.tests.some((t) => wanted.has(testKey(t)) && !t.passed && !missingCode(t.message) && !run.loadErrors.some((e) => e.file === t.file));
}

/** The pull request a commit on main landed: a merge commit's (`Merge pull request #392 …`), or the last `(#212)` GitHub appends to a squash-merged subject. */
export function prNumber(subject: string): number | undefined {
  const merged = /^Merge pull request #(\d+)/.exec(subject);
  if (merged) return Number(merged[1]);
  const all = [...subject.matchAll(/\(#(\d+)\)/g)];
  const last = all[all.length - 1];
  return last ? Number(last[1]) : undefined;
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
  /** The commit that brought the bug in: the one that last wrote most of its lines (`git blame`) and that its referees
   *  don't rule out, with what they say of it (`introduced` when they confirm it). Missing when every suspect is ruled out. */
  introducedBy?: { sha: string; subject: string; pr?: number; verdict: Introduced; lines: BuggyLine[] };
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
