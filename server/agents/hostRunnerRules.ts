import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Autonomy as HostAutonomy, ConversationEvent, ConversationSummary } from 'agent-host';
import { clock } from '../../shared/clock';
import type { AgentTask, Autonomy, TermLine } from '../../shared/types';
import type { TurnResult } from './sdkMessages';
import { type RunOutcome, STOPPED_BY_CAPTAIN } from './types';

// The HostRunner's decisions (hostRunner.ts runs them): which sessions go to agent-host, which of an agent's host
// conversations a turn joins, and what a turn comes to. Pure, so they're unit tested (hostRunnerRules.test.ts).

/** The tasks whose sessions run on agent-host: the developers' and QA's. The leads move over later. */
export function runsOnHost(task: AgentTask | undefined, cloud: boolean): boolean {
  return !cloud && (task === 'issue' || task === 'fix' || task === 'conflicts' || task === 'brief' || task === 'review');
}

export const HOST_AUTONOMY: Record<Autonomy, HostAutonomy> = { ask: 'raise-hand', auto: 'auto', full: 'full' };

/** A conversation the host is still carrying a turn of: the host resumed it, or holds it at a usage limit. */
const MID_TURN = new Set(['running', 'waiting', 'resuming', 'held', 'interrupted']);

/** What a turn does with the agent's conversations on the host. */
export type Joining =
  /** A new conversation; carrying on from an agent session that predates the host when `resumes` is set. */
  | { kind: 'start'; resumes?: string; stop: string[] }
  /** The conversation the turn carries on: send it the prompt. */
  | { kind: 'send'; id: string }
  /**
   * The host is already carrying a turn of it on (it resumed it after a restart, or holds it at a usage limit): watch
   * that turn rather than send the prompt, which would tell the agent it was cut off a second time.
   */
  | { kind: 'attach'; id: string };

/** Which of an agent's conversations (`found`, oldest first) a turn resuming `resumeSessionId` (or none) joins. */
export function joining(found: readonly ConversationSummary[], resumeSessionId: string | undefined): Joining {
  const open = found.filter((c) => c.status !== 'ended');
  if (resumeSessionId) {
    const same = [...open].reverse().find((c) => c.agentSessionId === resumeSessionId || c.agentSessionId === undefined);
    if (same) return MID_TURN.has(same.status) ? { kind: 'attach', id: same.id } : { kind: 'send', id: same.id };
  }
  return { kind: 'start', ...(resumeSessionId && { resumes: resumeSessionId }), stop: open.map((c) => c.id) };
}

/** What a turn comes to when it ends, from its last result. */
export function outcome(ended: Extract<ConversationEvent, { _tag: 'TurnEnded' }>, result: TurnResult | undefined): RunOutcome {
  const summary = result?.text ?? '';
  if (ended.outcome === 'interrupted') return { ok: false, summary, error: STOPPED_BY_CAPTAIN, aborted: true, started: true };
  if (ended.outcome === 'failed') return { ok: false, summary, error: ended.error ?? result?.text ?? 'The session failed', started: true };
  return { ok: !result?.isError, summary, structured: result?.structured, ...(result?.isError && { error: result.text }), started: true };
}

/** Whether something an agent-host event carries is one of Claude Code's own messages (what Focus renders). */
export function isSdkMessage(raw: unknown): raw is SDKMessage {
  return typeof raw === 'object' && raw !== null && 'type' in raw && typeof raw.type === 'string' && ('session_id' in raw || 'uuid' in raw || raw.type === 'result');
}

/** What a turn does with one of the host's journaled events. */
export type Reaction =
  /** A raised hand: put it to the manager. */
  | { kind: 'ask'; requestId: string; tool: string; summary: string }
  /** Someone answered a raised hand or a question: stop waiting on the manager for it. */
  | { kind: 'resolved'; requestId: string }
  /** How full the context window is. */
  | { kind: 'context'; context: { percent: number; tokens: number; max: number } }
  /** Lines for the agent's terminal, and what it's doing, when that changes. */
  | { kind: 'say'; lines: Omit<TermLine, 't'>[]; activity?: string }
  /** The turn is over. */
  | { kind: 'end'; outcome: RunOutcome }
  /**
   * The answer the turn was asked for is in: the turn is over, and whatever the agent still has running in the
   * background goes (a QA officer's preview server would otherwise keep the verdict waiting).
   */
  | { kind: 'answered'; outcome: RunOutcome }
  | { kind: 'none' };

/**
 * What a turn does with `event`, given the turn's last result so far, and whether the turn asked for a structured
 * answer (`expectsAnswer`).
 */
export function reaction(event: ConversationEvent, result: TurnResult | undefined, expectsAnswer = false): Reaction {
  switch (event._tag) {
    case 'StructuredAnswer':
      // nothing sent meanwhile is still to be read: the answer is the turn's last word
      return expectsAnswer && (result?.queued ?? 0) === 0
        ? { kind: 'answered', outcome: { ok: true, summary: result?.text ?? '', structured: event.value, started: true } }
        : { kind: 'none' };
    case 'PermissionRequested':
      return { kind: 'ask', requestId: event.requestId, tool: event.tool, summary: event.summary };
    case 'PermissionAnswered':
    case 'QuestionAnswered':
      return { kind: 'resolved', requestId: event.requestId };
    case 'Usage':
      return event.context ? { kind: 'context', context: event.context } : { kind: 'none' };
    case 'Held':
      return {
        kind: 'say',
        lines: [{ kind: 'error', text: `⚠ Your plan's usage limit is reached – paused until it resets at ${clock(event.until)}` }],
        activity: `Paused for the usage limit until ${clock(event.until)}`,
      };
    case 'Released':
      return { kind: 'say', lines: [{ kind: 'system', text: '✻ The usage limit has reset: carrying on' }] };
    case 'ResumedAfterRestart':
      return { kind: 'say', lines: [{ kind: 'system', text: '✻ Carrying on where Focus stopped' }] };
    case 'TurnEnded':
      return { kind: 'end', outcome: outcome(event, result) };
    case 'ConversationEnded':
      return { kind: 'end', outcome: { ok: false, summary: result?.text ?? '', error: 'The conversation ended', aborted: true, started: true } };
    default:
      return { kind: 'none' };
  }
}
