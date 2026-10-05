import type { RunOutcome } from './types';

/**
 * What the office does once a cloud agent's session ends and its branch is fetched. Work only reaches the office by
 * being pushed, so when nothing new arrived the agent is asked once to push (it may be sitting in the cloud,
 * uncommitted); after that, whatever is on the branch is delivered.
 */
export function afterCloudRun(r: { before: string; after: string; nudged: boolean }): 'nudge' | 'deliver' {
  return r.before === r.after && !r.nudged ? 'nudge' : 'deliver';
}

/**
 * A follow-up that couldn't reattach to the agent's cloud session (archived, or attaching isn't enabled for the account)
 * carries on in a new cloud session on the same branch. A session that got going and then failed is a real failure, and
 * one that's still busy (or waiting on a question asked on claude.ai) mustn't get a second session pushing beside it.
 */
export function carryOnInNewSession(outcome: RunOutcome, resumed: boolean): boolean {
  const stillThere = /\bis busy\b|waiting on a question/i.test(outcome.error ?? '');
  return resumed && !outcome.ok && !outcome.aborted && !outcome.started && !stillThere;
}
