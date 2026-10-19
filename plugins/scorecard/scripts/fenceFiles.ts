// The ratchets' I/O (fenceRatchet.ts has the rules): the fence's files as the scorecard counts them, and the baselines.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FenceCounts } from './fenceRatchet';
import { scanSource } from './scorecardRules';

const ROOT = path.resolve(import.meta.dirname, '../../..');
export const BASELINE_FILE = path.join(ROOT, 'plugins/scorecard/fence-baseline.json');
export const CRAP_BASELINE_FILE = path.join(ROOT, 'plugins/scorecard/crap-baseline.json');

/** Each tracked source file's type assertions, over the fence's folders, tests left out, as the scorecard's fence counts them. */
export function fenceCounts(): FenceCounts {
  const files = execFileSync('git', ['ls-files', 'server/*.ts', 'shared/*.ts', 'plugins/*.ts', 'client/src/*.ts', 'tools/*.ts'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter((f) => f && !f.endsWith('.d.ts') && !f.endsWith('.test.ts'));
  return Object.fromEntries(files.flatMap((f) => {
    const n = scanSource(f, readFileSync(path.join(ROOT, f), 'utf8')).typeAssertions;
    return n > 0 ? [[f, n] as const] : [];
  }));
}

export function readBaseline(file = BASELINE_FILE): FenceCounts {
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) throw new Error(`${file} isn't a JSON object`);
  return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, number] => typeof e[1] === 'number'));
}

export function writeBaseline(counts: FenceCounts, file = BASELINE_FILE): void {
  writeFileSync(file, `${JSON.stringify(counts, null, 2)}\n`);
}
