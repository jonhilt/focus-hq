import type { LedgerEvent, SessionDigest, SessionFacts } from '../../shared/ledger';
import type { Agent } from '../../shared/types';
import { messageFrom } from './retro';

// A digest of a span of an agent's session, from code alone: its Claude Code transcript (from the line after the last
// digest's to the end) and the ledger's lines on its pull requests. Written when the agent goes home, when QA gives a
// verdict, and when a lead's slice lands; a span already digested comes out empty, so calling it again is harmless.

/** The captain saying little more than "go on": a sign the agent stopped when it needn't have. */
const NUDGE = /^(continue|carry on|keep going|go( ahead| on)?|proceed|yes( please)?|yep|ok(ay)?|sure|ship it|make it so|do it|sounds good)\b/i;
/** A tool error that's a refusal: a guard, hook or permission check said no. */
const REFUSED = /denied|blocked|hook error|not allowed|permission/i;

type Block = { type?: string; text?: string; name?: string; id?: string; tool_use_id?: string; input?: unknown; is_error?: boolean; content?: unknown };
type Line = { type?: string; uuid?: string; timestamp?: string; isMeta?: boolean; message?: { content?: unknown } };

const blocks = (line: Line): Block[] => {
  const content = line.message?.content;
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return Array.isArray(content) ? (content as Block[]) : [];
};
const resultText = (content: unknown) => (typeof content === 'string' ? content : Array.isArray(content) ? (content as Block[]).map((b) => b.text ?? '').join(' ') : '');

/** Which call it is: the tool and its input, leaving out a Bash call's description of itself. */
function callKey(b: Block): string {
  const { description: _d, ...input } = (b.input ?? {}) as Record<string, unknown>;
  return `${b.name}:${JSON.stringify(input)}`;
}

export type SpanFacts = Omit<SessionFacts, 'costUsd' | 'qaFails' | 'conflicts'>;

export interface Span {
  afterUuid?: string;
  toUuid: string;
  from?: string;
  to?: string;
  facts: SpanFacts;
}

/**
 * What a transcript says from the line after `afterUuid` (from the start without one) to its end, or undefined when
 * there's nothing new. Lines that don't parse are skipped: a transcript can be mid-write.
 */
export function transcriptSpan(jsonl: string, afterUuid?: string): Span | undefined {
  const facts: SpanFacts = { minutes: 0, turns: 0, toolCalls: 0, failedCalls: 0, refusedCalls: 0, repeatedCalls: 0, wastedCalls: 0, captainMessages: 0, nudges: 0, officeMessages: 0, compactions: 0 };
  let inSpan = !afterUuid;
  let toUuid: string | undefined;
  let from: string | undefined;
  let to: string | undefined;
  // each call's tool and input by its id, and the calls that have failed: running one of those again is a repeat
  const callKeys = new Map<string, string>();
  const failed = new Set<string>();
  for (const text of jsonl.split('\n')) {
    if (!text.trim()) continue;
    let line: Line;
    try {
      line = JSON.parse(text) as Line;
    } catch {
      continue;
    }
    if (!inSpan) {
      if (line.uuid === afterUuid) inSpan = true;
      continue;
    }
    if (line.uuid) toUuid = line.uuid;
    if (line.timestamp) {
      from ??= line.timestamp;
      to = line.timestamp;
    }
    if (line.type === 'assistant') {
      facts.turns++;
      for (const b of blocks(line)) {
        if (b.type !== 'tool_use') continue;
        facts.toolCalls++;
        const key = callKey(b);
        if (failed.has(key)) facts.repeatedCalls++;
        if (b.id) callKeys.set(b.id, key);
      }
    } else if (line.type === 'user' && !line.isMeta) {
      for (const b of blocks(line)) {
        if (b.type === 'tool_result' && b.is_error) {
          facts.failedCalls++;
          const key = b.tool_use_id && callKeys.get(b.tool_use_id);
          if (key) failed.add(key);
          if (REFUSED.test(resultText(b.content))) facts.refusedCalls++;
        }
        if (b.type !== 'text' || !b.text?.trim()) continue;
        const said = messageFrom(b.text);
        if (said === 'captain') {
          facts.captainMessages++;
          const t = b.text.trim();
          if (t.length <= 40 && NUDGE.test(t)) facts.nudges++;
        } else if (said === 'office' || said === 'qa') facts.officeMessages++;
        else if (said === 'compacted') facts.compactions++;
      }
    }
  }
  if (!toUuid) return undefined;
  facts.wastedCalls = facts.failedCalls + facts.repeatedCalls;
  facts.minutes = from && to ? Math.round((Date.parse(to) - Date.parse(from)) / 60_000) : 0;
  return { afterUuid, toUuid, from, to, facts };
}

/** Where the next digest of this session starts: after the last one's last line, and what the session had cost by then. */
export function lastDigest(ledger: LedgerEvent[], sessionId: string): { toUuid: string; sessionCostUsd?: number } | undefined {
  for (let i = ledger.length - 1; i >= 0; i--) {
    const e = ledger[i];
    if (e.kind === 'session-digest' && e.sessionId === sessionId) return { toUuid: e.toUuid, sessionCostUsd: e.sessionCostUsd };
  }
  return undefined;
}

/**
 * The ledger entry for a span: the transcript's facts, what the span cost (the agent's running total for the session,
 * less what the last digest of it had counted), and the ledger's QA fails and conflicts on its pull requests so far.
 */
export function digestEntry(
  span: Span,
  agent: Pick<Agent, 'id' | 'name' | 'task' | 'sessionId' | 'costUsd'> & { sessionId: string },
  prs: { repo: string; pr: number }[],
  ledger: LedgerEvent[],
  goal?: string,
): SessionDigest {
  const before = lastDigest(ledger, agent.sessionId)?.sessionCostUsd ?? 0;
  const on = (e: { repo: string; pr: number }) => prs.some((p) => p.repo === e.repo && p.pr === e.pr);
  const qaFails = ledger.filter((e) => e.kind === 'qa-verdict' && e.verdict === 'fail' && on(e)).length;
  const conflicts = ledger.filter((e) => e.kind === 'conflicts' && e.resolved !== 'up-to-date' && on(e)).length;
  return {
    kind: 'session-digest',
    key: `${agent.sessionId}:${span.toUuid}`,
    sessionId: agent.sessionId,
    agentId: agent.id,
    agent: agent.name,
    task: agent.task,
    prs,
    goal,
    afterUuid: span.afterUuid,
    toUuid: span.toUuid,
    from: span.from,
    to: span.to,
    sessionCostUsd: agent.costUsd,
    facts: { ...span.facts, costUsd: Math.max(0, agent.costUsd - before), qaFails, conflicts },
  };
}
