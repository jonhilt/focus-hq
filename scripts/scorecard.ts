// Scorecard: measures Focus against its own standard, every number from a command run here, never from reading code by
// eye: the gate (typecheck, lint, tests with coverage, build) and how long it takes, the fence (type assertions, `any`,
// suppressions), how far the server is along the Effect path, the tests and CRAP, and the office's own health from the
// ledger. It saves each one in ~/.focus/scorecards/ and prints it with what changed since the one before
// (scripts/scorecardRules.ts has the rules). It measures; it exits 0 whatever the numbers unless it couldn't measure.
//
//   pnpm run scorecard                 measure, save, and compare with the latest saved one
//   pnpm run scorecard --no-save       measure and compare without saving
//   pnpm run scorecard --json          print the scorecard as JSON instead
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { paths } from '../server/config';
import { checkLedger } from '../shared/ledger';
import { CRAP_LINE, fromIstanbul, functionsIn, isDemo, score } from './crapScore';
import {
  effectMetrics, eslintCounts, fenceMetrics, gateMetrics, officeMetrics, render, scanSource, testMetrics, typecheckErrors,
  type CrapResults, type GateResults, type GateStep, type Scorecard, type SourceCounts,
} from './scorecardRules';

const ROOT = path.resolve(import.meta.dirname, '..');
const git = (...args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
const bin = (name: string) => path.join(ROOT, 'node_modules/.bin', name);

/** Runs one command and times it. */
function timed(command: string, args: string[]): GateStep & { output: string } {
  const started = performance.now();
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, shell: process.platform === 'win32' });
  return { pass: result.status === 0, seconds: (performance.now() - started) / 1000, output: `${result.stdout}\n${result.stderr}` };
}

const readJson = <T>(file: string): T | undefined => (existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : undefined);

/** The gate, one step at a time, each with its own report read for counts. Tests run once, with coverage for CRAP. */
function runGate(tmp: string, notes: string[]): { gate: GateResults; vitest?: VitestReport; coverageFile?: string } {
  const step = (name: string) => process.stderr.write(`  ${name}…\n`);
  process.stderr.write('Running the gate:\n');
  step('typecheck');
  const typecheck = timed('pnpm', ['run', '-s', 'typecheck']);
  step('lint');
  const eslintFile = path.join(tmp, 'eslint.json');
  const lint = timed(bin('eslint'), ['.', '-f', 'json', '-o', eslintFile]);
  const lintCounts = eslintCounts(readJson<{ errorCount: number; warningCount: number }[]>(eslintFile) ?? []);
  step('tests, with coverage');
  const vitestFile = path.join(tmp, 'vitest.json');
  const coverageDir = path.join(tmp, 'coverage');
  const test = timed(bin('vitest'), [
    'run', '--reporter=json', `--outputFile=${vitestFile}`, '--coverage.enabled', '--coverage.provider=v8', '--coverage.reporter=json',
    `--coverage.reportsDirectory=${coverageDir}`, '--coverage.reportOnFailure', '--coverage.include=server/**/*.ts', '--coverage.include=shared/**/*.ts',
  ]);
  const vitest = readJson<VitestReport>(vitestFile);
  if (!vitest) notes.push('vitest wrote no report, so the test counts are missing');
  step('build');
  // into a folder of its own: the office measures its own checkout, and may be serving dist/ from it
  const build = timed(bin('vite'), ['build', '--outDir', path.join(tmp, 'dist'), '--emptyOutDir']);
  const coverageFile = path.join(coverageDir, 'coverage-final.json');
  return {
    gate: {
      typecheck: { pass: typecheck.pass, seconds: typecheck.seconds, errors: typecheckErrors(typecheck.output) },
      lint: { pass: lint.pass, seconds: lint.seconds, ...lintCounts },
      test: { pass: test.pass, seconds: test.seconds, tests: vitest?.numTotalTests ?? 0, failed: vitest?.numFailedTests ?? 0 },
      build: { pass: build.pass, seconds: build.seconds },
    },
    vitest,
    coverageFile: existsSync(coverageFile) ? coverageFile : undefined,
  };
}

interface VitestReport {
  numTotalTests: number;
  numFailedTests: number;
  testResults: { name: string }[];
}

const tracked = (...globs: string[]) => git('ls-files', ...globs).split('\n').filter((f) => f && !f.endsWith('.d.ts'));
const isTest = (f: string) => f.endsWith('.test.ts');

const scanned = (files: string[]): (SourceCounts & { file: string })[] =>
  files.map((file) => ({ file, ...scanSource(file, readFileSync(path.join(ROOT, file), 'utf8')) }));

/** CRAP over server/ and shared/ as `pnpm run crap` scores it, from the gate's own coverage run. */
function crapOf(coverageFile: string): CrapResults {
  const coverage = JSON.parse(readFileSync(coverageFile, 'utf8')) as Record<string, Parameters<typeof fromIstanbul>[0]>;
  const rows = tracked('server/*.ts', 'shared/*.ts').filter((f) => !isTest(f) && !isDemo(f)).flatMap((f) => {
    const entry = coverage[path.join(ROOT, f)];
    return score(functionsIn(f, readFileSync(path.join(ROOT, f), 'utf8')), entry && fromIstanbul(entry));
  });
  return { functions: rows.length, over: rows.filter((r) => r.crap > CRAP_LINE).length, total: rows.reduce((n, r) => n + r.crap, 0) };
}

function latestSaved(): Scorecard | undefined {
  if (!existsSync(paths.scorecards)) return undefined;
  const latest = readdirSync(paths.scorecards).filter((f) => f.endsWith('.json')).sort().at(-1);
  return latest ? readJson<Scorecard>(path.join(paths.scorecards, latest)) : undefined;
}

function measure(): Scorecard {
  const notes: string[] = [];
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'focus-scorecard-'));
  const { gate, coverageFile } = runGate(tmp, notes);
  if (!coverageFile) notes.push('vitest wrote no coverage, so CRAP is missing');

  const code = scanned(tracked('server/*.ts', 'shared/*.ts', 'client/src/*.ts', 'scripts/*.ts'));
  const source = code.filter((f) => !isTest(f.file));
  const server = source.filter((f) => f.file.startsWith('server/') && !isDemo(f.file));
  const tests = code.filter((f) => isTest(f.file));

  const now = Date.now();
  const ledger = existsSync(paths.ledger) ? checkLedger(readFileSync(paths.ledger, 'utf8')).events : undefined;
  if (!ledger) notes.push(`no ledger at ${paths.ledger}, so the office's numbers are missing`);
  const office = ledger ? officeMetrics(ledger, now) : undefined;

  return {
    v: 1,
    at: now,
    commit: git('rev-parse', 'HEAD'),
    branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
    dirty: git('status', '--porcelain').length > 0,
    metrics: [
      ...gateMetrics(gate),
      ...fenceMetrics(source),
      ...effectMetrics(server),
      ...testMetrics(
        { total: gate.test.tests, files: tests.length, propertyFiles: tests.filter((f) => f.importsFastCheck).length },
        coverageFile ? crapOf(coverageFile) : undefined,
      ),
      ...(office?.metrics ?? []),
    ],
    frictions: office?.frictions ?? [],
    notes,
  };
}

function main() {
  const argv = process.argv.slice(2);
  const previous = latestSaved();
  const card = measure();
  if (!argv.includes('--no-save')) {
    mkdirSync(paths.scorecards, { recursive: true });
    const file = path.join(paths.scorecards, `${new Date(card.at).toISOString().replace(/[:.]/g, '-')}-${card.commit.slice(0, 8)}.json`);
    writeFileSync(file, `${JSON.stringify(card, null, 2)}\n`);
    process.stderr.write(`Saved ${file}\n\n`);
  }
  console.log(argv.includes('--json') ? JSON.stringify(card, null, 2) : render(card, previous));
}

main();
