// The state rules' reach: runs the descriptions' checks alone (`*Invariants.test.ts`, plugins' `invariants.test.ts`)
// with coverage, on seed 1 so two runs agree, and prints how much of each file that keeps state they reach
// (rulesCoverage.ts). It exits 0 unless it couldn't measure, or `--ratchet` finds a file off its baseline
// (README.md#the-ratchets).
//
//   pnpm run rules                     each file that keeps state, and how much of it the rules reach
//   pnpm run rules --ratchet           also fails (exit 1) when a file's reach went down, or up without its baseline
//                                      raised, or a new file keeps state that no description reaches
//   pnpm run rules --raise             raises the baseline to where each file is now; it never lowers one
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readBaseline, writeBaseline } from './fenceFiles';
import { heldFile, keepsState, percent, raised, type Reach, reachTable, ratchetVerdict, rulesMode } from './rulesCoverage';

const ROOT = path.resolve(import.meta.dirname, '../../..');
export const RULES_BASELINE_FILE = path.join(ROOT, 'plugins/scorecard/rules-baseline.json');

/** The source files that keep state, in server/ and plugins/. */
function heldFiles(): string[] {
  return execFileSync('git', ['ls-files', 'server/*.ts', 'plugins/*.ts'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((file) => file && heldFile(file) && keepsState(readFileSync(path.join(ROOT, file), 'utf8')));
}

interface Lines {
  lines: { total: number; covered: number };
}

/** Runs the descriptions' checks with v8 coverage, on seed 1, and returns each file's line counts. */
function runRules(): Record<string, Lines> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'focus-rules-'));
  console.log('Running the state rules\' checks with coverage…');
  const result = spawnSync(path.join(ROOT, 'node_modules/.bin/vitest'), [
    'run', 'Invariants.test', 'invariants.test', '--coverage.enabled', '--coverage.provider=v8', '--coverage.reporter=json-summary',
    `--coverage.reportsDirectory=${dir}`, '--coverage.include=server/**/*.ts', '--coverage.include=plugins/**/*.ts',
  ], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, FOCUS_TEST_SEED: '1' }, shell: process.platform === 'win32' });
  // a failing check is a failing check: the reach of a run that broke says nothing
  if (result.status !== 0) throw new Error(`The state rules' checks failed:\n${result.stdout.split('\n').filter((l) => /FAIL|×/.test(l)).join('\n')}`);
  const file = path.join(dir, 'coverage-summary.json');
  if (!existsSync(file)) throw new Error(`vitest wrote no coverage:\n${result.stderr || result.stdout}`);
  const summary: Record<string, Lines> = JSON.parse(readFileSync(file, 'utf8'));
  return summary;
}

function reach(files: string[], summary: Record<string, Lines>): Reach {
  return Object.fromEntries(files.map((file) => {
    const entry = summary[path.join(ROOT, file)];
    return [file, entry ? percent(entry.lines.covered, entry.lines.total) : 0];
  }));
}

function main() {
  const mode = rulesMode(process.argv.slice(2));
  const now = reach(heldFiles(), runRules());
  console.log(`\nHow much of each file that keeps state the state rules reach (seed 1):\n${reachTable(now)}`);
  if (mode === 'report') return;
  if (mode === 'raise') writeBaseline(raised(readBaseline(RULES_BASELINE_FILE), now), RULES_BASELINE_FILE);
  const verdict = ratchetVerdict(readBaseline(RULES_BASELINE_FILE), now);
  console.log(`\n${verdict.text}`);
  if (!verdict.holds) process.exitCode = 1;
}

main();
