import type { QaReport } from '../../shared/types';
import { type BuggyLine, missingCode, type VitestRun } from './bugCorpus';

// The bug replay (docs/bug-corpus.md#replaying-qa): QA's own review of each commit that brought a real bug in, from the
// bug corpus, scored on whether QA stopped it for that bug. Every one of them got past QA once; the replay says how many
// today's QA, or a change to it (an arm: the hunting review below), would stop. The rules are here, pure; the clones,
// the review sessions and the judge are in scripts/bugReplay.ts.

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

/** Which review ran: the office's QA as it is, or QA told to hunt the corpus's kinds of bug and prove each with a failing test. */
export type Arm = 'qa' | 'hunt';

/** A test a hunting review wrote to prove a finding: a `*.proof.test.ts` file, run by the replay itself. */
export const PROOF_FILE = /\.proof\.test\.ts$/;

/** The proof files in a clone after its review, from `git status --porcelain`: new or changed. */
export const proofFiles = (porcelain: string) =>
  porcelain
    .split('\n')
    .map((l) => l.slice(3).trim())
    .filter((f) => PROOF_FILE.test(f));

/** What the replay's own run of a review's proof files showed: the tests that failed on an assertion, in files that loaded. */
export interface Proof {
  files: string[];
  failing: { file: string; name: string; message: string }[];
}

export function proofOf(files: string[], run: VitestRun | undefined): Proof {
  const unloaded = new Set((run?.loadErrors ?? []).map((e) => e.file));
  const failing = (run?.tests ?? []).filter((t) => !t.passed && !missingCode(t.message) && !unloaded.has(t.file)).map(({ file, name, message }) => ({ file, name, message: message.split('\n')[0] ?? '' }));
  return { files, failing };
}

/**
 * Whether a review stops the change. The office's QA stops it on its own verdict. The hunting review stops it only with
 * proof: QA failed it and at least one of its proof tests fails when the replay runs it. A finding without one is advice.
 */
export function blocks(arm: Arm, report: QaReport, proof?: Proof): boolean {
  if (report.verdict !== 'fail') return false;
  return arm === 'qa' || (proof?.failing.length ?? 0) > 0;
}

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

/** What the judge is asked: the fix as the answer key, then what the review found (its failed checks, fix instructions, spot-checks and proof). */
export function judgePrompt(fix: { subject: string; diff: string }, report: QaReport, proof?: Proof, maxDiff = 12_000): string {
  const diff = fix.diff.length > maxDiff ? `${fix.diff.slice(0, maxDiff)}\n… (cut)` : fix.diff;
  const failed = report.checks.filter((c) => c.result === 'fail').map((c) => `- ${c.name}: ${c.details}`);
  const spots = (report.spotChecks ?? []).map((s) => `- ${s.file}${s.line ? `:${s.line}` : ''}: ${s.why}`);
  const proofs = (proof?.failing ?? []).map((t) => `- ${t.file} › ${t.name}: ${t.message}`);
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
    proofs.length ? `Failing proof tests:\n${proofs.join('\n')}` : '',
    '',
    'Is one of these findings the bug the fix corrects?',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * What the hunting review is told, beside the office's QA instructions: the kinds of bug that got past QA here (the bug
 * corpus's, docs/bug-corpus.md), how to hunt them, and that a finding stops the change only with a failing test.
 */
export const HUNT_BRIEF = `
## Hunting the bugs that get past review here

Bugs that reached main in this repo were rarely in the code as it reads: they were in paths the change's own tests never walk. Before your verdict, hunt these in the changed code:

- **Restart, shutdown and close.** State that's persisted, restored or cleared: what happens across a clean shutdown and restart, a crash mid-way, a close and reopen, a slice moving on? Flags left set (\`redrawing\`, \`held\`), lists reset (\`prs: []\`), a stop that clears what should survive.
- **Two things at once.** The same action twice in quick succession, or two callers at once: double launches, a second accept while the first is still filing, an older copy overwriting a newer one, a read just after a push that sees the old state.
- **Assumptions about git, GitHub, the SDK and the shell.** A ref that hasn't moved, a status that's \`UNKNOWN\` for a while, a glob or quote the shell reads differently, a stream that arrives before it's whole.
- **Edge-case input.** Empty, repeated, renumbered, the wrong type or extension, ids that restart.

**Probe, don't just read.** Reading these paths is how they got past review before. For each piece of state the change persists, restores or clears, and each action that can run twice or race, write a probe: a vitest test that drives that path (stop and restart it through the real code, call it twice at once, feed it the odd input) and asserts what the change promises should hold. Put probes in new files named \`<something>.proof.test.ts\` beside the code, and run them. Delete the probes that pass. A probe that fails on an assertion because of the change (not a typo or a missing import) is proof of a bug: keep it, and don't fix the code.

**Fail only with proof.** Fail the change only when at least one proof test fails, and name each one in a failed check. A finding without one is advice: put it in your summary, not your verdict. The replay runs your proof files itself: a change you fail without one counts as passed.
`;

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
  proof?: Proof;
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
  proof?: Proof;
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

/** Whether a commit changed the office's code (not only tests, docs or assets): a control has to be a change QA could find a bug in. */
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
  const who = arm === 'hunt' ? 'The hunting review' : 'QA';
  return [
    `${who} caught ${count('caught')} of ${finished} real bugs in the commits that brought them in · stopped ${count('failed-elsewhere')} more for another bug · missed ${count('missed')}${count('error') ? ` · ${count('error')} without a verdict` : ''} · (pointed at the bug's file: ${pointed}) · $${cost.toFixed(2)}`,
    ...(controls.length ? [`Controls: stopped ${alarms.length} of ${clean.length} commits no listed bug came from${alarms.length ? `: ${alarms.map((c) => c.sha.slice(0, 7)).join(', ')}` : ''}`] : []),
    ...results.map((r) => `  ${mark[r.outcome].padEnd(28)} ${r.kind.padEnd(9)} ${r.introducedBy.slice(0, 7)}${r.pr ? ` #${r.pr}` : ''} → fixed in ${r.fix.slice(0, 7)}${r.judged?.finding ? `: ${r.judged.finding.slice(0, 90)}` : ''}`),
  ];
}
