import type { Agent } from '../../shared/types';
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
  // a new session would be refused the same way
  const refused = outcome.error === CLOUD_UNAVAILABLE;
  return resumed && !outcome.ok && !outcome.aborted && !outcome.started && !stillThere && !refused;
}

/**
 * Claude Code refused to start a cloud session, which the office can't change: the agent carries on as a local agent in
 * the worktree already set up for them, as the captain would have them do by hand.
 */
export function fallBackToLocal(agent: Pick<Agent, 'cloud'>, outcome: RunOutcome): boolean {
  return !!agent.cloud && !outcome.ok && !outcome.aborted && outcome.error === CLOUD_UNAVAILABLE;
}

export const CLOUD_UNAVAILABLE =
  "Cloud sessions can't be started from Focus with the installed Claude Code: it only starts one from an interactive " +
  'terminal, and the office runs it headlessly through the Agent SDK.';

/**
 * Claude Code starts a new cloud session headlessly only while Anthropic has its headless cloud client switched on for
 * the account (a server-side rollout, with no flag or SDK option to ask for it). Otherwise it exits at once, saying
 * --cloud needs an interactive terminal. Running it under a pseudo-terminal would only hide that.
 */
export function cloudRefused(output: string): boolean {
  return /--cloud requires an interactive terminal|Without an interactive terminal, --cloud/.test(output);
}
