// CRAP report: runs the unit tests with coverage, scores every function in server/ and shared/ (complexity² ×
// (1 − coverage)³ + complexity, scripts/crapScore.ts), and prints the spread and the riskiest. Advisory: it always exits 0
// unless it couldn't measure at all.
//
//   pnpm run crap                      server/ + shared/, the riskiest 10
//   pnpm run crap --all                client/src/ and scripts/ too
//   pnpm run crap --top 25             the riskiest 25
//   pnpm run crap --changed [base]     also what this branch touched since base (default: its merge base with main)
//   pnpm run crap --coverage <file>    score from an existing coverage-final.json instead of running the tests
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { changedLines, changedSummary, fromIstanbul, functionsIn, score, summary, type Scored } from './crapScore';

const ROOT = path.resolve(import.meta.dirname, '..');
const git = (...args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** The demo's fakes and scripts stand in for GitHub and Claude Code: nothing ships through them. */
const DEMO = /(^|\/)demo([A-Z.]|\.ts$)/;

function args() {
  const argv = process.argv.slice(2);
  const after = (flag: string) => {
    const i = argv.indexOf(flag);
    if (i < 0) return undefined;
    const next = argv[i + 1];
    return next && !next.startsWith('--') ? next : '';
  };
  const changed = after('--changed');
  return { all: argv.includes('--all'), top: Number(after('--top')) || 10, changed, coverage: after('--coverage') || undefined };
}

function sourceFiles(all: boolean): string[] {
  const globs = all ? ['server/*.ts', 'shared/*.ts', 'client/src/*.ts', 'scripts/*.ts'] : ['server/*.ts', 'shared/*.ts'];
  return git('ls-files', ...globs).split('\n').filter((f) => f && !f.endsWith('.test.ts') && !f.endsWith('.d.ts') && (all || !DEMO.test(f)));
}

/** Runs vitest with v8 coverage into a temporary folder and returns its coverage-final.json. */
function runCoverage(all: boolean): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'focus-crap-'));
  const include = (all ? ['server', 'shared', 'client/src', 'scripts'] : ['server', 'shared']).map((d) => `--coverage.include=${d}/**/*.ts`);
  console.log('Running the unit tests with coverage…');
  const result = spawnSync(path.join(ROOT, 'node_modules/.bin/vitest'), [
    'run', '--coverage.enabled', '--coverage.provider=v8', '--coverage.reporter=json', `--coverage.reportsDirectory=${dir}`,
    '--coverage.reportOnFailure', ...include,
  ], { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    const failed = `${result.stdout}\n${result.stderr}`.split('\n').filter((line) => /^\s*FAIL\s/.test(line));
    console.warn(`Some tests failed (coverage counts what ran anyway):\n${failed.join('\n')}\n`);
  }
  const file = path.join(dir, 'coverage-final.json');
  if (!existsSync(file)) throw new Error(`vitest wrote no coverage:\n${result.stderr || result.stdout}`);
  return file;
}

function scoreAll(files: string[], coverageFile: string): Scored[] {
  const coverage = JSON.parse(readFileSync(coverageFile, 'utf8')) as Record<string, Parameters<typeof fromIstanbul>[0]>;
  return files.flatMap((file) => {
    const entry = coverage[path.join(ROOT, file)];
    return score(functionsIn(file, readFileSync(path.join(ROOT, file), 'utf8')), entry && fromIstanbul(entry));
  });
}

function mergeBase(): string {
  for (const ref of ['origin/main', 'main']) {
    try {
      return git('merge-base', 'HEAD', ref).trim();
    } catch {
      // try the next
    }
  }
  throw new Error('No main branch to compare with: pass a base, like --changed origin/main');
}

/** What the branch touched since `base` (its merge base with main when empty). */
function changedSince(base: string, rows: Scored[], files: string[]): string {
  const ref = base || mergeBase();
  const label = base || `merge base with main (${ref.slice(0, 8)})`;
  return changedSummary(rows, changedLines(git('diff', '--unified=0', ref, '--', ...files)), label);
}

function main() {
  const { all, top, changed, coverage } = args();
  const files = sourceFiles(all);
  const rows = scoreAll(files, coverage ?? runCoverage(all));
  const scope = all ? 'server, shared, client and scripts' : 'server and shared (demo code left out)';
  console.log(`CRAP for ${scope}: complexity² × (1 − coverage)³ + complexity\n\n${summary(rows, top)}`);
  if (changed !== undefined) console.log(`\n${changedSince(changed, rows, files)}`);
}

main();
