import type { QaProof, QaReport } from '../../shared/types';
import { truncate } from '../../shared/text';

// The rules for QA's proofs (docs/qa.md#proof): whether a proof can be checked as QA gave it, what Ops' run of its
// command (or the screenshot it names) says about it, and whether the verdict blocks the pull request. Pure, so it's
// unit tested (qaProofRules.test.ts); `prove` in qaProof.ts runs the commands and reads the files, and asks these.

/**
 * A command as the words it runs, split the way a shell would split plain words and quotes. Undefined for one that needs
 * a shell (a pipe, `&&`, `;`, a redirect, `$` or a backquote outside quotes), or that's empty: Ops runs proofs
 * without one (`run()` in server/util.ts).
 */
export function commandArgs(command: string): string[] | undefined {
  const args: string[] = [];
  let word: string | undefined;
  let quote: '"' | "'" | undefined;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) quote = undefined;
      else if (c === '\\' && quote === '"' && i + 1 < command.length) word += command[++i];
      else word += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      word ??= '';
    } else if (/\s/.test(c)) {
      if (word !== undefined) args.push(word);
      word = undefined;
    } else if (/[|&;<>$`()]/.test(c)) {
      return undefined;
    } else if (c === '\\' && i + 1 < command.length) {
      word = (word ?? '') + command[++i];
    } else {
      word = (word ?? '') + c;
    }
  }
  if (quote) return undefined;
  if (word !== undefined) args.push(word);
  return args.length ? args : undefined;
}

/** A file named from a repo's root that stays inside it: not absolute, no `..`. */
const insideRepo = (file: string) => !/^([/\\]|[a-zA-Z]:)/.test(file) && !file.split(/[/\\]/).includes('..');

/** Whether a command runs `file`: one of its words names the file's path, or its name. */
function namesFile(args: string[], file: string): boolean {
  const name = file.split('/').pop() ?? file;
  return args.some((a) => a.includes(name));
}

/** Why a proof can't be checked as QA gave it, before anything runs; undefined when it can. */
export function proofProblem(proof: QaProof): string | undefined {
  if (proof.kind === 'screenshot') return proof.screenshot && proof.screenshot > 0 ? undefined : 'it names no screenshot';
  if (!proof.command) return 'it gives no command to run';
  const args = commandArgs(proof.command);
  if (!args) return 'its command needs a shell (a pipe, `&&`, a redirect or `$`), and Ops runs proofs without one';
  if (proof.kind === 'check') return undefined;
  if (!proof.file) return 'it names no test file';
  if (!insideRepo(proof.file)) return 'its file is outside the repo';
  if (!namesFile(args, proof.file)) return 'its command doesn\'t name its file, so it may run other tests';
  return undefined;
}

/** What a run of a proof's command came to: its exit code (null when it timed out or couldn't start) and everything it printed. */
export interface CommandRun {
  code: number | null;
  output: string;
}

/** Output that says a test never really ran: it couldn't load or compile, or there was nothing to run. Each with why. */
const DIDNT_RUN: [RegExp, string][] = [
  [/Cannot find module|Failed to load url|does not provide an export|__vite_ssr_import_\d+__\.\w+\)? is not a (function|constructor)|ModuleNotFoundError|ImportError|cannot find package|Could not resolve/i, 'it couldn\'t load what it imports'],
  [/Transform failed|error TS\d+|Parse failure|compilation failed|error\[E\d+\]|could not compile|build failed|ERROR collecting|errors? during collection/i, 'it didn\'t compile'],
  [/No test files found|no tests ran|collected 0 items|No tests found|no test files|testing: warning: no tests to run|0 tests? (ran|run)\b/i, 'it ran no tests'],
  [/Missing script|ERR_PNPM_NO_SCRIPT|ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL.*not found|command not found|ENOENT/i, 'its command couldn\'t be found'],
];

/** Output that shows a test failing: an assertion, or a runner's count of failures. */
const TEST_FAILED = /AssertionError|Assertion ?failed|assertion `|Expected:|expected .+ (to|but)|\b[1-9]\d* (failed|failures?|failing)\b|--- FAIL|\bFAILED\b|Failures: [1-9]|panicked at|\s[×✗]\s/;

/** The first line of `output` the first of `res` that can matches, or its last non-empty line. */
function lineOf(output: string, ...res: RegExp[]): string {
  const lines = output.split('\n').map((l) => l.trim()).filter(Boolean);
  const found = res.map((re) => lines.find((l) => re.test(l))).find((l) => l !== undefined);
  return truncate(found ?? lines.at(-1) ?? '', 300);
}

/**
 * What Ops' run of a proof's command says about it. A test proves a bug when its command fails and what it
 * printed shows a test failing, and nothing says it never really ran (an import that isn't there, a compile error, no
 * tests found): QA's typo isn't proof. A check proves one when its command exits with a failure. A run that timed out or
 * couldn't start (`code` null) proves nothing.
 */
export function proofOutcome(kind: 'test' | 'check', run: CommandRun): Pick<QaProof, 'outcome' | 'note'> {
  if (run.code === 0) return { outcome: 'passed', note: kind === 'test' ? 'the test passed when Ops ran it' : 'the check passed when Ops ran it' };
  if (run.code === null) return { outcome: 'broken', note: 'its command timed out or couldn\'t start' };
  const didnt = DIDNT_RUN.find(([re]) => re.test(run.output));
  if (kind === 'check') return didnt?.[1] === 'its command couldn\'t be found' ? { outcome: 'broken', note: didnt[1] } : { outcome: 'failed', note: lineOf(run.output, /error|fail/i) };
  if (didnt) return { outcome: 'broken', note: didnt[1] };
  if (!TEST_FAILED.test(run.output)) return { outcome: 'broken', note: 'its command failed without a test failing' };
  return { outcome: 'failed', note: lineOf(run.output, /AssertionError|Assertion|assert |Expected|expected|panicked|got .+ want/, /FAIL|Error/) };
}

/** Whether a pull request changes UI code: what only a browser shows can be proved with a screenshot only then. */
const UI_FILE = /\.(tsx|jsx|vue|svelte|astro|css|scss|sass|less|html|cshtml|razor|erb|hbs)$|(^|\/)(client|frontend|web|ui|components|pages|views|styles|public)\//;

export const touchesUi = (changed: readonly string[]) => changed.some((f) => UI_FILE.test(f));

/**
 * Whether a screenshot proof holds: the screenshot (`n`, counting from 1 among the `taken`) is one of the last `kept` that
 * go on the pull request, and the change touches UI code. With the screenshot's number on the PR comment when it does.
 */
export function screenshotOutcome(n: number, shots: { taken: number; kept: number }, changed: readonly string[]): Pick<QaProof, 'outcome' | 'note'> {
  if (n < 1 || n > shots.taken) return { outcome: 'broken', note: `QA took ${shots.taken} screenshot${shots.taken === 1 ? '' : 's'}, not ${n}` };
  const first = shots.taken - shots.kept;
  if (n <= first) return { outcome: 'broken', note: 'that screenshot isn\'t one that goes on the pull request' };
  if (!touchesUi(changed)) return { outcome: 'broken', note: 'the change touches no UI code, so a screenshot can\'t stand in for a test' };
  return { outcome: 'failed', note: `screenshot ${n - first} on this comment shows it` };
}

/** Whether a report's verdict blocks the pull request: QA failed it and at least one of its proofs held. */
export const blocksWithProof = (report: Pick<QaReport, 'verdict' | 'proofs'>): boolean => report.verdict === 'fail' && (report.proofs ?? []).some((p) => p.outcome === 'failed');

/**
 * The report Ops posts, given what it saw of each proof (`proofs`, checked): QA's own, unless QA failed the change
 * and none of its proofs held, when the verdict is a pass and QA's findings go up as advice (`advisory`). A pass stays a
 * pass whatever its proofs.
 */
export function provenReport(report: QaReport, proofs: QaProof[]): QaReport {
  const { proofs: _named, ...rest } = report;
  const checked: QaReport = { ...rest, ...(proofs.length && { proofs }) };
  if (report.verdict !== 'fail' || blocksWithProof(checked)) return checked;
  return { ...checked, verdict: 'pass', advisory: true };
}
