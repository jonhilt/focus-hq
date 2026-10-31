import type { ConversationEvent, OutputPart } from 'agent-host';
import { isTextLine } from '../../shared/stepText';
import type { TermEntry, TextLine } from '../../shared/types';
import { truncate } from '../util';
import type { BackgroundEvent } from './backgroundTasks';
import { callStep, resultStep, toolActivity } from './render';
import { helperBrief, helperEnd, type TurnResult } from './sdkMessages';
import type { RunHooks } from './types';

// A Codex developer's session, rendered from agent-host's common events (a Claude Code one is rendered from Claude
// Code's own messages, which ride along on the same events: sdkMessages.ts). Its steps go under the names Claude Code's
// do (its shell as Bash), its patches as apply_patch calls with their diffs, its spawned agents as helpers.

type Line = TermEntry;

/** What a turn keeps while it renders: Codex's steps in flight, its background commands, and its last answer. */
export interface CommonContext {
  cwd: string;
  /** Steps started and not yet ended, by tool use id. */
  calls: Map<string, string>;
  /** Background commands running, by id. */
  background: Map<string, string>;
  result?: TurnResult;
}

export const newCommonContext = (cwd: string): CommonContext => ({ cwd, calls: new Map(), background: new Map() });

/** A value's own fields, when it's an object: nothing otherwise. */
const fieldsOf = (value: unknown): Record<string, unknown> => (value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {});

/** Codex's tool steps under the names Focus draws them by. */
export function focusTool(name: string, input: unknown): { name: string; input: Record<string, unknown> } {
  const fields = fieldsOf(input);
  if (name === 'shell') return { name: 'Bash', input: { command: fields.command } };
  if (name === 'web_search') return { name: 'WebSearch', input: { query: fields.query } };
  if (name === 'view_image') return { name: 'Read', input: { file_path: fields.path } };
  // the client's own tools, as Claude Code names them: the browser's draw as browser steps
  const tool = /^([^.]+)\.(.+)$/.exec(name);
  if (tool && !name.startsWith('agents.')) return { name: `mcp__${tool[1]}__${tool[2]}`, input: fields };
  return { name, input: fields };
}

/** What changed in the background set, as Focus's background events: new commands started, missing ones ended. */
export function backgroundEvents(running: ReadonlyMap<string, string>, tasks: readonly { id: string; description: string }[]): BackgroundEvent[] {
  const now = new Set(tasks.map((t) => t.id));
  return [
    ...tasks.filter((t) => !running.has(t.id)).map((t): BackgroundEvent => ({ kind: 'started', id: t.id, task: 'shell', description: t.description })),
    ...[...running.keys()].filter((id) => !now.has(id)).map((id): BackgroundEvent => ({ kind: 'ended', id, status: 'done' })),
  ];
}

type Of<T extends ConversationEvent['_tag']> = Extract<ConversationEvent, { _tag: T }>;

/** Entries for the session itself, or for the helper (`helper`) whose they are: its own transcript, else marked as its. */
function sayer(hooks: RunHooks, helper: string | null): (entries: Line[]) => void {
  if (helper === null) return (entries) => hooks.lines(entries);
  if (hooks.helperLines) return (entries) => hooks.helperLines?.(helper, entries);
  return (entries) => hooks.lines(entries.map((e) => (isTextLine(e) ? { ...e, text: `    ${e.text}` } : { ...e, helper })));
}

/** Which helper an event came from: none for the session's own. */
const helperOf = (event: { source: { _tag: 'Main' } | { _tag: 'Subagent'; id: string } }): string | null => (event.source._tag === 'Subagent' ? event.source.id : null);

function assistantMessage(event: Of<'AssistantMessage'>, ctx: CommonContext, hooks: RunHooks): void {
  const helper = helperOf(event);
  const text = event.text.trim();
  sayer(hooks, helper)([{ kind: 'reply', text }]);
  if (helper !== null) return;
  ctx.result = { text, isError: false, queued: 0, ...(ctx.result?.structured !== undefined && { structured: ctx.result.structured }) };
  hooks.activity(null, truncate(text.split('\n')[0] ?? '', 80));
}

function toolStepStarted(event: Of<'ToolStepStarted'>, ctx: CommonContext, hooks: RunHooks): void {
  const helper = helperOf(event);
  ctx.calls.set(event.toolUseId, event.name);
  const tool = event.name === 'apply_patch' ? { name: 'apply_patch', input: { changes: fieldsOf(event.input).changes } } : focusTool(event.name, event.input);
  sayer(hooks, helper)([callStep(event.toolUseId, tool.name, tool.input, ctx.cwd)]);
  const { status, activity } = toolActivity(tool.name, tool.input, ctx.cwd);
  if (!activity) return;
  if (helper !== null) hooks.helper?.({ kind: 'activity', id: helper, activity });
  else hooks.activity(status ?? null, activity);
}

/** What a step gave back: all of it (`parts`), or its head and tail as a journal from before kept it whole. */
export function stepContent(output: { head: string; tail: string }, parts: readonly OutputPart[] | undefined): unknown {
  if (!parts) return output.tail ? `${output.head}\n…\n${output.tail}` : output.head;
  return parts.map((p) => (p._tag === 'Text' ? { type: 'text', text: p.text } : { type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.data } }));
}

function toolStepEnded(event: Of<'ToolStepEnded'>, ctx: CommonContext, hooks: RunHooks): void {
  ctx.calls.delete(event.toolUseId);
  sayer(hooks, helperOf(event))([resultStep(event.toolUseId, { content: stepContent(event.output, event.parts), is_error: !event.ok })]);
}

function subagentStarted(event: Of<'SubagentStarted'>, hooks: RunHooks): void {
  hooks.helper?.({ kind: 'started', id: event.id, description: event.description, ...(event.type && { type: event.type }) });
  hooks.helperLines?.(event.id, helperBrief(event.description, undefined));
}

function subagentFinished(event: Of<'SubagentFinished'>, hooks: RunHooks): void {
  hooks.helper?.({ kind: 'ended', id: event.id, ok: event.ok, ...(event.summary && { summary: event.summary }) });
  hooks.helperLines?.(event.id, [helperEnd(event.ok ? 'completed' : 'failed')]);
}

function backgroundChanged(event: Of<'BackgroundChanged'>, ctx: CommonContext, hooks: RunHooks): void {
  for (const e of backgroundEvents(ctx.background, event.tasks)) hooks.background?.(e);
  ctx.background = new Map(event.tasks.map((t) => [t.id, t.description]));
}

/** The turn's last line: done, or how it went wrong. */
export function turnEndLine(event: Of<'TurnEnded'>): TextLine {
  return event.outcome === 'completed' ? { kind: 'success', text: '✔ Done' } : { kind: 'error', text: `✘ ${event.outcome}${event.error ? `: ${truncate(event.error, 200)}` : ''}` };
}

/** Renders one of the host's journaled events for a Codex developer. */
export function handleCommonEvent(event: ConversationEvent, ctx: CommonContext, hooks: RunHooks): void {
  switch (event._tag) {
    case 'AgentSessionOpened':
      hooks.session(event.agentSessionId, event.keySource);
      return hooks.lines([{ kind: 'system', text: '✻ Codex' }]);
    case 'AssistantMessage':
      return assistantMessage(event, ctx, hooks);
    case 'Thinking':
      return sayer(hooks, helperOf(event))([{ kind: 'think', text: event.text.trim() }]);
    case 'StructuredAnswer':
      ctx.result = { text: ctx.result?.text ?? '', isError: false, queued: 0, structured: event.value };
      return;
    case 'ToolStepStarted':
      return toolStepStarted(event, ctx, hooks);
    case 'ToolStepEnded':
      return toolStepEnded(event, ctx, hooks);
    case 'SubagentStarted':
      return subagentStarted(event, hooks);
    case 'SubagentBusy':
      return hooks.helper?.({ kind: 'activity', id: event.id, activity: event.activity });
    case 'SubagentFinished':
      return subagentFinished(event, hooks);
    case 'BackgroundChanged':
      return backgroundChanged(event, ctx, hooks);
    case 'Usage':
      if (event.costUsd !== undefined) hooks.cost(event.costUsd);
      return;
    case 'Compacted':
      return hooks.lines([{ kind: 'system', text: '✻ Conversation compacted' }]);
    case 'TurnEnded':
      return hooks.lines([turnEndLine(event)]);
  }
}
