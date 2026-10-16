import type { SDKAssistantMessage, SDKMessage, SDKRateLimitEvent, SDKResultMessage, SDKTaskNotificationMessage, SDKTaskProgressMessage, SDKTaskStartedMessage } from '@anthropic-ai/claude-agent-sdk';
import { clock } from '../../shared/clock';
import { cloudSessionUrl } from '../../shared/cloud';
import type { TermKind, TermLine } from '../../shared/types';
import { truncate } from '../util';
import { keyFallback, limitReached, requestUsd } from './apiKey';
import { gitCommit } from './commits';
import { appUrl, renderText, renderToolResult, renderToolUse, screenshotFrame, type ToolCall } from './render';
import { scratchScript } from './scratch';
import { TASK_TOOLS } from './tasks';
import { BackgroundTracker } from './backgroundTasks';
import type { RunHooks, WorkflowUsage } from './types';
import { type WorkflowPermits, workflowProgress } from './workflows';

type Line = Omit<TermLine, 't'>;
type SystemMessage = Extract<SDKMessage, { type: 'system' }>;
type UserMessage = Extract<SDKMessage, { type: 'user' }>;
type ContentBlock = SDKAssistantMessage['message']['content'][number];
type ToolResultBlock = { type: 'tool_result'; tool_use_id: string; is_error?: boolean | null; content?: unknown };

/** What one run remembers between messages: tool calls waiting for their results, and the page last pointed at. */
export interface RunContext {
  cwd: string;
  cloud: boolean;
  calls: Map<string, ToolCall>;
  lastUrl?: string;
  /** The cloud session's id, once the CLI has reported it. */
  cloudId?: string;
  /** Subagents by Claude Code's task id: the Agent tool call that started each, which their messages point back to. */
  helpers: Map<string, string>;
  /** Workflows by Claude Code's task id. */
  workflows: Set<string>;
  /** Which workflows' agents may run their tools without asking. Missing in a context that doesn't ask. */
  permits?: WorkflowPermits;
  /** The session's background commands and monitors. Missing in a context that doesn't follow them. */
  tracker?: BackgroundTracker;
  /** The helper that made each Agent call a helper made (by the call's id), so the helper it starts knows its parent. */
  parents?: Map<string, string>;
  /** Subagents (by Agent tool call) whose model we've reported. */
  modelled: Set<string>;
  /** The scratch dir (a local session's), and the Bash calls running scripts from it: probes, until their results come. */
  scratch?: string;
  probes: Set<string>;
  /** The Bash calls making commits (the session's own), with their messages, until their results say they worked. */
  commits: Map<string, string | undefined>;
  /** Signed in with your API key rather than your login. */
  onKey: boolean;
  /** The API requests already counted against the key's budget: Claude Code sends each one's usage with every block of it. */
  counted: Set<string>;
  /** The kinds of background task the session has running now (not the ambient ones), as Claude Code last listed them. */
  background?: string[];
  /** Your plan's usage limit stopped the session, to carry on with the key (sessions.ts decides when). */
  limited?: boolean;
}

/** A turn's result: what the session said, whether it failed, and how many messages the CLI still has queued. */
export interface TurnResult {
  text: string;
  isError: boolean;
  queued: number;
  structured?: unknown;
}

/** Tells the hooks what a message says about the session's background commands and monitors (`BackgroundTracker`). */
function followBackground(msg: SDKMessage, ctx: RunContext, hooks: RunHooks): void {
  const tracker = ctx.tracker;
  if (!tracker || !hooks.background) return;
  const resultText = (b: { type: string; content?: unknown }): string[] =>
    b.type !== 'tool_result' ? []
    : typeof b.content === 'string' ? [b.content]
    : Array.isArray(b.content) ? (b.content as { type: string; text?: string }[]).flatMap((c) => (c.type === 'text' && c.text ? [c.text] : []))
    : [];
  const events = msg.type === 'system' ? tracker.system(msg as Parameters<BackgroundTracker['system']>[0])
    : msg.type === 'user' && Array.isArray(msg.message.content) ? msg.message.content.flatMap((b) => resultText(b).flatMap((t) => tracker.toolResult(t)))
    : [];
  for (const e of events) hooks.background(e);
}

/** Renders one SDK message; returns the outcome when it is a turn result. */
export function handleMessage(msg: SDKMessage, ctx: RunContext, hooks: RunHooks): TurnResult | null {
  followBackground(msg, ctx, hooks);
  switch (msg.type) {
    case 'system':
      systemMessage(msg, ctx, hooks);
      return null;
    case 'assistant':
      assistantMessage(msg, ctx, hooks);
      return null;
    case 'user':
      userMessage(msg, ctx, hooks);
      return null;
    case 'rate_limit_event':
      rateLimit(msg, ctx, hooks);
      return null;
    case 'result': {
      hooks.cost(msg.total_cost_usd);
      const { line, result } = turnResult(msg);
      hooks.lines([line]);
      return result;
    }
    default:
      return null;
  }
}

// ── system messages ──────────────────────────────────────────────────────────

function systemMessage(msg: SystemMessage, ctx: RunContext, hooks: RunHooks): void {
  cloudSession(msg, ctx, hooks);
  if (msg.subtype === 'task_started') return taskStarted(msg, ctx, hooks);
  if (msg.subtype === 'task_progress') return taskProgress(msg, ctx, hooks);
  if (msg.subtype === 'task_notification') return taskNotification(msg, ctx, hooks);
  if (msg.subtype === 'background_tasks_changed') {
    ctx.background = foregroundTasks(msg.tasks);
    return;
  }
  if (msg.subtype === 'init' && !ctx.cloud) hooks.session(msg.session_id, msg.apiKeySource);
  const note = systemNote(msg, ctx.cloud);
  if (note) hooks.lines([note.line]);
  if (note?.activity) hooks.activity(null, note.activity);
}

/**
 * The cloud session's id, when this message brings a new one. Relayed from a cloud session, init (and later
 * cloud_session_delta) carry the cloud session's own id: the one `--cloud <id>` reattaches with. The worker's
 * session_id beside it doesn't reattach.
 */
export function newCloudId(msg: unknown, ctx: Pick<RunContext, 'cloud' | 'cloudId'>): string | undefined {
  const id = (msg as { cloud_session?: { id?: unknown } }).cloud_session?.id;
  return ctx.cloud && typeof id === 'string' && id !== ctx.cloudId ? id : undefined;
}

function cloudSession(msg: SystemMessage, ctx: RunContext, hooks: RunHooks): void {
  const cloudId = newCloudId(msg, ctx);
  if (!cloudId) return;
  ctx.cloudId = cloudId;
  hooks.session(cloudId);
  const url = cloudSessionUrl({ cloud: true, sessionId: cloudId });
  if (url) hooks.lines([{ kind: 'system', text: `☁ Cloud session: ${url}` }]);
}

/** The kinds of background task running, leaving out the ambient ones. */
export function foregroundTasks(tasks: { task_type?: string; ambient?: boolean }[] | undefined): string[] {
  return (tasks ?? []).filter((t) => !t.ambient).map((t) => t.task_type ?? '');
}

/** What the session's own system notes show: Claude Code starting, the CLI's notes on a cloud session, API retries, compaction. */
export function systemNote(msg: SystemMessage, cloud: boolean): { line: Line; activity?: string } | undefined {
  const subtype = (msg as { subtype: string }).subtype;
  if (msg.subtype === 'init') {
    return { line: { kind: 'system', text: `✻ Claude Code ${msg.claude_code_version} · ${msg.model} · ${msg.permissionMode}${cloud ? ' · ☁ cloud' : ''}` } };
  }
  if (subtype === 'cloud_session_status') {
    // the CLI's own notes on the cloud session (starting up, where to watch it)
    const content = (msg as { content?: unknown }).content;
    return typeof content === 'string' && content.trim() ? { line: { kind: 'system', text: `☁ ${truncate(content.trim(), 300)}` } } : undefined;
  }
  if (msg.subtype === 'api_retry') {
    return { line: { kind: 'error', text: `  ⚠ API ${msg.error} – retrying (attempt ${msg.attempt}/${msg.max_retries})` }, activity: `Waiting on the API (${msg.error})` };
  }
  if (msg.subtype === 'compact_boundary') return { line: { kind: 'system', text: '✻ Conversation compacted' } };
  return undefined;
}

function taskStarted(msg: SDKTaskStartedMessage, ctx: RunContext, hooks: RunHooks): void {
  if (msg.task_type === 'local_workflow') {
    // a workflow: its agents report nothing of their own, only how the whole of it stands in its progress
    ctx.workflows.add(msg.task_id);
    ctx.permits?.started(msg.task_id, msg.tool_use_id);
    const script = msg.tool_use_id ? ctx.calls.get(msg.tool_use_id)?.input.script : undefined;
    hooks.workflow?.({ kind: 'started', id: msg.task_id, name: msg.workflow_name ?? '', description: msg.description, ...(typeof script === 'string' && { script }) });
  } else if (msg.task_type === 'local_agent') {
    // a subagent: known by the Agent tool call that started it, which its own messages point back to
    const id = msg.tool_use_id ?? msg.task_id;
    ctx.helpers.set(msg.task_id, id);
    hooks.helper?.({ kind: 'started', id, description: msg.description, type: msg.subagent_type, parent: ctx.parents?.get(id) });
    const prompt = msg.tool_use_id ? ctx.calls.get(msg.tool_use_id)?.input.prompt : undefined;
    hooks.helperLines?.(id, helperBrief(msg.description, prompt));
  }
}

/** A subagent's transcript starts with what they were asked. */
export function helperBrief(description: string, prompt: unknown): Line[] {
  const asked = typeof prompt === 'string' ? prompt.trim() : '';
  return [{ kind: 'system', text: `✻ ${description}` }, ...(asked ? [{ kind: 'manager' as const, text: `▶ ${asked}` }] : [])];
}

function taskProgress(msg: SDKTaskProgressMessage, ctx: RunContext, hooks: RunHooks): void {
  if (ctx.workflows.has(msg.task_id)) {
    const progress = workflowProgress((msg as { workflow_progress?: unknown }).workflow_progress);
    if (progress) {
      ctx.permits?.seen(msg.task_id, progress.agents);
      hooks.workflow?.({ kind: 'progress', id: msg.task_id, ...progress, ...workflowUsage(msg.usage) });
    }
    return;
  }
  const id = ctx.helpers.get(msg.task_id);
  const activity = helperActivity(msg);
  if (id && activity) hooks.helper?.({ kind: 'activity', id, activity: truncate(activity, 100) });
}

/** A workflow's usage so far, as its task's progress or ending counts it (`usage` for the event, when there is one). */
export function workflowUsage(usage: { total_tokens: number; tool_uses: number } | undefined): { usage?: WorkflowUsage } {
  return typeof usage?.total_tokens === 'number' ? { usage: { tokens: usage.total_tokens, toolUses: usage.tool_uses || 0 } } : {};
}

/** What a subagent's busy with, from its progress: its own summary, or else the tool it last used. */
export function helperActivity(msg: Pick<SDKTaskProgressMessage, 'summary' | 'last_tool_name'>): string {
  return msg.summary ?? (msg.last_tool_name ? `Using ${msg.last_tool_name}` : '');
}

function taskNotification(msg: SDKTaskNotificationMessage, ctx: RunContext, hooks: RunHooks): void {
  if (ctx.workflows.has(msg.task_id)) {
    hooks.workflow?.({ kind: 'ended', id: msg.task_id, ok: msg.status === 'completed', ...workflowUsage(msg.usage) });
    ctx.permits?.ended(msg.task_id);
    ctx.workflows.delete(msg.task_id);
    return;
  }
  const id = ctx.helpers.get(msg.task_id);
  if (id) {
    hooks.helper?.({ kind: 'ended', id, ok: msg.status === 'completed', summary: truncate(msg.summary, 100) });
    hooks.helperLines?.(id, [helperEnd(msg.status)]);
  }
  ctx.helpers.delete(msg.task_id);
}

/** The last line of a subagent's transcript: how it ended. */
export function helperEnd(status: string): Line {
  return status === 'completed' ? { kind: 'success', text: '✔ Done' } : { kind: 'error', text: `✘ ${status}` };
}

// ── assistant messages ───────────────────────────────────────────────────────

function assistantMessage(msg: SDKAssistantMessage, ctx: RunContext, hooks: RunHooks): void {
  countSpend(msg, ctx);
  if (msg.error) hooks.lines([{ kind: 'error', text: `⚠ ${msg.error}` }]);
  const parent = msg.parent_tool_use_id;
  if (parent !== null) helperModel(parent, msg.message.model, ctx, hooks);
  for (const block of msg.message.content) assistantBlock(block, parent, ctx, hooks);
}

/** What the key spends, against its budget for while your plan's limit is reached. */
function countSpend(msg: SDKAssistantMessage, ctx: RunContext): void {
  if (!ctx.onKey || ctx.counted.has(msg.message.id)) return;
  ctx.counted.add(msg.message.id);
  keyFallback.spent(requestUsd(msg.message.usage, msg.message.model));
}

/** A subagent's model is only in its own messages: reported the first time one says. */
function helperModel(parent: string, model: string | undefined, ctx: RunContext, hooks: RunHooks): void {
  if (!model || ctx.modelled.has(parent)) return;
  ctx.modelled.add(parent);
  hooks.helper?.({ kind: 'model', id: parent, model });
  hooks.helperLines?.(parent, [{ kind: 'system', text: `✻ ${model}` }]);
}

/** The session's own lines, or a subagent's: a transcript of its own, or else indented in the session's (in `kind`, when it says). */
function say(hooks: RunHooks, parent: string | null, lines: Line[], kind?: TermKind): void {
  if (parent === null) hooks.lines(lines);
  else if (hooks.helperLines) hooks.helperLines(parent, lines);
  else hooks.lines(lines.map((l) => ({ ...l, kind: kind ?? l.kind, text: `    ${l.text}` })));
}

function assistantBlock(block: ContentBlock, parent: string | null, ctx: RunContext, hooks: RunHooks): void {
  if (block.type === 'text' && block.text.trim()) {
    const text = block.text.trim();
    say(hooks, parent, renderText(text), 'output');
    if (parent === null) hooks.activity(null, truncate(text.split('\n')[0], 80));
  } else if (block.type === 'thinking') {
    say(hooks, parent, [{ kind: 'thinking', text: '✻ Thinking…' }]);
    hooks.activity(null, 'Thinking…');
  } else if (block.type === 'tool_use') {
    toolUse(block.id, { name: block.name, input: (block.input ?? {}) as Record<string, unknown> }, parent, ctx, hooks);
  }
}

function toolUse(id: string, call: ToolCall, parent: string | null, ctx: RunContext, hooks: RunHooks): void {
  ctx.calls.set(id, call);
  // a helper starting a helper of its own: the one it starts is known by this call
  if (parent !== null && (call.name === 'Agent' || call.name === 'Task')) ctx.parents?.set(id, parent);
  ctx.lastUrl = appUrl(call) ?? ctx.lastUrl;
  const rendered = renderToolUse(call.name, call.input, ctx.cwd);
  say(hooks, parent, rendered.lines);
  if (rendered.activity || rendered.status) hooks.activity(rendered.status ?? null, rendered.activity ?? '');
  // a subagent's tool call is what that helper is busy with
  if (parent !== null && rendered.activity) hooks.helper?.({ kind: 'activity', id: parent, activity: rendered.activity });
  if (parent === null) watchBash(ctx, id, call, hooks);
}

/**
 * A Bash call of the session's own, watched for what the goal's chart shows: a script from its scratch dir is a probe it
 * sent out (launched now), and a commit is work done on the slice (counted once its result says it worked).
 */
function watchBash(ctx: Pick<RunContext, 'scratch' | 'probes' | 'commits'>, id: string, call: ToolCall, hooks: RunHooks): void {
  const command = call.name === 'Bash' && typeof call.input.command === 'string' ? call.input.command : undefined;
  if (!command) return;
  const commit = gitCommit(command);
  if (commit) ctx.commits.set(id, commit.message);
  const script = ctx.scratch ? scratchScript(command, ctx.scratch) : undefined;
  if (!script) return;
  ctx.probes.add(id);
  hooks.probe?.({ kind: 'started', id, description: `Script ${script}`, type: 'script' });
}

// ── user messages (tool results) ─────────────────────────────────────────────

function userMessage(msg: UserMessage, ctx: RunContext, hooks: RunHooks): void {
  const content = msg.message.content;
  if (!Array.isArray(content)) return;
  const results = content.filter((b) => b.type === 'tool_result');
  // a workflow launched: where its agents' transcripts are written
  const launched = msg.tool_use_result as { taskId?: unknown; transcriptDir?: unknown; scriptPath?: unknown } | undefined;
  if (launched && typeof launched.taskId === 'string' && typeof launched.transcriptDir === 'string') {
    const scriptPath = typeof launched.scriptPath === 'string' ? launched.scriptPath : undefined;
    hooks.workflow?.({ kind: 'transcripts', id: launched.taskId, dir: launched.transcriptDir, ...(scriptPath && { scriptPath }) });
  }
  // the structured output is the message's only when it carries this one result
  const structured = results.length === 1 ? msg.tool_use_result : undefined;
  for (const block of results) toolResult(block, msg.parent_tool_use_id, structured, ctx, hooks);
}

function toolResult(block: ToolResultBlock, parent: string | null, structured: unknown, ctx: RunContext, hooks: RunHooks): void {
  const call = ctx.calls.get(block.tool_use_id);
  ctx.calls.delete(block.tool_use_id);
  watchedResult(ctx, block, hooks);
  // a subagent's results only go in a transcript of its own: indented in the session's, they'd drown it
  if (parent === null) hooks.lines(renderToolResult(block));
  else hooks.helperLines?.(parent, renderToolResult(block));
  // the agent's own task list (a subagent's is its own business)
  if (call && TASK_TOOLS.has(call.name) && parent === null) hooks.taskTool?.(call.name, call.input, structured, resultText(block.content));
  // an image the agent (or a subagent) looked at goes on its laptop screen, like our browser tool's frames
  const frame = screenshotFrame(block, call, ctx.lastUrl, Date.now());
  if (!frame) return;
  hooks.browser(frame);
  const seen = screenshotActivity(frame.url);
  hooks.activity(seen.status, seen.activity);
}

/** The text a tool result carries: all of it when it's a string, its text blocks' otherwise. */
export function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((c: { type?: string; text?: string }) => (c.type === 'text' ? c.text ?? '' : '')).join('\n');
}

/** What looking at an image is: testing, when it's a screenshot of a page. */
export function screenshotActivity(url: string): { status: 'testing' | null; activity: string } {
  const page = /^https?:\/\//.test(url);
  return { status: page ? 'testing' : null, activity: `${page ? 'Checking a screenshot of' : 'Looking at'} ${truncate(url, 60)}` };
}

/** A watched Bash call's result: the commit it made counts if it worked, and its probe transmits what it printed first. */
function watchedResult(ctx: Pick<RunContext, 'probes' | 'commits'>, block: ToolResultBlock, hooks: RunHooks): void {
  const id = block.tool_use_id;
  if (ctx.commits.has(id)) {
    const message = ctx.commits.get(id);
    ctx.commits.delete(id);
    if (!block.is_error) hooks.commit?.(message);
  }
  if (!ctx.probes.delete(id)) return;
  const first = resultText(block.content).split('\n').map((l) => l.trim()).find(Boolean);
  hooks.probe?.({ kind: 'ended', id, ok: !block.is_error, ...(first && { summary: first }) });
}

// ── rate limits and results ──────────────────────────────────────────────────

function rateLimit(msg: SDKRateLimitEvent, ctx: RunContext, hooks: RunHooks): void {
  const until = limitReached(msg.rate_limit_info, Date.now());
  if (until === null) return;
  keyFallback.limitHit(until);
  // a session on your plan stops here, and picks its conversation back up with your API key
  const switching = switchesToKey(ctx, () => keyFallback.onKey());
  if (switching) ctx.limited = true;
  const notice = limitNotice(until, switching);
  hooks.lines([notice.line]);
  hooks.activity(null, notice.activity);
}

/** Whether a session that's hit your plan's limit stops to carry on with the key: a local one on your plan, once the office says so. */
export function switchesToKey(ctx: Pick<RunContext, 'onKey' | 'cloud'>, keyNow: () => boolean): boolean {
  return !ctx.onKey && !ctx.cloud && keyNow();
}

/** What the session shows when your plan's limit is reached: switching to the key, or waiting for the reset. */
export function limitNotice(until: number, switching: boolean): { line: Line; activity: string } {
  return switching
    ? { line: { kind: 'error', text: `⚠ Your plan's usage limit is reached until ${clock(until)} – switching to your API key` }, activity: 'Switching to your API key' }
    : { line: { kind: 'error', text: `⚠ Your plan's usage limit is reached – waiting for it to reset at ${clock(until)}` }, activity: 'Rate limited – waiting' };
}

/** A turn's result message: the line it shows and what the run takes from it. */
export function turnResult(msg: SDKResultMessage): { line: Line; result: TurnResult } {
  const queued = msg.queued_turn_count ?? 0;
  if (msg.subtype === 'success') {
    return {
      line: { kind: 'success', text: `✔ Done in ${Math.round(msg.duration_ms / 1000)}s · ${msg.num_turns} turns` },
      result: { text: msg.result, isError: msg.is_error, queued, structured: msg.structured_output },
    };
  }
  const text = msg.errors?.join('\n') || msg.subtype;
  return { line: { kind: 'error', text: `✘ ${msg.subtype}: ${truncate(text, 300)}` }, result: { text, isError: true, queued } };
}
