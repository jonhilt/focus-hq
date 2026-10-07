import type { QaBadgeState } from './qa';
import type { GoalRecord, TriageAction } from './types';

// The ship's log of how work went: what QA said, who merged what and whether QA had passed it, conflicts, triage and
// closed goals. The office appends to it as things happen and never rewrites it (data/ledger.jsonl), so it outlives the
// reviews and agents it's about. The chief engineer reads it, and `reportCard` sums it up for their screen.

/** Who merged or closed a pull request: the office (auto-merge), the captain (the board), the operations officer, or someone on GitHub. */
export type Closer = 'office' | 'captain' | 'officer' | 'github';

interface PrRef {
  repo: string;
  pr: number;
  /** The goal the PR is a slice of, by title. */
  goal?: string;
}

export type LedgerEntry =
  | (PrRef & { kind: 'qa-verdict'; verdict: 'pass' | 'fail'; sha?: string; reviewer: string; checks: { pass: number; fail: number; skip: number }; failedRounds: number })
  /** `qa` is the PR's QA badge as it merged: anything but `passed` merged without QA passing its head commit. */
  | (PrRef & { kind: 'merged'; by: Closer; qa: QaBadgeState; failedRounds: number; triages: number })
  | (PrRef & { kind: 'closed'; by: Closer; qa: QaBadgeState; failedRounds: number; triages: number })
  /** The PR conflicted with its base: the office merged the base in cleanly, or an agent had to resolve them. */
  | (PrRef & { kind: 'conflicts'; resolved: 'office' | 'agent' | 'up-to-date' })
  | (PrRef & { kind: 'checks-sent-back'; checks: string[] })
  | (PrRef & { kind: 'triage'; officer: string; action: TriageAction; note: string })
  | { kind: 'goal-closed'; goal: GoalRecord };

export type LedgerEvent = LedgerEntry & { at: number; projectId: string };

export interface ReportCard {
  /** The window it covers, in days back from `now`. */
  days: number;
  merged: number;
  /** Merged without QA passing the head commit: the captain overriding, or a merge on GitHub. */
  mergedUnpassed: number;
  /** Merged with QA's first verdict a pass. */
  mergedFirstTime: number;
  closed: number;
  verdicts: number;
  fails: number;
  /** Failed QA rounds per merged PR. */
  roundsPerMerge: number;
  /** PRs that conflicted with their base, and those that needed an agent to resolve them. */
  conflicts: number;
  conflictsForAgent: number;
  checksSentBack: number;
  triages: number;
  goalsClosed: number;
}

const DAY = 24 * 60 * 60 * 1000;

/** The last `days` of the ledger, summed up. */
export function reportCard(events: LedgerEvent[], now: number, days = 30): ReportCard {
  const recent = events.filter((e) => e.at > now - days * DAY);
  const of = <K extends LedgerEvent['kind']>(kind: K) => recent.filter((e): e is Extract<LedgerEvent, { kind: K }> => e.kind === kind);
  const merged = of('merged');
  const verdicts = of('qa-verdict');
  const conflicted = distinctPrs(of('conflicts').filter((e) => e.resolved !== 'up-to-date'));
  return {
    days,
    merged: merged.length,
    mergedUnpassed: merged.filter((e) => e.qa !== 'passed').length,
    mergedFirstTime: merged.filter((e) => e.qa === 'passed' && e.failedRounds === 0).length,
    closed: of('closed').length,
    verdicts: verdicts.length,
    fails: verdicts.filter((e) => e.verdict === 'fail').length,
    roundsPerMerge: merged.length ? merged.reduce((n, e) => n + e.failedRounds, 0) / merged.length : 0,
    conflicts: conflicted.length,
    conflictsForAgent: distinctPrs(of('conflicts').filter((e) => e.resolved === 'agent')).length,
    checksSentBack: of('checks-sent-back').length,
    triages: of('triage').length,
    goalsClosed: of('goal-closed').length,
  };
}

function distinctPrs(events: (PrRef & { kind: string })[]): string[] {
  return [...new Set(events.map((e) => `${e.repo}#${e.pr}`))];
}

/** The ledger's lines, skipping any that don't parse (a write cut short when Focus stopped). */
export function parseLedger(text: string): LedgerEvent[] {
  return text.split('\n').flatMap((line) => {
    if (!line.trim()) return [];
    try {
      const event = JSON.parse(line) as LedgerEvent;
      return typeof event.at === 'number' && typeof event.kind === 'string' ? [event] : [];
    } catch {
      return [];
    }
  });
}

const percent = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '–');

/** The report card as the engineer's screen shows it: a headline and a few lines. */
export function reportLines(card: ReportCard): { headline: string; lines: string[] } {
  if (!card.merged && !card.closed && !card.verdicts) return { headline: 'Gathering evidence', lines: ['Nothing merged or reviewed yet', `Logging QA, merges and conflicts`] };
  return {
    headline: `${card.merged} merged · last ${card.days} days`,
    lines: [
      `QA passed first time: ${percent(card.mergedFirstTime, card.merged)}`,
      `QA rounds failed per merge: ${card.roundsPerMerge.toFixed(1)}`,
      `Merged without a QA pass: ${card.mergedUnpassed}`,
      `Conflicts: ${card.conflicts} (${card.conflictsForAgent} needed an agent)`,
      `Checks sent back: ${card.checksSentBack} · Triaged: ${card.triages}`,
      `Closed unmerged: ${card.closed} · Goals closed: ${card.goalsClosed}`,
    ],
  };
}
