import { Effect } from 'effect';
import type { QaProof, QaReport, QaStep } from '../../shared/types';
import { truncate } from '../util';
import { isRecord } from './transcript';

// QA blocks a pull request only with proof (docs/qa.md#proof): the hunting guidance QA is given, the proofs its report
// names, and the rules for whether one holds and whether the verdict blocks. Pure, and tested beside it
// (qaProof.test.ts), but for `prove`, which takes the running of commands and the reading of files from its caller: the
// checkout Ops makes of the PR (manager/reviews.ts), or a replay's clone (tools/qaReview.ts).

/** How many of a report's proofs Ops checks, at most: more than that is a list of worries, not proof. */
export const MAX_PROOFS = 5;

/** How long a proof's command may run, in Ops' own run of it. */
export const PROOF_MS = 10 * 60_000;

/**
 * How QA hunts the bugs that get past review, and the rule it works to: fail only with proof. From the bug replay's
 * hunting arm (docs/bug-corpus.md#replaying-qa), kept general: QA reviews other projects' repos, with other test runners.
 * Three steps, each a headline for the QA station's Playbook and the exact text QA gets (`HUNTING` puts them together).
 */
const HUNT: QaStep = {
  title: 'Hunts the bugs that get past review',
  text: `Bugs that reach the main branch are rarely in the code as it reads: they're in paths the change's own tests never walk. Before your verdict, hunt these in the changed code:

- **Restart, shutdown and close.** State that's persisted, restored or cleared: what happens across a clean shutdown and restart, a crash mid-way, a close and reopen? Flags left set, lists reset to empty, a stop that clears what should survive.
- **Two things at once.** The same action twice in quick succession, or two callers at once: double launches, a second request while the first is still in flight, an older copy overwriting a newer one, a read just after a write that sees the old state.
- **Assumptions about outside systems.** git, the hosting service's API, an SDK, the shell, the network, the clock: a ref that hasn't moved yet, a status that's unknown for a while, a glob or quote the shell reads differently, a stream that arrives before it's whole, a call that fails or times out.
- **Edge-case input.** Empty, repeated, renumbered, very large, the wrong type or extension, ids that restart.`,
};

const PROBE: QaStep = {
  title: 'Writes probe tests that drive those paths',
  text: `**Probe, don't just read.** Reading these paths is how they got past review before. For each piece of state the change persists, restores or clears, and each action that can run twice or race, write a probe: a test, in the repo's own test framework, that drives that path through the real code (stop and restart it, call it twice at once, feed it the odd input) and asserts what the change promises should hold. Name each probe as the repo names its tests with \`.proof\` before the test suffix, beside the code it tests (\`queue.proof.test.ts\`, \`test_queue_proof.py\`, \`queue_proof_test.go\`), and run it. Delete the probes that pass. A probe that fails on an assertion because of the change (not a typo, a missing import or a setup mistake) is proof of a bug: keep it, and don't fix the code. Make it assert: a crash the test only sees as an error is weaker proof than an \`expect\` that says what should have happened.`,
};

const PROOF: QaStep = {
  title: 'Fails a PR only with proof Ops checks',
  text: `Ops checks your proof itself, before it posts your report, and your verdict blocks the pull request only if a proof holds. Name each in your report's \`proofs\`:

- **test**: a test file that fails (one of your probes, or a test already in the repo that the change breaks), and the command that runs just that file from the repo's root, as you ran it (\`pnpm vitest run src/queue.proof.test.ts\`, \`python -m pytest tests/test_queue_proof.py\`). It must name the file, and it runs without a shell: no pipes, \`&&\` or redirects. It holds when the test fails on an assertion: one that fails to load, compile or find its imports doesn't.
- **check**: one of the project's own checks (its type check, lint or build) that fails, and its command (\`pnpm run typecheck\`). It holds when the command exits with a failure.
- **screenshot**: only for what nothing but a browser can show (a broken layout, a blank page, a control that doesn't respond), the number of the screenshot that shows it, counting from 1 in the order you took them. It holds when that screenshot is one that goes on the pull request and the change touches UI code. Prefer a test whenever the logic behind the page can be tested.

Fail the change only with at least one proof, and name it in a failed check. Findings without proof are still worth giving: put them in your checks, summary and fix instructions, and they go on the pull request as advice, with a pass. A proof test you keep goes to the developer to add to their branch and make pass, so write it as a test worth keeping.`,
};

/** Proof mode's steps, in the order QA gets them after "How to test". */
export const HUNTING_STEPS: readonly QaStep[] = [HUNT, PROBE, PROOF];

/** Proof mode's section of QA's instructions. */
export const HUNTING = `
## Hunting the bugs that get past review

${HUNT.text}

${PROBE.text}

## Fail only with proof

${PROOF.text}
`;

/** The `proofs` property of QA's report schema (QA_SCHEMA in qa.ts). */
export const PROOFS_SCHEMA: Record<string, unknown> = {
  type: 'array',
  maxItems: MAX_PROOFS,
  description: 'The proof for each finding you fail the pull request for: a failing test, a failing check, or (for what only a browser shows) a screenshot. Empty when you found nothing to prove.',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'finding'],
    properties: {
      kind: { type: 'string', enum: ['test', 'check', 'screenshot'] },
      finding: { type: 'string', description: 'The finding it proves, in a sentence.' },
      file: { type: 'string', description: 'test: the test file, from the repo\'s root.' },
      command: { type: 'string', description: 'test: the command that runs just that file; check: the check\'s command. Run from the repo\'s root, without a shell.' },
      screenshot: { type: 'integer', description: 'screenshot: which one, counting from 1 in the order you took them.' },
    },
  },
};

/** The proofs a report names, as QA gave them (no outcome yet): at most MAX_PROOFS, each with what its kind needs. */
export function parseProofs(raw: unknown): QaProof[] {
  if (!Array.isArray(raw)) return [];
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  return raw
    .flatMap((r: unknown): QaProof[] => {
      if (!isRecord(r)) return [];
      const finding = str(r.finding) ?? '';
      if (r.kind === 'test') return [{ kind: 'test', finding, file: str(r.file), command: str(r.command) }];
      if (r.kind === 'check') return [{ kind: 'check', finding, command: str(r.command) }];
      if (r.kind === 'screenshot') return [{ kind: 'screenshot', finding, screenshot: Number.isInteger(r.screenshot) ? Number(r.screenshot) : undefined }];
      return [];
    })
    .slice(0, MAX_PROOFS);
}

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

/** What `prove` needs from where QA worked: running a command there, reading a file there, and what QA's session left. */
export interface ProofRig<R = never> {
  run(args: string[]): Effect.Effect<CommandRun, never, R>;
  read(file: string): Effect.Effect<string | undefined, never, R>;
  changed: readonly string[];
  shots: { taken: number; kept: number };
}

/**
 * Checks each proof a report names, where QA worked, and gives the report to post (`provenReport`): each test's file is
 * read (it must be there; its contents go to the developer to keep) and its command run, each check's command run, and
 * each screenshot looked up. One at a time: they share a checkout.
 */
export const prove = <R>(report: QaReport, rig: ProofRig<R>): Effect.Effect<QaReport, never, R> =>
  Effect.gen(function* () {
    const checked: QaProof[] = [];
    for (const proof of (report.proofs ?? []).slice(0, MAX_PROOFS)) {
      const problem = proofProblem(proof);
      if (problem) {
        checked.push({ ...proof, outcome: 'broken', note: problem });
      } else if (proof.kind === 'screenshot') {
        checked.push({ ...proof, ...screenshotOutcome(proof.screenshot ?? 0, rig.shots, rig.changed) });
      } else {
        const source = proof.kind === 'test' && proof.file ? yield* rig.read(proof.file) : undefined;
        if (proof.kind === 'test' && source === undefined) {
          checked.push({ ...proof, outcome: 'broken', note: 'its file isn\'t in QA\'s checkout' });
          continue;
        }
        const run = yield* rig.run(commandArgs(proof.command ?? '') ?? []);
        const outcome = proofOutcome(proof.kind, run);
        checked.push({ ...proof, ...outcome, ...(outcome.outcome !== 'passed' && { output: tail(run.output) }), ...(source !== undefined && outcome.outcome === 'failed' && { source: truncate(source, 8000) }) });
      }
    }
    return provenReport(report, checked);
  });

/** The last lines of a command's output, at most about 2000 characters. */
function tail(output: string): string {
  const lines = output.trimEnd().split('\n').slice(-30).join('\n');
  return lines.length > 2000 ? `…${lines.slice(-2000)}` : lines;
}

/**
 * The proofs that held, for whoever fixes the pull request: each test's file, command, how it failed and its source, to
 * add to their branch, make pass and keep; each failing check and screenshot named. Nothing when none held.
 */
export function proofsToKeep(report: Pick<QaReport, 'proofs'>): string[] {
  const held = (report.proofs ?? []).filter((p) => p.outcome === 'failed');
  if (!held.length) return [];
  const tests = held.filter((p) => p.kind === 'test');
  return [
    '',
    'QA proved it, and Ops checked the proof itself:',
    ...held.flatMap((p) => {
      if (p.kind === 'screenshot') return [`- ${p.finding} (a screenshot on the PR comment shows it)`];
      if (p.kind === 'check') return [`- ${p.finding}: \`${p.command}\` fails${p.note ? `: ${p.note}` : ''}`];
      return [`- ${p.finding}: \`${p.file}\` fails with \`${p.command}\`${p.note ? `: ${p.note}` : ''}`, ...(p.source ? ['', '```', p.source, '```', ''] : [])];
    }),
    ...(tests.length
      ? [
          '',
          `${tests.length === 1 ? 'That test is' : 'Those tests are'} in QA's checkout, not on your branch. Add ${tests.length === 1 ? 'it' : 'each'} to your branch beside the code it tests, named as the repo names its tests (drop the \`.proof\`), fix the code until it passes without weakening what it asserts, and keep it: it's the test that keeps this bug fixed.`,
        ]
      : []),
  ];
}
