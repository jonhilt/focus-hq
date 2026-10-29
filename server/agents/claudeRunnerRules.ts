import type { Autonomy } from '../../shared/types';
import { errorMessage, truncate } from '../../shared/text';
import type { SoFar } from './claudeRunner';
import type { TurnResult } from './sdkMessages';
import { LIMIT_REACHED, type RunOutcome, STOPPED_BY_CAPTAIN } from './types';

// A Claude Code session's decisions, as ClaudeRunner (claudeRunner.ts) runs it: whether it keeps listening after a
// turn, what has heard a message, whether a turn's result ends it, which tools it uses without asking, and what it
// comes to when it ends or throws. Pure, so it's unit tested (claudeRunnerRules.test.ts).

/**
 * Whether the session should keep listening after its turn, for these background tasks (their task types): while
 * anything runs in the background (a workflow, a subagent, a command or a monitor), Claude Code keeps the session going
 * and takes its result in a turn of its own when it ends, so a message sent meanwhile should reach it then and there,
 * and the captain can stop a command (a stop only reaches a session that's still listening).
 */
export function holdsInput(background: string[]): boolean {
  return background.length > 0;
}

/**
 * What runs in the background, by kind: what Claude Code last listed, and any workflow Ops has seen start and
 * not end. A workflow's agents ask Ops for approval as the lead's own tools do, so the input mustn't close
 * under them even if a list leaves the workflow out (a run's agents were all refused at once, a minute after their own
 * background commands ended).
 */
export function runningInBackground(listed: string[], workflows: number): string[] {
  return workflows > 0 && !listed.includes('local_workflow') ? [...listed, 'local_workflow'] : listed;
}

/**
 * Whether a message from Claude Code shows it has read what Ops sent before it: something it says in a turn.
 * What it reports whatever it has read (the background list, a task's start, end or progress, `init`) doesn't, nor
 * does a turn's result (a message sent as the turn ends isn't in its count).
 */
export const showsHeard = (msg: { type: string }): boolean => msg.type === 'assistant';

/**
 * Whether a turn's result ends a session asked for an answer (`expects`, QA's report): the answer's in and nothing
 * waits for another turn. Nothing it left in the background matters then. On jonhilt/ops#35 a QA officer's `docker
 * build` hung in the background, so after the report the session kept listening for it forever and the review stayed
 * under test (jonhilt/focus#629).
 */
export function answerEnds(expects: boolean, result: Pick<TurnResult, 'isError' | 'queued' | 'structured'>): boolean {
  return expects && !result.isError && result.queued === 0 && result.structured !== undefined;
}

/**
 * In "ask" mode these never make an agent raise its hand. Not a sandbox: it only cuts down on interruptions.
 * Plain tools are approved in canUseTool (bare names in allowedTools would bypass the callback entirely);
 * shell commands are matched by Claude Code's own Bash(prefix:*) rules.
 */
const ASK_MODE_TOOLS = new Set(['Read', 'Glob', 'Grep', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'TodoWrite', 'Task', 'Agent', 'WebSearch', 'WebFetch']);

/** A tool the session may use without asking in a mode, before Claude Code's own rules or the captain are asked. */
export function allowedWithoutAsking(autonomy: Autonomy, toolName: string): boolean {
  return autonomy === 'full' || (autonomy === 'ask' && (ASK_MODE_TOOLS.has(toolName) || toolName.startsWith('mcp__browser__')));
}

/** What stopped a session other than its own messages: the captain sending them home, or your plan's usage limit. */
export interface Interruptions {
  stopping: boolean;
  limited: boolean;
}

/** What a session comes to once its messages run out: the captain's stop first, then the usage limit, else its last turn's result. */
export function endedOutcome(so: SoFar, { stopping, limited }: Interruptions): RunOutcome {
  const { summary, started } = so;
  if (stopping) return { ok: false, summary, error: STOPPED_BY_CAPTAIN, aborted: true, started };
  if (limited) return { ok: false, summary, error: LIMIT_REACHED, limited: true, started };
  return { ok: so.ok, summary, structured: so.structured, error: so.error, started };
}

/**
 * What a session comes to when Claude Code throws: the usage limit (unless the captain stopped them), a stop or abort,
 * or else the error with the last three lines Claude Code wrote to stderr.
 */
export function failedOutcome(
  so: SoFar,
  err: unknown,
  { stopping, limited, aborted, stderr }: Interruptions & { aborted: boolean; stderr: string },
): RunOutcome {
  const { summary, started } = so;
  if (limited && !stopping) return { ok: false, summary, error: LIMIT_REACHED, limited: true, started };
  if (stopping || aborted) return { ok: false, summary, error: STOPPED_BY_CAPTAIN, aborted: true, started };
  const detail = stderr.trim().split('\n').slice(-3).join(' ');
  return { ok: false, summary, error: `${errorMessage(err)}${detail ? ` — ${truncate(detail, 300)}` : ''}`, started };
}
