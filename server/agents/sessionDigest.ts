import type { LedgerEvent, SessionDigest, SessionFacts } from '../../shared/ledger';
import type { Agent } from '../../shared/types';
import { type Block, blocks, messageFrom, resultText, transcriptLines } from './transcript';

// A digest of a span of an agent's session, from code alone: its Claude Code transcript (from the line after the last
// digest's to the end) and the ledger's lines on its pull requests. Written when the agent goes home, when QA gives a
// verdict, and when a lead's slice lands; a span already digested comes out empty, so calling it again is harmless.

/** The captain saying little more than "go on": a sign the agent stopped when it needn't have. */
const NUDGE = /^(continue|carry on|keep going|go( ahead| on)?|proceed|yes( please)?|yep|ok(ay)?|sure|ship it|make it so|do it|sounds good)\b/i;
/** A tool error that's a refusal: a guard, hook or permission check said no. */
const REFUSED = /denied|blocked|hook error|not allowed|permission/i;


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
  for (const line of transcriptLines(jsonl)) {
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

/**
 * What a transcript on disk says about the session when its agent is long gone, for a backfilled digest: the kind of
 * agent (from its folder), its project (a lead's or QA's folder names it), the PR a QA session reviewed, and what the
 * session cost by its end (Claude Code's own running total, when it wrote one).
 */
export function backfillWho(t: { name: string; kind: 'lead' | 'agent' | 'qa' }, jsonl: string): { task: Agent['task']; projectId: string; prs: { repo: string; pr: number }[]; costUsd?: number } {
  const task = t.kind === 'lead' ? 'lead' : t.kind === 'qa' ? 'review' : 'issue';
  const project = /proj-([a-z0-9]+)/.exec(t.name)?.[1];
  const review = /Please QA pull request #(\d+) in ([\w.-]+\/[\w.-]+)/.exec(jsonl);
  let costUsd: number | undefined;
  for (const m of jsonl.matchAll(/"type":"cost-state"[^\n]*?"totalCostUSD":([\d.]+)/g)) costUsd = Number(m[1]);
  return { task, projectId: project ? `proj_${project}` : '', prs: t.kind === 'qa' && review ? [{ repo: review[2], pr: Number(review[1]) }] : [], costUsd };
}
