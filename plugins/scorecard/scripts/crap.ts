// CRAP report: runs the unit tests with coverage, scores every function in server/ and shared/ (complexity² ×
// (1 − coverage)³ + complexity, scripts/crapScore.ts), and prints the spread and the riskiest. Advisory: it exits 0
// unless it couldn't measure at all, or `--ratchet` finds a file's functions over 30 off its baseline (README.md#the-ratchets).
//
//   pnpm run crap                      server/ + shared/, the riskiest 10
//   pnpm run crap --all                client/src/ and scripts/ too
//   pnpm run crap --top 25             the riskiest 25
//   pnpm run crap --changed [base]     also what this branch touched since it left base (main by default)
//   pnpm run crap --coverage <file>    score from an existing coverage-final.json instead of running the tests
//   pnpm run crap --ratchet            also fails (exit 1) when a file has more functions over 30 than its baseline, or fewer
//   pnpm run crap --lower              lowers the baseline to where each file is now; it never raises one
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CRAP_LINE, changedLines, changedSummary, fromIstanbul, functionsIn, isDemo, overByFile, score, summary, table, type Scored } from './crapScore';
import { CRAP_BASELINE_FILE, readBaseline, writeBaseline } from './fenceFiles';
import { CRAP_WORDS, fenceDrift, lowered, ratchetMessage, ratchetMode, type RatchetMode } from './fenceRatchet';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const git = (...args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

function args() {
  const argv = process.argv.slice(2);
  const after = (flag: string) => {
    const i = argv.indexOf(flag);
    if (i < 0) return undefined;
    const next = argv[i + 1];
    return next && !next.startsWith('--') ? next : '';
  };
  const changed = after('--changed');
  return {
    all: argv.includes('--all'), top: Number(after('--top')) || 10, changed, coverage: after('--coverage') || undefined,
    ratchet: ratchetMode(argv),
  };
}

function sourceFiles(all: boolean): string[] {
  const globs = all ? ['server/*.ts', 'shared/*.ts', 'plugins/*.ts', 'client/src/*.ts', 'scripts/*.ts'] : ['server/*.ts', 'shared/*.ts', 'plugins/*.ts'];
  return git('ls-files', ...globs).split('\n').filter((f) => f && !f.endsWith('.test.ts') && !f.endsWith('.d.ts') && (all || !isDemo(f)));
}

/** Runs vitest with v8 coverage into a temporary folder and returns its coverage-final.json. */
function runCoverage(all: boolean): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'focus-crap-'));
  const include = (all ? ['server', 'shared', 'plugins', 'client/src', 'scripts'] : ['server', 'shared', 'plugins']).map((d) => `--coverage.include=${d}/**/*.ts`);
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

/** Where the branch left `base` (or main), so what's landed there since doesn't count as the branch's own changes. */
function mergeBase(base: string): string {
  for (const ref of base ? [base] : ['origin/main', 'main']) {
    try {
      return git('merge-base', 'HEAD', ref).trim();
    } catch {
      // try the next
    }
  }
  throw new Error('No main branch to compare with: pass a base, like --changed origin/main');
}

/** What the branch touched since it left `base` (main when empty). */
function changedSince(base: string, rows: Scored[], files: string[]): string {
  const ref = mergeBase(base);
  const label = `merge base with ${base || 'main'} (${ref.slice(0, 8)})`;
  return changedSummary(rows, changedLines(git('diff', '--unified=0', ref, '--', ...files)), label);
}

/** Lowers the baseline to each file's functions over 30 now: never raises one. */
function lowerCrapBaseline(counts: Record<string, number>) {
  const sum = (c: Record<string, number>) => Object.values(c).reduce((n, v) => n + v, 0);
  const baseline = readBaseline(CRAP_BASELINE_FILE);
  const next = lowered(baseline, counts);
  writeBaseline(next, CRAP_BASELINE_FILE);
  console.log(`\nFunctions over CRAP ${CRAP_LINE} baseline: ${sum(baseline)} → ${sum(next)}`);
}

/** Whether every file's functions over 30 match its baseline; prints what drifted, and the culprits in the files that went up. */
function crapRatchetHolds(rows: Scored[], counts: Record<string, number>): boolean {
  const drift = fenceDrift(readBaseline(CRAP_BASELINE_FILE), counts);
  const message = ratchetMessage(drift, CRAP_WORDS);
  if (!message) {
    console.log(`\nRatchet holds: ${rows.filter((r) => r.crap > CRAP_LINE).length} functions over CRAP ${CRAP_LINE}, none more than its file's baseline.`);
    return true;
  }
  const up = new Set(drift.over.map((d) => d.file));
  const culprits = rows.filter((r) => up.has(r.file) && r.crap > CRAP_LINE);
  console.log(`\n${message}${culprits.length ? `\n\nOver ${CRAP_LINE} in the files that went up:\n${table(culprits)}` : ''}`);
  return false;
}

/** The CRAP ratchet, when asked for: lowers the baseline first with `--lower`, then checks it, failing the run if it drifted. */
function holdRatchet(rows: Scored[], mode: RatchetMode | undefined) {
  if (!mode) return;
  const counts = overByFile(rows);
  if (mode === 'lower') lowerCrapBaseline(counts);
  if (!crapRatchetHolds(rows, counts)) process.exitCode = 1;
}

function main() {
  const { all, top, changed, coverage, ratchet } = args();
  const files = sourceFiles(all);
  const rows = scoreAll(files, coverage ?? runCoverage(all));
  const scope = all ? 'server, shared, plugins, client and scripts' : 'server, shared and plugins (demo code left out)';
  console.log(`CRAP for ${scope}: complexity² × (1 − coverage)³ + complexity\n\n${summary(rows, top)}`);
  if (changed !== undefined) console.log(`\n${changedSince(changed, rows, files)}`);
  holdRatchet(rows, ratchet);
}

main();
