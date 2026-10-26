import { createHash } from 'node:crypto';
import type { LedgerEvent, LentJournal, ReviewEntry } from '../../plugin-api/server';

// Which of QA's reports the QA report scorer grades (README.md): the sample it takes, and the reports in the review
// journals still to grade. Pure, so it's tested (scoringRules.test.ts); scoring.ts says what the model is told of each.

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
