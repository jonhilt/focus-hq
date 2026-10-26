import { Effect } from 'effect';
import type { QaProof, QaReport, QaStep } from '../../shared/types';
import { truncate } from '../util';
import { isRecord } from './transcript';
import { type CoreCrew, coreCrew, CREW_RULES } from './crewFiles';
import { commandArgs, type CommandRun, proofOutcome, proofProblem, provenReport, screenshotOutcome } from './qaProofRules';

// QA blocks a pull request only with proof (docs/qa.md#proof): the hunting guidance QA is given, the proofs its report
// names, and `prove`, which checks them by the rules in qaProofRules.ts, taking the running of commands and the reading
// of files from its caller: the checkout Ops makes of the PR (manager/reviews.ts), or a replay's clone (tools/qaReview.ts).

/** How many of a report's proofs Ops checks, at most: more than that is a list of worries, not proof. */
export const MAX_PROOFS = 5;

/** How long a proof's command may run, in Ops' own run of it. */
export const PROOF_MS = 10 * 60_000;

/** The same for every pull request: QA's texts may refer to these, but the hunting steps refer to none of them. */
const ANY_PR = { baseBranch: '', run: '', checks: '', maxScreenshots: '', recorded: false, ...CREW_RULES };

/**
 * How QA hunts the bugs that get past review, and the rule it works to: fail only with proof. From the bug replay's
 * hunting arm (docs/bug-corpus.md#replaying-qa), kept general: QA reviews other projects' repos, with other test runners.
 * Three steps, each a headline for the QA station's Playbook and the exact text QA gets, in .focus/crew/qa.md
 * (`hunting:`), in the order QA gets them after "How to test". `crew`: another qa.md's, for a benchmark to compare.
 */
export const huntingSteps = (crew: CoreCrew = coreCrew): QaStep[] =>
  (['hunt', 'probe', 'proof'] as const).map((step) => ({ title: crew.text('qa', `hunting.${step}.title`, ANY_PR), text: crew.text('qa', `hunting.${step}.text`, ANY_PR) }));

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
