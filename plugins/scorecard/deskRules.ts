import type { Scorecard } from './types';

// Whether the scorecard's desk measures the commit Focus runs from by itself (README.md); desk.ts reads the checkout
// and measures. Pure, so it's tested (deskRules.test.ts).

/** The commit Focus runs from, and whether it has uncommitted changes. */
export interface Head {
  commit: string;
  dirty: boolean;
}

/**
 * Whether Focus should measure the commit it runs from by itself: it's clean (a captain's work in progress isn't
 * measured behind their back) and has no scorecard yet. Auto update restarts Focus on each merge to main, so
 * this puts a scorecard on every one.
 */
export const measureNewCommit = (history: Pick<Scorecard, 'commit'>[], head: Head) => !head.dirty && history.at(-1)?.commit !== head.commit;
