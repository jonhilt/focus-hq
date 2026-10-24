import type { CrewStamp } from '../../shared/ledger';
import type { QaReport } from '../../shared/types';

// QA's catch rate (docs/qa-catch.md): plant one known bug in a line a merged pull request added, run the QA officer's
// own review on that code in a scratch clone, and see whether QA fails it and points at the bug. QA passing 93% of
// pull requests first time is good work or a weak check; only bugs planted on purpose tell which. The rules are here,
// pure; the clones, git and the review sessions are in tools/qaCatch.ts.

/** A line a pull request added: its file, its line number in the new version, and its text. */
export interface AddedLine {
  file: string;
  line: number;
  text: string;
}

/** Each added line of a unified diff (`git diff -U0`), with where it is in the new version of its file. */
export function addedLines(diff: string): AddedLine[] {
  const out: AddedLine[] = [];
  let file: string | undefined;
  let line = 0;
  for (const text of diff.split('\n')) {
    if (text.startsWith('+++ ')) file = text === '+++ /dev/null' ? undefined : text.replace(/^\+\+\+ b\//, '');
    else if (text.startsWith('@@')) line = Number(/\+(\d+)/.exec(text)?.[1] ?? 0);
    else if (text.startsWith('+') && file) out.push({ file, line: line++, text: text.slice(1) });
    else if (!text.startsWith('-') && !text.startsWith('\\') && file) line++;
  }
  return out;
}

/** Code QA could catch a bug in by reading the diff and running the tests: not UI code it would need a browser for, tests, docs or config. */
const CODE = /\.(ts|tsx|js|mjs|cs|py|go|rs|java|kt|rb)$/;
const NOT_PLANTABLE = /(^|\/)(client|ui|web|wwwroot|components|pages|views|public|dist|node_modules)\/|\.(test|spec)\.|(^|\/)tests?\/|Tests?\.|\.d\.ts$|\.config\./i;
export const plantableFile = (file: string) => CODE.test(file) && !NOT_PLANTABLE.test(file);

/** One way to break a line, as a bug would: what it looks for, what it puts instead, and the bug in words. */
interface Mutation {
  find: RegExp;
  to: string;
  bug: string;
}

/** Small, plausible bugs: a comparison flipped or off by one, a condition the wrong way round, a guard dropped. */
export const MUTATIONS: Mutation[] = [
  { find: / === /, to: ' !== ', bug: 'an equality check turned into an inequality' },
  { find: / !== /, to: ' === ', bug: 'an inequality check turned into an equality' },
  { find: / >= /, to: ' > ', bug: 'an off-by-one: >= became >' },
  { find: / <= /, to: ' < ', bug: 'an off-by-one: <= became <' },
  { find: / > (?!=)/, to: ' >= ', bug: 'an off-by-one: > became >=' },
  { find: / < (?!=)/, to: ' <= ', bug: 'an off-by-one: < became <=' },
  { find: / && /, to: ' || ', bug: 'a condition loosened: && became ||' },
  { find: / \|\| /, to: ' && ', bug: 'a condition tightened: || became &&' },
  { find: /\bif \(!/, to: 'if (', bug: 'a guard turned round: if (!x) became if (x)' },
  { find: /\btrue\b/, to: 'false', bug: 'a true turned to false' },
  { find: /\bfalse\b/, to: 'true', bug: 'a false turned to true' },
  { find: / \+ 1\b/, to: ' - 1', bug: 'an off-by-one: + 1 became - 1' },
  { find: / - 1\b/, to: ' + 1', bug: 'an off-by-one: - 1 became + 1' },
];

/** A bug planted in a line: where, the line before and after, and what it is. */
export interface Planted {
  file: string;
  line: number;
  before: string;
  after: string;
  bug: string;
}

/** A comment, or nothing but an import: a bug there is no bug. */
const INERT = /^\s*(\/\/|\/?\*|#|import\b|using\b|export \{|from\b)/;

/**
 * One bug to plant in the lines a pull request added, picked by `seed` from every line and mutation that could take
 * one (each line's first matching mutation), so the same pull request gets the same bug each run. None when no added
 * line of plantable code has anything to break.
 */
export function plant(lines: AddedLine[], seed: number): Planted | undefined {
  const candidates = lines.flatMap((l) => {
    if (!plantableFile(l.file) || INERT.test(l.text)) return [];
    const m = MUTATIONS.find((m) => m.find.test(l.text));
    return m ? [{ file: l.file, line: l.line, before: l.text, after: l.text.replace(m.find, m.to), bug: m.bug }] : [];
  });
  return candidates.length ? candidates[Math.abs(seed) % candidates.length] : undefined;
}

/**
 * How QA did against a planted bug: `caught` when it failed the pull request and its report points at the bug (the
 * file, by its name, in a failed check, the fix instructions or a spot-check); `failed-elsewhere` when it failed it for
 * something else; `missed` when it passed it.
 */
export type CatchOutcome = 'caught' | 'failed-elsewhere' | 'missed';

export function scoreReport(report: QaReport, planted: Planted): CatchOutcome {
  if (report.verdict === 'pass') return 'missed';
  const name = planted.file.split('/').pop() ?? planted.file;
  const near = (file: string, line?: number) => file.endsWith(name) && (line === undefined || Math.abs(line - planted.line) <= 5);
  const words = [report.fixInstructions ?? '', ...report.checks.filter((c) => c.result === 'fail').map((c) => `${c.name} ${c.details}`)].join('\n');
  const pointed = words.includes(name) || words.includes(planted.after.trim()) || (report.spotChecks ?? []).some((s) => near(s.file, s.line));
  return pointed ? 'caught' : 'failed-elsewhere';
}

/** One planted bug's run: the pull request, the bug, how QA did, and what the review cost. */
export interface CatchResult {
  repo: string;
  pr: number;
  planted: Planted;
  outcome: CatchOutcome | 'error';
  /** QA's summary, or why the review didn't finish. */
  summary: string;
  costUsd?: number;
  minutes?: number;
}

export interface CatchTotals {
  runs: number;
  caught: number;
  failedElsewhere: number;
  missed: number;
  errors: number;
  /** Caught over the runs that finished: 0 to 1. */
  rate: number;
  costUsd: number;
}

export function catchTotals(results: CatchResult[]): CatchTotals {
  const count = (o: CatchResult['outcome']) => results.filter((r) => r.outcome === o).length;
  const finished = results.length - count('error');
  return {
    runs: results.length,
    caught: count('caught'),
    failedElsewhere: count('failed-elsewhere'),
    missed: count('missed'),
    errors: count('error'),
    rate: finished ? count('caught') / finished : 0,
    costUsd: results.reduce((n, r) => n + (r.costUsd ?? 0), 0),
  };
}

/** The result as the terminal prints it: the rate, then each run. */
export function catchLines(results: CatchResult[]): string[] {
  const t = catchTotals(results);
  const mark: Record<CatchResult['outcome'], string> = { caught: '✓ caught', 'failed-elsewhere': '~ failed it, elsewhere', missed: '✗ missed', error: '! no verdict' };
  return [
    `QA caught ${t.caught} of ${t.runs - t.errors} planted bugs (${Math.round(t.rate * 100)}%) · ${t.failedElsewhere} failed for something else · ${t.missed} missed${t.errors ? ` · ${t.errors} without a verdict` : ''} · $${t.costUsd.toFixed(2)}`,
    ...results.map((r) => `  ${mark[r.outcome].padEnd(24)} ${r.repo.split('/')[1] ?? r.repo}#${r.pr}  ${r.planted.file}:${r.planted.line}  ${r.planted.bug}`),
  ];
}

/**
 * A control: the same pull request reviewed with no bug planted, so a QA that fails everything can't look like one
 * that catches everything. `false-alarm` when QA failed the clean code.
 */
export interface ControlResult {
  repo: string;
  pr: number;
  outcome: 'clean' | 'false-alarm' | 'error';
  summary: string;
  costUsd?: number;
  minutes?: number;
}

export const scoreControl = (report: QaReport): ControlResult['outcome'] => (report.verdict === 'pass' ? 'clean' : 'false-alarm');

/** The controls in a line: how many clean pull requests QA failed. */
export function controlLine(controls: ControlResult[]): string {
  const finished = controls.filter((c) => c.outcome !== 'error');
  const alarms = finished.filter((c) => c.outcome === 'false-alarm');
  const cost = controls.reduce((n, c) => n + (c.costUsd ?? 0), 0);
  return `Controls: QA failed ${alarms.length} of ${finished.length} pull requests with no bug planted (false alarms)${alarms.length ? `: ${alarms.map((c) => `${c.repo.split('/')[1] ?? c.repo}#${c.pr}`).join(', ')}` : ''} · $${cost.toFixed(2)}`;
}

/** A saved run of `pnpm run qa-catch`, as ~/.focus/qa-catch/ keeps it: the planted bugs' results, and the controls' if it ran them. */
export interface CatchRun {
  at: number;
  model: string;
  /** What QA worked to. Runs before it have none. */
  crew?: CrewStamp;
  results: CatchResult[];
  controls?: ControlResult[];
}

