// The scorecard (README.md): Focus measured against its own standard by `pnpm run scorecard`, kept to compare
// over time, and shown in main engineering.

/** The plugin's id, as FOCUS_PLUGINS names it. */
export const SCORECARD = 'scorecard';

export type ScorecardSection = 'gate' | 'fence' | 'effect' | 'tests' | 'office';
export type MetricFormat = 'pass' | 'count' | 'seconds' | 'percent' | 'usd' | 'ratio';

/** One measured number: which way is better, so a comparison can say whether it climbed. */
export interface Metric {
  section: ScorecardSection;
  key: string;
  label: string;
  value: number;
  better: 'lower' | 'higher' | 'none';
  format: MetricFormat;
}

export interface Scorecard {
  v: 1;
  at: number;
  commit: string;
  branch: string;
  /** Uncommitted changes were measured too: the numbers aren't the commit's alone. */
  dirty: boolean;
  metrics: Metric[];
  /** The ship's open frictions (no retro decision yet), the most widespread first. */
  frictions: { key: string; sessions: number }[];
  /** What couldn't be measured, and why. */
  notes: string[];
}

/**
 * How far each number wobbles when nothing changes: the scorecard measured `runs` times on one commit (`pnpm run
 * scorecard --repeat`). A change counts only when it moves further than its spread; the counts read from the code
 * don't wobble at all, the times do, and Ops' numbers drift as the ledger fills.
 */
export interface ScorecardNoise {
  v: 1;
  at: number;
  commit: string;
  runs: number;
  /** Each number's lowest and highest over the runs, by metric key. */
  spread: Record<string, { min: number; max: number }>;
}

/** Main engineering's view of the scorecards: the latest few, oldest first, and whether a measurement is under way. */
export interface Scorecards {
  status: 'idle' | 'measuring' | 'failed';
  history: Scorecard[];
  startedAt?: number;
  /** Why this measurement: the captain asked, or Focus started on a commit with no scorecard yet (a merge to main, say). */
  trigger?: 'captain' | 'new-commit';
  error?: string;
}

/**
 * What the scorecard plugin provides the plugins that require it (`host.uses('scorecard')`): main's scorecards, the
 * latest last, how far each number wobbles, and how to read a number: whether it's moved further than it wobbles since
 * `before` (`direction`), and how it's written (`formatValue`). The climber's briefs read them.
 */
export interface ScorecardService {
  history(limit: number): Scorecard[];
  noise(): ScorecardNoise | undefined;
  direction(m: Metric, before: number): 'better' | 'worse' | 'same';
  formatValue(value: number, format: MetricFormat): string;
}
