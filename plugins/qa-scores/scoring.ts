import { createHash } from 'node:crypto';
import type { LedgerEntry, LedgerEvent, LentJournal, ReviewEntry, Scorer } from '../../plugin-api/server';
import { scoreOf } from '../../plugin-api/server';

// Which of QA's reports the QA report scorer grades, what the model is told of each, and the line its grade is written
// as. Pure, and tested beside it (scoring.test.ts); the server part reads the journals, the diffs and the model.

type Reported = Extract<ReviewEntry, { kind: 'reported' }>;

/** One of QA's reports to grade: its pull request, the commit QA tested, and the report as its verdict was journaled. */
export interface Due {
  /** `owner/repo#12@<sha>`: a report is graded once. */
  key: string;
  projectId: string;
  repo: string;
  pr: number;
  title: string;
  sha: string;
  reported: Reported;
}

/** How far back a sweep looks, so reports QA made while the scorer was off or Focus was down are still graded once it's back. */
export const LOOK_BACK_MS = 7 * 24 * 3_600_000;

/** The most one sweep grades, so what a sweep can cost is bounded; the rest wait for the next. */
export const MOST_PER_SWEEP = 12;

/** The most of a diff the model is told: past it, the diff is cut and says so. */
export const DIFF_MAX = 60_000;

export const keyOf = (repo: string, pr: number, sha: string): string => `${repo}#${pr}@${sha}`;

/** Whether `key` is among the `rate` in every hundred graded: by a hash of it, so the same reports always are. */
export function sampled(key: string, rate: number): boolean {
  return createHash('sha256').update(key).digest().readUInt32BE(0) / 2 ** 32 < rate / 100;
}

/**
 * The reports in the review journals, reported since `since`, that the scorer's sample takes and no `qa-score` line
 * has graded yet: newest first, each commit's latest report once.
 */
export function reportsDue(journals: readonly LentJournal<ReviewEntry>[], ledger: readonly LedgerEvent[], rate: number, since: number): Due[] {
  const graded = new Set(ledger.flatMap((e) => (e.kind === 'qa-score' ? [keyOf(e.repo, e.pr, e.sha)] : [])));
  const due = new Map<string, Due & { at: number }>();
  for (const journal of journals) {
    let asked: Extract<ReviewEntry, { kind: 'requested' }> | undefined;
    for (const entry of journal.entries) {
      if (entry.kind === 'requested') asked = entry;
      if (entry.kind !== 'reported' || !asked || !entry.sha || entry.t < since) continue;
      const key = keyOf(asked.repo, asked.number, entry.sha);
      if (graded.has(key) || !sampled(key, rate)) continue;
      due.set(key, { key, projectId: asked.projectId, repo: asked.repo, pr: asked.number, title: asked.title, sha: entry.sha, reported: entry, at: entry.t });
    }
  }
  return [...due.values()].sort((a, b) => b.at - a.at).map(({ at: _at, ...d }) => d);
}

/** What the model is told of one report: the pull request, QA's report as QA posted it, and the diff QA reviewed. */
export function scorePrompt(d: Due, diff: string): string {
  const r = d.reported.report;
  const report = {
    verdict: r.verdict,
    ...(r.advisory && { advisory: 'QA failed it, but none of its proofs held, so it was posted as a pass with advice' }),
    summary: r.summary,
    checks: r.checks,
    commands: r.commands,
    spotChecks: r.spotChecks,
    files: r.files,
    proofs: r.proofs,
    fixInstructions: r.fixInstructions,
    ...(d.reported.files && { fileAccount: d.reported.files }),
  };
  const shown = diff.length > DIFF_MAX ? `${diff.slice(0, DIFF_MAX)}\n… (cut here: the diff is ${diff.length} characters in all)` : diff;
  return `Pull request ${d.repo}#${d.pr}: ${d.title}\n\n## QA's report\n\n${JSON.stringify(report, null, 1)}\n\n## The diff it reviewed\n\n${shown}`;
}

/** The answer the model gives: one of the scorer's labels, and why. */
export const scoreSchema = (scorer: Pick<Scorer, 'labels'>): Record<string, unknown> => ({
  type: 'object',
  additionalProperties: false,
  required: ['label', 'why'],
  properties: {
    label: { type: 'string', enum: Object.keys(scorer.labels), description: 'How far the report can be trusted, as the rubric grades it' },
    why: { type: 'string', description: 'Why, in a sentence or two, naming the file or check that decided it' },
  },
});

/**
 * The `qa-score` line for the model's answer on `d`, stamped with what QA worked to (its verdict's stamp) and the
 * scorer's digest; undefined when the answer isn't one of the scorer's labels. `goal`: the pull request's, by title.
 */
export function scoreEntry(d: Due, scorer: Scorer, answer: { structured: unknown; model?: string; costUsd?: number }, goal?: string): LedgerEntry | undefined {
  const a = answer.structured;
  const label = typeof a === 'object' && a !== null && 'label' in a && typeof a.label === 'string' ? a.label : '';
  const graded = scoreOf(scorer, label);
  if (!graded) return undefined;
  const why = typeof a === 'object' && a !== null && 'why' in a && typeof a.why === 'string' ? a.why.trim() : '';
  return {
    kind: 'qa-score',
    repo: d.repo,
    pr: d.pr,
    ...(goal && { goal }),
    sha: d.sha,
    label,
    ...graded,
    why,
    ...(d.reported.crew && { crew: d.reported.crew }),
    scorer: `${scorer.name}-${scorer.digest}`,
    model: answer.model ?? scorer.model,
    ...(answer.costUsd !== undefined && { costUsd: answer.costUsd }),
  };
}

/** The goal a pull request is a slice of, by title, as QA's verdict lines have it. */
export const goalOf = (ledger: readonly LedgerEvent[], repo: string, pr: number): string | undefined =>
  ledger.flatMap((e) => (e.kind === 'qa-verdict' && e.repo === repo && e.pr === pr && e.goal ? [e.goal] : [])).at(-1);
