import type { Agent } from '../../shared/types';

/**
 * What Ops does once a cloud agent's session ends and its branch is fetched. Work only reaches Ops by
 * being pushed, so when nothing new arrived the agent is asked once to push (it may be sitting in the cloud,
 * uncommitted); after that, whatever is on the branch is delivered.
 */
export function afterCloudRun(r: { before: string; after: string; nudged: boolean }): 'nudge' | 'deliver' {
  return r.before === r.after && !r.nudged ? 'nudge' : 'deliver';
}

/** Why the captain can't move this agent to the cloud, if they can't. */
export function cantMoveToCloud(agent: Pick<Agent, 'name' | 'task' | 'cloud' | 'handover' | 'status' | 'sessionId'>): string | undefined {
  if (agent.task === 'review') return 'QA works on this machine: it needs Focus’s browser for its screenshots';
  if (agent.task === 'lead') return 'A goal’s lead works on this machine, with every repo of the project checked out side by side';
  if (agent.task === 'conflicts') return 'Merge conflicts are resolved on this machine';
  if (agent.handover) return `${agent.name} is already waiting for a cloud session`;
  if (agent.cloud) return `${agent.name} already works in the cloud`;
  if (agent.status === 'pushing') return `${agent.name} is pushing their work: move them once the pull request is ready`;
  if (agent.status === 'setting-up') return `${agent.name} is still setting up: move them once they've started`;
  if (agent.status === 'queued' && agent.sessionId) return `${agent.name} is about to pick their work back up: move them once they've started`;
  return undefined;
}

/** How often Ops tries to attach to a session the captain started, while its first turn is still going. */
export const ATTACH_TRIES = 8;

export const CLOUD_UNAVAILABLE =
  "Cloud sessions can't be used from Focus with the installed Claude Code: it only starts one from an interactive " +
  "terminal, and won't attach to one at all with the stream-json output the Agent SDK always asks for, which is how " +
  'Focus runs it.';

const STREAM_JSON_REFUSAL =
  /--cloud\b.*\b(?:not|cannot|can't|unsupported|incompatible)\b.*(?:stream-json|--output-format)|(?:stream-json|--output-format).*\b(?:not|cannot|can't|unsupported|incompatible)\b.*--cloud\b/i;

/**
 * Claude Code refuses Focus's `--cloud` for one of two reasons, neither of which Focus can change. It starts
 * a new cloud session headlessly only while Anthropic has its headless cloud client switched on for the account (a
 * server-side rollout, with no flag or SDK option to ask for it); otherwise it exits at once, saying --cloud needs an
 * interactive terminal. And it won't attach to an existing session (`--cloud <session_id>`) with
 * `--output-format stream-json`, which the Agent SDK always passes. Running it under a pseudo-terminal would only hide
 * the first. The stream-json refusal is matched loosely (`--cloud` and stream-json or --output-format on a line that
 * says no), so a change of wording doesn't break it.
 */
export function cloudRefused(output: string): boolean {
  if (/--cloud requires an interactive terminal|Without an interactive terminal, --cloud/.test(output)) return true;
  return STREAM_JSON_REFUSAL.test(output);
}
