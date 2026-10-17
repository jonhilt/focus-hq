// The bug corpus (docs/bug-corpus.md): for each real fix in scripts/bug-corpus/fixes.txt, runs the tests the fix
// changed twice, in throwaway worktrees of this repo: on the code just before the fix (with the fix's tests) and on the
// fix. A fix whose tests fail before for the bug's sake and pass on it is a case: a real bug with a referee that can't
// be argued with. The rules are in server/agents/bugCorpus.ts; this is git, the worktrees and vitest. It writes the
// cases to scripts/bug-corpus/corpus.json and says why each other fix isn't one. A test that referees the bug on some
// runs and not others is flaky, not a referee. Each case is then traced to the commit that brought its bug in, as SZZ
// does: the commit that last wrote its lines (git blame), unless its referee tests rule that commit out.
// Free: no model is called.
//
//   pnpm run bug-corpus               every fix in the list, three at a time, each fix's tests three times either side
//   pnpm run bug-corpus --only <sha>  one fix, to see why it is or isn't a case

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { blameLine, type BugCase, buggyLines, firstLines, introduced, owners, parseFixes, prNumber, ruledOut, steadyReferees, steadyVerdict, type Verdict, vitestFiles, type VitestRun, vitestRun } from '../server/agents/bugCorpus';
import { errorMessage, run } from '../server/util';

const ROOT = process.cwd();
const DIR = path.join(ROOT, 'scripts', 'bug-corpus');
const TEST_MS = 5 * 60_000;
const AT_ONCE = 3;
/** Each fix's tests run this many times either side: a referee has to hold on every one. */
const RUNS = 3;

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined;

const git = (...a: string[]) => run('git', a, { cwd: ROOT });

interface Outcome {
  fix: string;
  kind: string;
  subject: string;
  verdict: Verdict | 'error';
  note: string;
  bugCase?: BugCase;
}

/** The fix's tests run `runs` times on `at` (the fix's own versions of them written over), in a worktree that's gone afterwards. */
async function testsAt(at: string, fix: string, tests: string[], scratch: string, runs = RUNS): Promise<VitestRun[]> {
  const dir = mkdtempSync(path.join(scratch, 'wt-'));
  await git('worktree', 'add', '--quiet', '--detach', '--force', dir, at);
  try {
    symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'));
    for (const file of tests) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), await git('show', `${fix}:${file}`));
    }
    const results: VitestRun[] = [];
    for (let i = 0; i < runs; i++) {
      const out = path.join(dir, `vitest-${i}.json`);
      // vitest exits non-zero when a test fails, which is half the point: the report is in the file either way
      await run(path.join(ROOT, 'node_modules', '.bin', 'vitest'), ['run', '--reporter=json', `--outputFile=${out}`, ...tests], { cwd: dir, timeoutMs: TEST_MS }).catch(() => '');
      if (!existsSync(out)) throw new Error(`vitest wrote no report at ${at.slice(0, 7)}`);
      // vitest names files by their real path (macOS's tmpdir is a symlink into /private), and runs are matched by name
      results.push(vitestRun(readFileSync(out, 'utf8'), realpathSync(dir)));
    }
    return results;
  } finally {
    await git('worktree', 'remove', '--force', dir).catch(() => rmSync(dir, { recursive: true, force: true }));
  }
}

/** How many suspects to try, most lines first. */
const SUSPECTS = 3;

/** The commit that brought a case's bug in, as SZZ finds one: the commits that last wrote its lines (`git blame`, through
 *  moves and copies), most lines first, each tried with the referee tests on it and on the commit before it. The first
 *  they don't rule out is taken; they confirm it when they fail on it and pass before it. */
async function introducer(bug: BugCase, scratch: string): Promise<BugCase['introducedBy']> {
  const blamed = [];
  for (const { file, line } of bug.buggyLines) {
    const owner = blameLine(await git('blame', '-w', '-M', '-C', '--porcelain', '-L', `${line},${line}`, bug.buggy, '--', file).catch(() => ''));
    if (owner) blamed.push(owner);
  }
  for (const sha of owners(blamed.map((b) => b.sha)).slice(0, SUSPECTS)) {
    const atCommit = await testsAt(sha, bug.fix, bug.testFiles, scratch);
    const parent = await git('rev-parse', '--verify', '--quiet', `${sha}^`).then((p) => p.trim(), () => '');
    const v = introduced(atCommit, parent ? await testsAt(parent, bug.fix, bug.testFiles, scratch) : 'root', bug.referees);
    if (ruledOut(v)) continue;
    const subject = (await git('log', '-1', '--format=%s', sha)).trim();
    // where the bug's lines were in this commit: what a review of it should point at
    const lines = blamed.filter((b) => b.sha === sha).map(({ file, line }) => ({ file, line }));
    return { sha, subject, pr: prNumber(subject), verdict: v, lines };
  }
  return undefined;
}

async function check(fix: string, kind: string, scratch: string): Promise<Outcome> {
  const subject = (await git('log', '-1', '--format=%s', fix)).trim();
  const buggy = (await git('rev-parse', `${fix}^`)).trim();
  const changed = (await git('diff', '--name-only', '--diff-filter=AM', buggy, fix)).split('\n').filter(Boolean);
  const tests = vitestFiles(changed);
  const base = { fix, kind, subject };
  if (!tests.length) return { ...base, verdict: 'no-tests', note: 'the fix changed no test' };
  const befores = await testsAt(buggy, fix, tests, scratch);
  const afters = await testsAt(fix, fix, tests, scratch);
  const runs = befores.flatMap((before, i) => { const after = afters[i]; return after ? [{ before, after }] : []; });
  const v = steadyVerdict(runs);
  const before = runs[0]?.before;
  const failing = before?.tests.find((t) => !t.passed)?.message ?? before?.loadErrors[0]?.message ?? '';
  if (v !== 'reproduces') return { ...base, verdict: v, note: firstLines(failing, 1) };
  const referees = steadyReferees(runs).map((t) => ({ file: t.file, name: t.name, failure: firstLines(t.message, 1) }));
  const lines = buggyLines(await git('diff', '-U0', buggy, fix));
  const bugCase: BugCase = { fix, buggy, subject, kind, testFiles: tests, referees, buggyLines: lines };
  const introducedBy = await introducer(bugCase, scratch);
  const by = introducedBy ? `; ${introducedBy.verdict === 'introduced' ? 'brought in by' : `${introducedBy.verdict} at`} ${introducedBy.sha.slice(0, 7)}` : '; every suspect ruled out';
  return { ...base, verdict: v, note: `${referees.length} referee test${referees.length === 1 ? '' : 's'}${by}`, bugCase: { ...bugCase, ...(introducedBy && { introducedBy }) } };
}

async function main() {
  const fixes = parseFixes(readFileSync(path.join(DIR, 'fixes.txt'), 'utf8')).filter((f) => !only || f.sha.startsWith(only));
  if (!fixes.length) throw new Error(only ? `${only} isn't in scripts/bug-corpus/fixes.txt` : 'no fixes listed');
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'bug-corpus-'));
  const outcomes: Outcome[] = [];
  let next = 0;
  const worker = async () => {
    while (next < fixes.length) {
      const { sha, kind } = fixes[next++] ?? { sha: '', kind: '' };
      const outcome = await check(sha, kind, scratch).catch((err: unknown) => ({ fix: sha, kind, subject: '', verdict: 'error' as const, note: errorMessage(err) }));
      outcomes.push(outcome);
      console.log(`${outcome.verdict.padEnd(13)} ${sha.slice(0, 7)} ${kind.padEnd(9)} ${outcome.subject.slice(0, 70)}\n${' '.repeat(14)}${outcome.note.slice(0, 110)}`);
    }
  };
  try {
    await Promise.all(Array.from({ length: AT_ONCE }, worker));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
    await git('worktree', 'prune');
  }

  const order = new Map(fixes.map((f, i) => [f.sha, i]));
  outcomes.sort((a, b) => (order.get(a.fix) ?? 0) - (order.get(b.fix) ?? 0));
  const cases = outcomes.flatMap((o) => (o.bugCase ? [o.bugCase] : []));
  if (!only) {
    const others = outcomes.filter((o) => !o.bugCase).map(({ fix, kind, subject, verdict: v, note }) => ({ fix, kind, subject, verdict: v, note }));
    writeFileSync(path.join(DIR, 'corpus.json'), `${JSON.stringify({ cases, others }, null, 2)}\n`);
  }

  const tally = new Map<string, Record<string, number>>();
  for (const o of outcomes) {
    const row = tally.get(o.kind) ?? {};
    row[o.verdict] = (row[o.verdict] ?? 0) + 1;
    tally.set(o.kind, row);
  }
  const traced = cases.filter((c) => c.introducedBy);
  const confirmed = traced.filter((c) => c.introducedBy?.verdict === 'introduced');
  const byFix = traced.filter((c) => fixes.some((f) => c.introducedBy?.sha === f.sha));
  console.log(`\n${cases.length} of ${outcomes.length} fixes are cases; ${traced.length} traced to the commit that brought the bug in (${confirmed.length} confirmed by its tests), ${byFix.length} of those itself a fix`);
  for (const [kind, row] of tally) console.log(`  ${kind.padEnd(10)} ${Object.entries(row).map(([v, n]) => `${v} ${n}`).join(', ')}`);
}

await main();
