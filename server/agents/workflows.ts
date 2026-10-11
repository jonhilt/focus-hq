// A lead's workflows (Claude Code's Workflow tool), from what the session reports about them. Pure: the runner reads the
// messages, the manager keeps the result on the lead.
import { Option, Schema } from 'effect';
import type { Workflow, WorkflowAgent, WorkflowPhase } from '../../shared/types';
import type { WorkflowEvent } from './types';
import { truncate } from '../util';
import { renderText, renderToolResult, renderToolUse } from './render';
import type { TermLine } from '../../shared/types';

/** How long a finished workflow's away team stays in the briefing room, so you see how it went before it goes. */
export const WORKFLOW_LINGER_MS = 10_000;

/** How many of a workflow's finished agents it keeps, beside the ones at work: enough to see each one off. */
export const RECENT_AGENTS = 16;

const Phase = Schema.Struct({
  type: Schema.Literal('workflow_phase'),
  index: Schema.Number,
  title: Schema.String,
  kind: Schema.optional(Schema.NullOr(Schema.String)),
});
const Agent = Schema.Struct({
  type: Schema.Literal('workflow_agent'),
  index: Schema.Number,
  label: Schema.String,
  phaseIndex: Schema.optional(Schema.Number),
  state: Schema.String,
  model: Schema.optional(Schema.NullOr(Schema.String)),
  startedAt: Schema.optional(Schema.NullOr(Schema.Number)),
  durationMs: Schema.optional(Schema.NullOr(Schema.Number)),
  promptPreview: Schema.optional(Schema.NullOr(Schema.String)),
  resultPreview: Schema.optional(Schema.NullOr(Schema.String)),
  error: Schema.optional(Schema.NullOr(Schema.String)),
  agentId: Schema.optional(Schema.NullOr(Schema.String)),
});
const decodePhase = Schema.decodeUnknownOption(Phase);
const decodeAgent = Schema.decodeUnknownOption(Agent);

const firstLine = (text: string | null | undefined) => truncate((text ?? '').trim().split('\n')[0] ?? '', 100);

/** What one agent's entry says: queued until it has started, then working, then how it finished. */
function agentFrom(entry: typeof Agent.Type): WorkflowAgent {
  const state = entry.state.toLowerCase();
  const status: WorkflowAgent['status'] =
    state === 'done' || state === 'completed' ? 'done'
    : /fail|error|kill|stop|cancel/.test(state) ? 'failed'
    : entry.startedAt ? 'working'
    : 'queued';
  const activity =
    status === 'done' ? firstLine(entry.resultPreview) || 'Done'
    : status === 'failed' ? firstLine(entry.error) || 'Hit a problem'
    : status === 'working' ? firstLine(entry.promptPreview) || 'Working'
    : 'Waiting for a slot';
  const finishedAt = status === 'done' || status === 'failed' ? (entry.startedAt ?? 0) + (entry.durationMs ?? 0) : undefined;
  return {
    index: entry.index, label: entry.label, phase: entry.phaseIndex ?? 0, status, model: entry.model ?? undefined, activity,
    ...(finishedAt !== undefined && { finishedAt }), ...(entry.agentId && { agentId: entry.agentId }),
  };
}

/**
 * A workflow's phases and agents from the `workflow_progress` a task_progress message carries (not in the SDK's types):
 * the whole of it each time, every agent it has queued so far. Each phase counts its agents; only the agents at work,
 * and the RECENT_AGENTS that finished last, are kept. Entries it doesn't recognise are left out; null when it isn't a
 * list at all.
 */
export function workflowProgress(raw: unknown): { phases: WorkflowPhase[]; agents: WorkflowAgent[] } | null {
  if (!Array.isArray(raw)) return null;
  const phases = new Map<number, WorkflowPhase>();
  const phaseOf = (index: number, title = '') => {
    let phase = phases.get(index);
    if (!phase) phases.set(index, (phase = { index, title, queued: 0, working: 0, done: 0, failed: 0 }));
    return phase;
  };
  const working: WorkflowAgent[] = [];
  const finished: WorkflowAgent[] = [];
  for (const entry of raw) {
    const phase = decodePhase(entry);
    if (Option.isSome(phase)) {
      const p = phaseOf(phase.value.index, phase.value.title);
      p.title = phase.value.title;
      if (phase.value.kind === 'child') p.child = true;
      continue;
    }
    const decoded = decodeAgent(entry);
    if (Option.isNone(decoded)) continue;
    const agent = agentFrom(decoded.value);
    // agents started before any phase was named have one of their own, untitled
    phaseOf(agent.phase)[agent.status]++;
    if (agent.status === 'working') working.push(agent);
    else if (agent.status !== 'queued') finished.push(agent);
  }
  const recent = finished.sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0) || b.index - a.index).slice(0, RECENT_AGENTS);
  return {
    phases: [...phases.values()].sort((a, b) => a.index - b.index),
    agents: [...working, ...recent].sort((a, b) => a.index - b.index),
  };
}

/**
 * The lead's workflows after an event: a new one starts with no agents yet, progress replaces its phases and agents
 * with how they stand now, and one that's finished says how it went (and goes once it has lingered). Agents still
 * working when it ends finish with it. The same list when the event is about no workflow we know of.
 */
export function applyWorkflowEvent(workflows: Workflow[], event: WorkflowEvent, now: number): Workflow[] {
  if (event.kind === 'started') {
    if (workflows.some((w) => w.id === event.id)) return workflows;
    return [...workflows, { id: event.id, name: event.name || 'workflow', description: event.description, status: 'running', phases: [], agents: [], startedAt: now }];
  }
  const workflow = workflows.find((w) => w.id === event.id);
  if (!workflow) return workflows;
  let next: Workflow;
  if (event.kind === 'transcripts') return workflows;
  if (event.kind === 'progress') {
    if (workflow.status !== 'running') return workflows;
    next = { ...workflow, phases: event.phases.length ? event.phases : workflow.phases, agents: event.agents };
  } else {
    const ending = event.ok ? 'done' : 'failed';
    const agents = workflow.agents.map((a): WorkflowAgent =>
      a.status === 'working' || a.status === 'queued' ? { ...a, status: ending, activity: event.ok ? 'Done' : 'Stopped with the workflow', finishedAt: now } : a);
    const phases = workflow.phases.map((p) => ({ ...p, queued: 0, working: 0, [ending]: p[ending] + p.working + p.queued }));
    next = { ...workflow, status: ending, phases, agents };
  }
  return workflows.map((w) => (w.id === event.id ? next : w));
}

/**
 * The workflows the captain approved, in a session that asks before its tools run: approving the Workflow call
 * approves what its own agents do for that run, rather than each of them raising the lead's hand for every command.
 * By the approved call (Workflow's tool use id), then by its workflow (task id) once Claude Code starts it, and each
 * agent (its agentId, as the permission request names it) by the workflow it's in.
 */
export class WorkflowPermits {
  private readonly calls = new Set<string>();
  private readonly approved = new Set<string>();
  private readonly agents = new Map<string, string>();

  /** The captain approved this Workflow call. */
  approveCall(toolUseId: string): void {
    this.calls.add(toolUseId);
  }

  /** Claude Code started workflow `id` for the call `toolUseId`. */
  started(id: string, toolUseId: string | undefined): void {
    if (toolUseId && this.calls.delete(toolUseId)) this.approved.add(id);
  }

  /** Workflow `id`'s agents, as its progress lists them. */
  seen(id: string, agents: { agentId?: string }[]): void {
    for (const a of agents) if (a.agentId) this.agents.set(a.agentId, id);
  }

  ended(id: string): void {
    this.approved.delete(id);
    for (const [agent, workflow] of this.agents) if (workflow === id) this.agents.delete(agent);
  }

  /** Whether agent `agentId`'s request is approved already: it's in a workflow the captain approved, still running. */
  approves(agentId: string | undefined): boolean {
    return !!agentId && this.approved.has(this.agents.get(agentId) ?? '');
  }

  /** Whether a request from `agentId` might yet turn out to be approved, once a workflow's progress names it. */
  mightApprove(agentId: string | undefined): boolean {
    return !!agentId && !this.agents.has(agentId) && this.approved.size > 0;
  }
}

/** What the captain's asked when the lead wants to run a workflow: its name, and what approving it means. */
export function workflowAsk(input: Record<string, unknown>): string {
  const script = typeof input.script === 'string' ? input.script : '';
  const name = /\bname:\s*['"`]([^'"`]+)['"`]/.exec(script)?.[1] ?? (typeof input.name === 'string' ? input.name : 'a workflow');
  return `Run workflow ${name}: its agents run their commands without asking, for this run`;
}

type Block = { type: string; text?: string; name?: string; input?: Record<string, unknown>; content?: unknown };

/**
 * A workflow agent's transcript (the agent-<agentId>.jsonl Claude Code writes as it works) as terminal lines, the way
 * a session's own read: what it was asked, then what it said, the tools it used and what came back. What it thought,
 * and Claude Code's own attachments, are left out; so is any line that isn't JSON (one still being written).
 */
export function transcriptLines(jsonl: string): Omit<TermLine, 't'>[] {
  const lines: Omit<TermLine, 't'>[] = [];
  let asked = false;
  for (const raw of jsonl.split('\n')) {
    let entry: { type?: string; message?: { content?: unknown } };
    try {
      entry = JSON.parse(raw) as typeof entry;
    } catch {
      continue;
    }
    const content = entry.message?.content;
    if (entry.type === 'user' && !asked && typeof content === 'string') {
      asked = true;
      lines.push({ kind: 'manager', text: `▶ ${truncate(content.trim(), 1500)}` });
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const block of content as Block[]) {
      if (entry.type === 'assistant' && block.type === 'text' && block.text?.trim()) lines.push(...renderText(block.text.trim()));
      else if (entry.type === 'assistant' && block.type === 'tool_use' && block.name) lines.push(...renderToolUse(block.name, block.input ?? {}, '').lines);
      else if (entry.type === 'user' && block.type === 'tool_result') lines.push(...renderToolResult(block));
    }
  }
  return lines;
}
