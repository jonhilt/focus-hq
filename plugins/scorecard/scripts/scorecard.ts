// Scorecard: measures Focus against its own standard, every number from a command run here, never from reading code by
// eye: the gate (typecheck, lint, tests with coverage, build) and how long it takes, the fence (type assertions, `any`,
// suppressions), how far the server is along the Effect path, the tests and CRAP, and Ops' own health from the
// ledger. It saves each one in the plugin's folder (~/.focus/plugins/scorecard/) and prints it with what changed since the one before
// (scripts/scorecardRules.ts has the rules). It measures; it exits 0 whatever the numbers unless it couldn't measure.
//
//   pnpm run scorecard                 measure, save, and compare with the latest saved one
//   pnpm run scorecard --no-save       measure and compare without saving
//   pnpm run scorecard --json          print the scorecard as JSON instead
//   pnpm run scorecard --repeat 5      measure 5 times on this commit and save how far each number wobbles (its noise
//                                      floor), which every comparison after uses: a change has to move further to count
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { focusLedger } from '../../../plugin-api/server';
import { scorecardsDir } from '../desk';
import { noiseOf } from '../scorecard';
import type { ScorecardNoise } from '../types';
import { CRAP_LINE, fromIstanbul, functionsIn, isDemo, score } from './crapScore';
import {
  failedTests, gateResults, opsMetrics, promiseIo, propertyTestFiles, render, renderNoise, savedName, scanSource, scorecardArgs, scorecardOf,
  type CrapResults, type GateResults, type RanStep, type Scorecard, type SourceCounts, type VitestReport,
} from './scorecardRules';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const SCORECARDS_DIR = scorecardsDir();
const git = (...args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
const bin = (name: string) => path.join(ROOT, 'node_modules/.bin', name);

/** Runs one command and times it. */
function timed(command: string, args: string[]): RanStep {
  const started = performance.now();
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, shell: process.platform === 'win32' });
  return { pass: result.status === 0, seconds: (performance.now() - started) / 1000, output: `${result.stdout}\n${result.stderr}` };
}

const readJson = <T>(file: string): T | undefined => (existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : undefined);

/** The gate, one step at a time, each with its own report read for counts. Tests run once, with coverage for CRAP. */
function runGate(tmp: string): { gate: GateResults; vitest?: VitestReport; coverageFile: string } {
  const step = (name: string) => process.stderr.write(`  ${name}…\n`);
  process.stderr.write('Running the gate:\n');
  step('typecheck');
  const typecheck = timed('pnpm', ['run', '-s', 'typecheck']);
  step('lint');
  const eslintFile = path.join(tmp, 'eslint.json');
  const lint = timed(bin('eslint'), ['.', '-f', 'json', '-o', eslintFile]);
  step('tests, with coverage');
  const vitestFile = path.join(tmp, 'vitest.json');
  const coverageDir = path.join(tmp, 'coverage');
  const test = timed(bin('vitest'), [
    'run', '--reporter=json', `--outputFile=${vitestFile}`, '--coverage.enabled', '--coverage.provider=v8', '--coverage.reporter=json',
    `--coverage.reportsDirectory=${coverageDir}`, '--coverage.reportOnFailure', '--coverage.include=server/**/*.ts', '--coverage.include=shared/**/*.ts', '--coverage.include=plugins/**/*.ts',
  ]);
  const vitest = readJson<VitestReport>(vitestFile);
  // each failure by name, with the command that runs it again on its seed (vitest.setup.ts)
  for (const failure of vitest ? failedTests(vitest, ROOT, Number(process.env.FOCUS_TEST_SEED ?? 1)) : []) process.stderr.write(`    failed: ${failure.replaceAll('\n', '\n    ')}\n`);
  step('build');
  // into a folder of its own: Focus measures its own checkout, and may be serving dist/ from it
  const build = timed(bin('vite'), ['build', '--outDir', path.join(tmp, 'dist'), '--emptyOutDir']);
  const eslint = readJson<{ errorCount: number; warningCount: number }[]>(eslintFile);
  return { gate: gateResults({ typecheck, lint, test, build }, eslint, vitest), vitest, coverageFile: path.join(coverageDir, 'coverage-final.json') };
}

const tracked = (...globs: string[]) => git('ls-files', ...globs).split('\n').filter((f) => f && !f.endsWith('.d.ts'));
const isTest = (f: string) => f.endsWith('.test.ts');

const scanned = (files: string[]): (SourceCounts & { file: string })[] =>
  files.map((file) => ({ file, ...scanSource(file, readFileSync(path.join(ROOT, file), 'utf8')) }));

/** CRAP over server/ and shared/ as `pnpm run crap` scores it, from the gate's own coverage run (none when it wrote none). */
function crapOf(coverageFile: string): CrapResults | undefined {
  if (!existsSync(coverageFile)) return undefined;
  const coverage = JSON.parse(readFileSync(coverageFile, 'utf8')) as Record<string, Parameters<typeof fromIstanbul>[0]>;
  const rows = tracked('server/*.ts', 'shared/*.ts', 'plugins/*.ts').filter((f) => !isTest(f) && !isDemo(f)).flatMap((f) => {
    const entry = coverage[path.join(ROOT, f)];
    return score(functionsIn(f, readFileSync(path.join(ROOT, f), 'utf8')), entry && fromIstanbul(entry));
  });
  return { functions: rows.length, over: rows.filter((r) => r.crap > CRAP_LINE).length, total: rows.reduce((n, r) => n + r.crap, 0) };
}

function latestSaved(): Scorecard | undefined {
  if (!existsSync(SCORECARDS_DIR)) return undefined;
  const latest = readdirSync(SCORECARDS_DIR).filter((f) => f.endsWith('.json')).sort().at(-1);
  return latest ? readJson<Scorecard>(path.join(SCORECARDS_DIR, latest)) : undefined;
}

const noiseDir = path.join(SCORECARDS_DIR, 'noise');

/** The latest noise floor saved by `--repeat`, if any. */
function latestNoise(): ScorecardNoise | undefined {
  if (!existsSync(noiseDir)) return undefined;
  const latest = readdirSync(noiseDir).filter((f) => f.endsWith('.json')).sort().at(-1);
  return latest ? readJson<ScorecardNoise>(path.join(noiseDir, latest)) : undefined;
}

function measure(): Scorecard {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'focus-scorecard-'));
  const { gate, vitest, coverageFile } = runGate(tmp);

  const code = scanned(tracked('server/*.ts', 'shared/*.ts', 'plugins/*.ts', 'client/src/*.ts', 'tools/*.ts'));
  const source = code.filter((f) => !isTest(f.file));
  const server = source.filter((f) => f.file.startsWith('server/') && !isDemo(f.file));
  const tests = code.filter((f) => isTest(f.file));
  const outside = promiseIo(server).map((f) => f.file);
  if (outside.length) process.stderr.write(`\nServer files doing I/O outside Effect (${outside.length}):\n  ${outside.join('\n  ')}\n`);

  const at = Date.now();
  const { file: ledgerFile, events: ledger } = focusLedger();
  return scorecardOf({
    head: {
      at,
      commit: git('rev-parse', 'HEAD'),
      branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
      // untracked files (an editor's folder, say) aren't measured, so they don't make the commit's numbers someone else's
      dirty: git('status', '--porcelain', '--untracked-files=no').length > 0,
    },
    gate,
    vitest,
    crap: crapOf(coverageFile),
    source,
    server,
    tests: { files: tests.length, propertyFiles: propertyTestFiles(tests, code).length },
    ops: ledger && opsMetrics(ledger, at),
    ledgerFile,
  });
}

/** `--repeat n`: n measurements of this commit, saved as its noise floor (they never join the scorecards' history). */
function repeat(times: number, save: boolean, json: boolean) {
  const cards = Array.from({ length: times }, (_, i) => {
    process.stderr.write(`\nRun ${i + 1} of ${times}\n`);
    return measure();
  });
  const noise = noiseOf(cards);
  if (!noise) {
    process.stderr.write('Can’t take a noise floor: the runs need one commit and no uncommitted changes.\n');
    process.exit(1);
  }
  if (save) {
    mkdirSync(noiseDir, { recursive: true });
    const file = path.join(noiseDir, savedName(noise.at, noise.commit));
    writeFileSync(file, `${JSON.stringify(noise, null, 2)}\n`);
    process.stderr.write(`Saved ${file}\n\n`);
  }
  console.log(json ? JSON.stringify(noise, null, 2) : renderNoise(noise, cards[0]));
}

function main() {
  const args = scorecardArgs(process.argv.slice(2));
  if (args.repeat) return repeat(args.repeat, args.save, args.json);
  const previous = latestSaved();
  const card = measure();
  if (args.save) {
    mkdirSync(SCORECARDS_DIR, { recursive: true });
    const file = path.join(SCORECARDS_DIR, savedName(card.at, card.commit));
    writeFileSync(file, `${JSON.stringify(card, null, 2)}\n`);
    process.stderr.write(`Saved ${file}\n\n`);
  }
  console.log(args.json ? JSON.stringify(card, null, 2) : render(card, previous, latestNoise()));
}

main();
