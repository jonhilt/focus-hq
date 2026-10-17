import type { QaReport } from '../../shared/types';
import type { BuggyLine } from './bugCorpus';

// The bug replay (docs/bug-corpus.md#replaying-qa): QA's own review of each commit that brought a real bug in, from the
// bug corpus, scored on whether QA failed it and pointed at the bug. Every one of them got past QA once; the replay
// says how many today's QA (or a change to it) would stop. The rules are here, pure; the clones and the review sessions
// are in scripts/bugReplay.ts.

/** Where a review should point: the bug's lines in the commit that brought it in, or only its files when they're unknown. */
export type BugSite = { file: string; line?: number };

export const sitesOf = (lines: BuggyLine[], files: string[]): BugSite[] => (lines.length ? lines : files.map((file) => ({ file })));

/**
 * How QA did against a real bug: `caught` when it failed the change and its report points at the bug (one of the bug's
 * files, by name, in a failed check or the fix instructions, or a spot-check within 5 lines of one of its lines);
 * `failed-elsewhere` when it failed it for something else; `missed` when it passed it.
 */
export type ReplayOutcome = 'caught' | 'failed-elsewhere' | 'missed';

export function scoreReplay(report: QaReport, sites: BugSite[]): ReplayOutcome {
  if (report.verdict === 'pass') return 'missed';
  const base = (file: string) => file.split('/').pop() ?? file;
  const names = [...new Set(sites.map((s) => base(s.file)))];
  const words = [report.fixInstructions ?? '', ...report.checks.filter((c) => c.result === 'fail').map((c) => `${c.name} ${c.details}`)].join('\n');
  const near = (file: string, line?: number) => sites.some((s) => base(file) === base(s.file) && (s.line === undefined || line === undefined || Math.abs(line - s.line) <= 5));
  const pointed = names.some((n) => words.includes(n)) || (report.spotChecks ?? []).some((s) => near(s.file, s.line));
  return pointed ? 'caught' : 'failed-elsewhere';
}

/** One real bug's replay: the fix, the commit that brought the bug in, how QA did, and what the review cost. */
export interface ReplayResult {
  fix: string;
  kind: string;
  introducedBy: string;
  pr?: number;
  outcome: ReplayOutcome | 'error';
  /** QA's summary, or why the review didn't finish. */
  summary: string;
  costUsd?: number;
  minutes?: number;
}

/** A control: a commit no listed bug came from, reviewed the same way. QA failing it is (most likely) a false alarm. */
export interface ReplayControl {
  sha: string;
  pr?: number;
  outcome: 'clean' | 'false-alarm' | 'error';
  summary: string;
  costUsd?: number;
  minutes?: number;
}

/** A saved run of `pnpm run bug-replay`, as ~/.focus/bug-replay/ keeps it. */
export interface ReplayRun {
  at: number;
  model: string;
  results: ReplayResult[];
  controls?: ReplayControl[];
}

/**
 * `count` controls from main's history (oldest first, already narrowed to code changes), spread evenly over it: commits
 * no listed bug came from and no listed fix made, so a QA that fails everything can't look like one that catches everything.
 */
export function pickControls(history: { sha: string; subject: string }[], exclude: Set<string>, count: number): { sha: string; subject: string }[] {
  const pool = history.filter((c) => !exclude.has(c.sha));
  if (count <= 0 || !pool.length) return [];
  const step = pool.length / Math.min(count, pool.length);
  return Array.from({ length: Math.min(count, pool.length) }, (_, i) => pool[Math.floor(i * step + step / 2)]).filter((c) => c !== undefined);
}

/** Whether a commit changed the office's code (not only tests, docs or assets): a control has to be a change QA could find a bug in. */
const CODE = /^(server|shared|plugins|plugin-api|client\/src)\/.*\.ts$/;
export const changesCode = (files: string[]) => files.some((f) => CODE.test(f) && !f.endsWith('.test.ts'));

/** The result as the terminal prints it: the rate, then each bug. */
export function replayLines(results: ReplayResult[], controls: ReplayControl[]): string[] {
  const count = (o: ReplayResult['outcome']) => results.filter((r) => r.outcome === o).length;
  const finished = results.length - count('error');
  const cost = [...results, ...controls].reduce((n, r) => n + (r.costUsd ?? 0), 0);
  const mark: Record<ReplayResult['outcome'], string> = { caught: '✓ caught', 'failed-elsewhere': '~ failed it, elsewhere', missed: '✗ missed', error: '! no verdict' };
  const alarms = controls.filter((c) => c.outcome === 'false-alarm');
  const clean = controls.filter((c) => c.outcome !== 'error');
  return [
    `QA caught ${count('caught')} of ${finished} real bugs in the commits that brought them in · ${count('failed-elsewhere')} failed for something else · ${count('missed')} missed${count('error') ? ` · ${count('error')} without a verdict` : ''} · $${cost.toFixed(2)}`,
    ...(controls.length ? [`Controls: QA failed ${alarms.length} of ${clean.length} commits no listed bug came from${alarms.length ? `: ${alarms.map((c) => c.sha.slice(0, 7)).join(', ')}` : ''}`] : []),
    ...results.map((r) => `  ${mark[r.outcome].padEnd(24)} ${r.kind.padEnd(9)} ${r.introducedBy.slice(0, 7)}${r.pr ? ` #${r.pr}` : ''} → fixed in ${r.fix.slice(0, 7)}`),
  ];
}
