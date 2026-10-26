import type { QaReport } from '../../shared/types';
import { mustOpen } from '../../shared/qa';

// Whether QA's report goes back to QA once, and for which changed files: those it leaves out, says it only skimmed,
// or its session never opened. Pure, so it's unit tested (qaRevisitRules.test.ts); manager/reviews.ts sends it back
// (with qa.ts's `filesPrompt`), and tools/qaReview.ts does the same in a replay.

/** The files a pull request changes that QA's report doesn't account for. */
export function unaccounted(report: QaReport, changed: string[]): string[] {
  const named = (report.files ?? []).map((f) => f.file.replace(/^\.?\//, ''));
  return changed.filter((c) => !named.some((n) => n === c || c.endsWith(`/${n}`) || n.endsWith(`/${c}`)));
}

/** What QA said it only skimmed, glanced at or didn't read, in its own words. */
const UNREAD = /\b(skim(med|ming)?|glanced?|not (read|reviewed|opened)|didn['’]t (read|review|open)|did not (read|review|open)|unread|unreviewed)\b/i;

/** The changed files QA's report says it only skimmed or didn't read: its own account, taken at its word. */
export const skimmed = (report: QaReport): string[] => (report.files ?? []).filter((f) => UNREAD.test(f.checked)).map((f) => f.file);

/** The changed files to send QA back to: left out of its report, said to be only skimmed, or never opened at all. */
export interface Revisit {
  missing: string[];
  unread: string[];
  unopened: string[];
}

/**
 * The changed files a report should go back to QA for: those it leaves out, those it says it only skimmed, and the code
 * files its session never opened (`opened`, when Ops could read its tool calls). Nothing once QA has been sent
 * back already this review, or when Ops doesn't know the changed files.
 */
export function filesToRevisit(report: QaReport, files: { changed: string[]; askedAgain: boolean } | undefined, opened?: Set<string>): Revisit | undefined {
  if (!files || files.askedAgain) return undefined;
  const missing = unaccounted(report, files.changed);
  const unread = skimmed(report);
  const unopened = opened ? files.changed.filter((f) => mustOpen(f) && !opened.has(f) && !missing.includes(f) && !unread.some((u) => u === f || f.endsWith(`/${u}`))) : [];
  return missing.length || unread.length || unopened.length ? { missing, unread, unopened } : undefined;
}
