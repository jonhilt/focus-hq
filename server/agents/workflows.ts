// A lead's workflows (Claude Code's Workflow tool), from what the session reports about them. Pure: the runner reads the
// messages, the manager keeps the result on the lead.
import { Option, Schema } from 'effect';
import type { Workflow, WorkflowAgent, WorkflowPhase } from '../../shared/types';
import type { WorkflowEvent } from './types';
import { truncate } from '../util';

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
  return { index: entry.index, label: entry.label, phase: entry.phaseIndex ?? 0, status, model: entry.model ?? undefined, activity, ...(finishedAt !== undefined && { finishedAt }) };
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
