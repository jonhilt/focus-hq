import type { QaReport } from '../../shared/types';
import type { BuggyLine } from './bugCorpus';

// The bug replay (docs/bug-corpus.md#replaying-qa): QA's own review of each commit that brought a real bug in, from the
// bug corpus, scored on whether QA stopped it for that bug. Every one of them got past QA once; the replay says how many
// today's QA would stop. The rules are here, pure; the clones,
// the review sessions and the judge are in tools/bugReplay.ts.

/** Where a review should point: the bug's lines in the commit that brought it in, or only its files when they're unknown. */
export type BugSite = { file: string; line?: number };

export const sitesOf = (lines: BuggyLine[], files: string[]): BugSite[] => (lines.length ? lines : files.map((file) => ({ file })));

/** Whether QA's report points at the bug's code: one of its files by name in a failed check or the fix instructions, or
 *  a spot-check within 5 lines of one of its lines. A weak sign: the first baseline's three "catches" this way were all
 *  other bugs in the same files. Kept beside the judge's verdict to show how far apart they are. */
export function pointsAt(report: QaReport, sites: BugSite[]): boolean {
  const base = (file: string) => file.split('/').pop() ?? file;
  const names = [...new Set(sites.map((s) => base(s.file)))];
  const words = [report.fixInstructions ?? '', ...report.checks.filter((c) => c.result === 'fail').map((c) => `${c.name} ${c.details}`)].join('\n');
  const near = (file: string, line?: number) => sites.some((s) => base(file) === base(s.file) && (s.line === undefined || line === undefined || Math.abs(line - s.line) <= 5));
  return names.some((n) => words.includes(n)) || (report.spotChecks ?? []).some((s) => near(s.file, s.line));
}

/**
 * Which review a saved run is of. `proof`: Focus's QA as it is now, which blocks a change only with proof that holds
 * when it's checked (docs/qa.md#proof). Runs from before that are `qa` (QA's verdict on its say-so) or `hunt` (the
 * experiment it came from, the hunting guidance with the replay checking vitest proof files).
 */
export type Arm = 'qa' | 'hunt' | 'proof';

/**
 * How a review did against a real bug: `caught` when it stopped the change and the judge, holding the fix's own diff,
 * says one of its findings is that bug; `failed-elsewhere` when it stopped it for something else; `missed` when it let
 * it through.
 */
export type ReplayOutcome = 'caught' | 'failed-elsewhere' | 'missed';

export function scoreReplay(blocked: boolean, sameBug: boolean): ReplayOutcome {
  if (!blocked) return 'missed';
  return sameBug ? 'caught' : 'failed-elsewhere';
}

/** The judge's answer: whether a finding in the report is the bug the fix fixed, which one, and why. */
export interface Judged {
  sameBug: boolean;
  finding: string;
  why: string;
}

export const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    sameBug: { type: 'boolean', description: 'true only if one of the findings is the very defect the fix corrects' },
    finding: { type: 'string', description: 'that finding, quoted, or "" if none' },
    why: { type: 'string', description: 'one or two sentences' },
  },
  required: ['sameBug', 'finding', 'why'],
  additionalProperties: false,
} as const;

export const JUDGE_SYSTEM = `You judge one thing: whether a code review found a specific, known bug. You're given the commit that later fixed the bug (its message and diff: the answer key) and the review's findings on the earlier change that brought the bug in. Say sameBug true only if a finding describes the same faulty behaviour the fix corrects: the same wrong outcome, from the same cause or the same code path. The same file, the same feature or a different bug nearby is not enough. A vague worry ("this may have edge cases") is not enough. When in doubt, say false.`;

/** What the judge is asked: the fix as the answer key, then what the review found (its failed checks, fix instructions, spot-checks and the proofs that held). */
export function judgePrompt(fix: { subject: string; diff: string }, report: QaReport, maxDiff = 12_000): string {
  const diff = fix.diff.length > maxDiff ? `${fix.diff.slice(0, maxDiff)}\n… (cut)` : fix.diff;
  const failed = report.checks.filter((c) => c.result === 'fail').map((c) => `- ${c.name}: ${c.details}`);
  const spots = (report.spotChecks ?? []).map((s) => `- ${s.file}${s.line ? `:${s.line}` : ''}: ${s.why}`);
  const proofs = (report.proofs ?? []).filter((p) => p.outcome === 'failed').map((p) => `- ${p.kind === 'test' ? p.file : p.kind === 'check' ? p.command : 'screenshot'}: ${p.finding}${p.note ? ` (${p.note})` : ''}`);
  return [
    '## The fix (the answer key)',
    fix.subject,
    '```diff',
    diff,
    '```',
    '## The review of the earlier change',
    `Verdict: ${report.verdict}`,
    `Summary: ${report.summary}`,
    failed.length ? `Failed checks:\n${failed.join('\n')}` : 'Failed checks: none',
    report.fixInstructions ? `Fix instructions: ${report.fixInstructions}` : '',
    spots.length ? `Spot-checks:\n${spots.join('\n')}` : '',
    proofs.length ? `Proof that held:\n${proofs.join('\n')}` : '',
    '',
    'Is one of these findings the bug the fix corrects?',
  ]
    .filter(Boolean)
    .join('\n');
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
  /** Whether the report pointed at the bug's file or lines, the old, looser score. */
  pointed?: boolean;
  judged?: Judged;
  /** The whole report, so a judge's call can be checked by hand. */
  report?: QaReport;
  costUsd?: number;
  minutes?: number;
}

/** A control: a commit no listed bug came from, reviewed the same way. QA failing it is (most likely) a false alarm. */
export interface ReplayControl {
  sha: string;
  pr?: number;
  outcome: 'clean' | 'false-alarm' | 'error';
  summary: string;
  report?: QaReport;
  costUsd?: number;
  minutes?: number;
}

/** A saved run of `pnpm run bug-replay`, as ~/.focus/bug-replay/ keeps it. */
export interface ReplayRun {
  at: number;
  arm: Arm;
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

/** Whether a commit changed Focus's code (not only tests, docs or assets): a control has to be a change QA could find a bug in. */
const CODE = /^(server|shared|plugins|plugin-api|client\/src)\/.*\.ts$/;
export const changesCode = (files: string[]) => files.some((f) => CODE.test(f) && !f.endsWith('.test.ts'));

/** The result as the terminal prints it: the rate, the controls, then each bug. */
export function replayLines(arm: Arm, results: ReplayResult[], controls: ReplayControl[]): string[] {
  const count = (o: ReplayResult['outcome']) => results.filter((r) => r.outcome === o).length;
  const finished = results.length - count('error');
  const pointed = results.filter((r) => r.pointed && r.outcome !== 'missed').length;
  const cost = [...results, ...controls].reduce((n, r) => n + (r.costUsd ?? 0), 0);
  const mark: Record<ReplayResult['outcome'], string> = { caught: '✓ caught', 'failed-elsewhere': '~ stopped, for another bug', missed: '✗ missed', error: '! no verdict' };
  const alarms = controls.filter((c) => c.outcome === 'false-alarm');
  const clean = controls.filter((c) => c.outcome !== 'error');
  const who = arm === 'hunt' ? 'The hunting review' : arm === 'proof' ? 'QA (blocking only with proof)' : 'QA';
  return [
    `${who} caught ${count('caught')} of ${finished} real bugs in the commits that brought them in · stopped ${count('failed-elsewhere')} more for another bug · missed ${count('missed')}${count('error') ? ` · ${count('error')} without a verdict` : ''} · (pointed at the bug's file: ${pointed}) · $${cost.toFixed(2)}`,
    ...(controls.length ? [`Controls: stopped ${alarms.length} of ${clean.length} commits no listed bug came from${alarms.length ? `: ${alarms.map((c) => c.sha.slice(0, 7)).join(', ')}` : ''}`] : []),
    ...results.map((r) => `  ${mark[r.outcome].padEnd(28)} ${r.kind.padEnd(9)} ${r.introducedBy.slice(0, 7)}${r.pr ? ` #${r.pr}` : ''} → fixed in ${r.fix.slice(0, 7)}${r.judged?.finding ? `: ${r.judged.finding.slice(0, 90)}` : ''}`),
  ];
}
