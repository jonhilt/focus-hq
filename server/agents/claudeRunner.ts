import { homedir } from 'node:os';
import { join } from 'node:path';
import { query, type CanUseTool, type Options, type Query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { clock } from '../../shared/clock';
import { cloudSessionUrl } from '../../shared/cloud';
import type { TermKind, TermLine } from '../../shared/types';
import { paths } from '../config';
import { errorMessage, sleep, truncate } from '../util';
import { keyFallback, limitReached, requestUsd } from './apiKey';
import { BrowserPool, browserMcpServer } from './browserTool';
import { CLOUD_UNAVAILABLE, cloudRefused } from './cloud';
import { officeMcpServer } from './officeTool';
import { openScratch } from './scratch';
import { appUrl, renderText, renderToolResult, renderToolUse, screenshotFrame, type ToolCall } from './render';
import { TASK_TOOLS } from './tasks';
import { WorkflowPermits, workflowAsk, workflowProgress } from './workflows';
import { bundledClaude, openTerminal, readTerminal } from './terminal';
import { type AgentRunner, type AgentSession, type CloudTerminal, type CloudTerminalRequest, type RunHooks, type RunOutcome, type RunRequest, LIMIT_REACHED, STOPPED_BY_CAPTAIN } from './types';

/** Feeds user messages into a streaming-input query; lets the manager talk to a running agent. */
class InputQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private waiters: ((r: IteratorResult<SDKUserMessage>) => void)[] = [];
  closed = false;

  push(text: string): boolean {
    if (this.closed) return false;
    const item: SDKUserMessage = { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null };
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: item, done: false });
    else this.items.push(item);
    return true;
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item) return Promise.resolve({ value: item, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

/**
 * Whether the session should keep listening after its turn, for these background tasks (their task types): while a
 * workflow or a background subagent runs, Claude Code keeps the session going and takes its result in a turn of its
 * own when it ends, so a message sent meanwhile should reach it then and there. A background shell or monitor can run
 * for as long as it likes (a dev server), so it doesn't.
 */
export function holdsInput(background: string[]): boolean {
  return background.some((type) => type === 'local_workflow' || type === 'local_agent');
}

/**
 * In "ask" mode these never make an agent raise its hand. Not a sandbox: it only cuts down on interruptions.
 * Plain tools are approved in canUseTool (bare names in allowedTools would bypass the callback entirely);
 * shell commands are matched by Claude Code's own Bash(prefix:*) rules.
 */
const ASK_MODE_TOOLS = new Set(['Read', 'Glob', 'Grep', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'TodoWrite', 'Task', 'Agent', 'WebSearch', 'WebFetch']);
const ASK_MODE_COMMANDS = [
  ...['status', 'diff', 'add', 'commit', 'log', 'show', 'checkout', 'switch', 'restore', 'stash', 'branch', 'mv', 'rm', 'grep', 'blame']
    .map((sub) => `Bash(git ${sub}:*)`),
  ...['npm', 'npx', 'pnpm', 'yarn', 'bun', 'node', 'deno', 'tsc', 'vite', 'vitest', 'jest', 'eslint', 'prettier',
    'python', 'python3', 'pip', 'pytest', 'uv', 'poetry', 'ruff', 'cargo', 'go', 'dotnet', 'make', 'mvn', 'gradle', './gradlew',
    'ls', 'cat', 'head', 'tail', 'wc', 'find', 'grep', 'rg', 'mkdir', 'touch', 'echo', 'pwd', 'which', 'sort', 'diff', 'curl', 'sleep', 'lsof']
    .map((cmd) => `Bash(${cmd}:*)`),
];

function summarizeInput(toolName: string, input: Record<string, unknown>): string {
  if (toolName === 'Bash') return `Bash(${truncate(String(input.command ?? ''), 300)})`;
  const first = input.file_path ?? input.url ?? input.pattern ?? Object.values(input)[0];
  return `${toolName}(${truncate(typeof first === 'string' ? first : JSON.stringify(first ?? ''), 300)})`;
}

/**
 * The environment every Claude Code session gets. Agents run on your Claude login, not on an API key that happens to
 * be in the environment, unless the office says the key's in use (`keyFallback`): always, or while your plan's usage
 * limit is reached.
 */
export function agentEnv(onKey = keyFallback.onKey()): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'focus/0.1.0' };
  if (!onKey) delete env.ANTHROPIC_API_KEY;
  return env;
}

/**
 * The settings files and CLAUDE.md files a session loads. Without your own CLAUDE.md, only it and your rules are
 * excluded, so your ~/.claude/settings.json (permissions, env, plugins) still applies; anything they import goes too.
 */
export function claudeConfig(userClaudeMd: boolean, configDir: string): Pick<Options, 'settingSources' | 'settings'> {
  const settingSources: Options['settingSources'] = ['user', 'project', 'local'];
  if (userClaudeMd) return { settingSources };
  return { settingSources, settings: { claudeMdExcludes: [join(configDir, 'CLAUDE.md'), join(configDir, 'rules', '**')] } };
}

/** What one run remembers between messages: tool calls waiting for their results, and the page last pointed at. */
interface RunContext {
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
  /** Subagents (by Agent tool call) whose model we've reported. */
  modelled: Set<string>;
  /** Signed in with your API key rather than your login. */
  onKey: boolean;
  /** The API requests already counted against the key's budget: Claude Code sends each one's usage with every block of it. */
  counted: Set<string>;
  /** The kinds of background task the session has running now (not the ambient ones), as Claude Code last listed them. */
  background?: string[];
  /** The session's last turn has ended with nothing of ours queued: the input closes once no workflow holds it open. */
  turnOver?: boolean;
  /** Your plan's usage limit stopped the session, to carry on with the key (sessions.ts decides when). */
  limited?: boolean;
}

/** How full the session's context window is, from Claude Code's own count (its last response's usage, no extra calls). */
async function reportContext(q: Query, hooks: RunHooks): Promise<void> {
  try {
    const usage = await Promise.race([q.getContextUsage({ detail: 'summary' }), sleep(3000).then(() => null)]);
    if (usage) hooks.context?.({ percent: Math.round(usage.percentage), tokens: usage.totalTokens, max: usage.rawMaxTokens });
  } catch {
    // an older CLI, or a session already winding down: the meter keeps its last reading
  }
}

/**
 * Runs agents with the Claude Agent SDK, i.e. real Claude Code instances using your local Claude login. A cloud agent
 * runs through the bundled CLI's headless `--cloud` mode: the CLI starts (or reattaches to) a Claude Code cloud session
 * and relays it in the same message stream, so it renders like a local one.
 */
export class ClaudeRunner implements AgentRunner {
  constructor(private readonly browsers: BrowserPool) {}

  /**
   * A terminal running `claude --cloud`: Claude Code starts a new cloud session only from a terminal. On macOS and
   * Linux `script` records what it shows, where the session's id turns up; on Windows the captain pastes the link.
   */
  async cloudTerminal(req: CloudTerminalRequest): Promise<CloudTerminal> {
    const dir = join(paths.cloudTerminals, req.agentId);
    const log = process.platform === 'win32' ? undefined : join(dir, 'terminal.log');
    await openTerminal(dir, { cwd: req.cwd, claude: bundledClaude(), description: req.description, agentName: req.agentName, log });
    return { read: () => (log ? readTerminal(log) : Promise.resolve(undefined)) };
  }

  start(req: RunRequest, hooks: RunHooks): AgentSession {
    const input = new InputQueue();
    const abort = new AbortController();
    const cloud = req.cloud;
    // A new cloud session gets its instructions in the first message: which local options reach it is up to the CLI.
    input.push(cloud && !req.resumeSessionId ? `${req.systemAppend}\n\n---\n\n${req.prompt}` : req.prompt);

    const autonomy = req.settings.autonomy;
    // a cloud agent has to push its own branch, and only that one
    const askCommands = cloud ? [...ASK_MODE_COMMANDS, `Bash(git push origin HEAD:${cloud.branch})`] : ASK_MODE_COMMANDS;
    const permits = new WorkflowPermits();
    const canUseTool: CanUseTool = async (toolName, toolInput, { signal, title, agentID, toolUseID }) => {
      if (autonomy === 'ask' && (ASK_MODE_TOOLS.has(toolName) || toolName.startsWith('mcp__browser__'))) {
        return { behavior: 'allow', updatedInput: toolInput };
      }
      // an agent of a workflow the captain approved: its progress may not have named it yet, so give it a moment
      for (let i = 0; i < 10 && permits.mightApprove(agentID); i++) await sleep(200);
      if (permits.approves(agentID)) return { behavior: 'allow', updatedInput: toolInput };
      const summary = toolName === 'Workflow' ? workflowAsk(toolInput) : title || summarizeInput(toolName, toolInput);
      const approved = await hooks.permission(toolName, summary, signal);
      if (approved && toolName === 'Workflow') permits.approveCall(toolUseID);
      return approved
        ? { behavior: 'allow', updatedInput: toolInput }
        : {
            behavior: 'deny',
            message: 'The manager declined this action. Find another approach, or explain in your final summary why it is needed.',
          };
    };

    // a cloud session runs on your plan in the cloud, whatever this machine signs in with
    const onKey = !cloud && keyFallback.onKey();
    // a local session's scratch dir for throwaway files, deleted when the run ends; a cloud session has its own machine
    const scratch = cloud ? undefined : openScratch(req.agentId, paths.dcgConfig);
    const env = { ...agentEnv(onKey), ...scratch?.env };
    const resets = keyFallback.resetsAt();
    if (onKey && resets) hooks.lines([{ kind: 'system', text: `✻ On your API key: your plan's usage limit is reached until ${clock(resets)}` }]);

    const stderrTail: string[] = [];
    const options: Options = {
      cwd: req.cwd,
      abortController: abort,
      model: req.model || req.settings.model || undefined,
      effort: req.effort,
      ...claudeConfig(req.settings.userClaudeMd, process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')),
      disallowedTools: ['AskUserQuestion', 'EnterPlanMode'],
      ...(cloud
        ? // the cloud VM has its own browser; ours runs on this machine. `--cloud <id>` reattaches to the session.
          { systemPrompt: { type: 'preset', preset: 'claude_code' }, extraArgs: { cloud: req.resumeSessionId ?? null } }
        : {
            // recorded on the first request and reused on every resume (the SDK's default, spelled out): instructions
            // that change mid-session would be ignored, so whatever changes goes in messages instead
            systemPrompt: { type: 'preset', preset: 'claude_code', append: req.systemAppend, snapshot: true },
            mcpServers: { browser: browserMcpServer(this.browsers, req.agentId, hooks), ...(req.tools && { office: officeMcpServer(req.tools) }) },
            resume: req.resumeSessionId,
            ...(scratch && { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [scratch.hook] }] } }),
          }),
      outputFormat: req.outputSchema ? { type: 'json_schema', schema: req.outputSchema } : undefined,
      // the lead's helpers sit round their team station: a line every ~30s on what each is doing, for their speech bubbles
      agentProgressSummaries: !!req.tools,
      env,
      stderr: (data) => {
        stderrTail.push(data);
        if (stderrTail.length > 20) stderrTail.shift();
      },
      ...(autonomy === 'full'
        ? { permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true }
        : autonomy === 'auto'
          ? { permissionMode: 'auto', canUseTool }
          : { permissionMode: 'acceptEdits', allowedTools: askCommands, canUseTool }),
    };

    let q: Query | undefined;
    let stopping = false;
    const ctx: RunContext = { cwd: req.cwd, cloud: !!cloud, calls: new Map(), helpers: new Map(), workflows: new Set(), permits, modelled: new Set(), onKey, counted: new Set() };
    const done = (async (): Promise<RunOutcome> => {
      let summary = '';
      let structured: unknown;
      let ok = false;
      let error: string | undefined;
      let started = false;
      try {
        q = query({ prompt: input, options });
        for await (const msg of q) {
          if (msg.type === 'system' && msg.subtype === 'init') started = true;
          const result = this.handle(msg, ctx, hooks);
          // a workflow or background subagent still running keeps listening, so a message from the captain reaches
          // the session now rather than after it's done; otherwise the session's done once its turn is
          if (!result && ctx.turnOver && !holdsInput(ctx.background ?? [])) input.close();
          if (ctx.limited && !abort.signal.aborted) {
            abort.abort();
            input.close();
          }
          if (result) {
            ok = !result.isError;
            summary = result.text;
            structured = result.structured ?? structured;
            error = result.isError ? result.text : undefined;
            // how full the context is now, asked while the session's still there to answer
            if (!cloud) await reportContext(q, hooks);
            // Messages sent mid-turn are folded into that turn, so don't count results per message: finish once the
            // CLI has nothing queued. Anything still in our queue is delivered before the input reports it is done.
            ctx.turnOver = !result.queued;
            if (ctx.turnOver && !holdsInput(ctx.background ?? [])) input.close();
          }
        }
        if (stopping) return { ok: false, summary, error: STOPPED_BY_CAPTAIN, aborted: true, started };
        if (ctx.limited) return { ok: false, summary, error: LIMIT_REACHED, limited: true, started };
        return { ok, summary, structured, error, started };
      } catch (err) {
        if (ctx.limited && !stopping) return { ok: false, summary, error: LIMIT_REACHED, limited: true, started };
        if (stopping || abort.signal.aborted) return { ok: false, summary, error: STOPPED_BY_CAPTAIN, aborted: true, started };
        if (cloud && cloudRefused(`${errorMessage(err)}\n${stderrTail.join('')}`)) return { ok: false, summary, error: CLOUD_UNAVAILABLE, started };
        const detail = stderrTail.join('').trim().split('\n').slice(-3).join(' ');
        return { ok: false, summary, error: `${errorMessage(err)}${detail ? ` — ${truncate(detail, 300)}` : ''}`, started };
      } finally {
        input.close();
        scratch?.close();
        await this.browsers.close(req.agentId);
      }
    })();

    const kill = () => {
      abort.abort();
      input.close();
    };
    return {
      send: (text) => input.push(text),
      // a cloud session's settings live in the cloud: its new effort applies from its next turn
      setEffort: (effort) => {
        if (!cloud) void q?.applyFlagSettings({ effortLevel: effort }).catch(() => undefined);
      },
      stop: () => {
        stopping = true;
        // Killing the local client alone would leave a cloud session working: interrupt its turn first.
        if (cloud && q) void Promise.race([q.interrupt(), sleep(5000)]).catch(() => undefined).finally(kill);
        else kill();
      },
      done,
    };
  }

  /** Renders one SDK message; returns the outcome when it is a turn result. */
  private handle(msg: SDKMessage, ctx: RunContext, hooks: RunHooks): { text: string; isError: boolean; queued: number; structured?: unknown } | null {
    const { cwd } = ctx;
    // a subagent's lines: a transcript of its own, or else indented in the session's (in `kind`, when it says)
    const helperLines = (id: string, lines: Omit<TermLine, 't'>[], kind?: TermKind) =>
      hooks.helperLines ? hooks.helperLines(id, lines) : hooks.lines(lines.map((l) => ({ ...l, kind: kind ?? l.kind, text: `    ${l.text}` })));
    switch (msg.type) {
      case 'system': {
        // Relayed from a cloud session, init (and later cloud_session_delta) carry the cloud session's own id: the one
        // `--cloud <id>` reattaches with. The worker's session_id beside it doesn't reattach.
        const cloudId = (msg as { cloud_session?: { id?: unknown } }).cloud_session?.id;
        if (ctx.cloud && typeof cloudId === 'string' && cloudId !== ctx.cloudId) {
          ctx.cloudId = cloudId;
          hooks.session(cloudId);
          const url = cloudSessionUrl({ cloud: true, sessionId: cloudId });
          if (url) hooks.lines([{ kind: 'system', text: `☁ Cloud session: ${url}` }]);
        }
        if (msg.subtype === 'init') {
          if (!ctx.cloud) hooks.session(msg.session_id);
          hooks.lines([{ kind: 'system', text: `✻ Claude Code ${msg.claude_code_version} · ${msg.model} · ${msg.permissionMode}${ctx.cloud ? ' · ☁ cloud' : ''}` }]);
        } else if ((msg as { subtype: string }).subtype === 'cloud_session_status') {
          // the CLI's own notes on the cloud session (starting up, where to watch it)
          const content = (msg as { content?: unknown }).content;
          if (typeof content === 'string' && content.trim()) hooks.lines([{ kind: 'system', text: `☁ ${truncate(content.trim(), 300)}` }]);
        } else if (msg.subtype === 'api_retry') {
          hooks.lines([{ kind: 'error', text: `  ⚠ API ${msg.error} – retrying (attempt ${msg.attempt}/${msg.max_retries})` }]);
          hooks.activity(null, `Waiting on the API (${msg.error})`);
        } else if ((msg as { subtype: string }).subtype === 'background_tasks_changed') {
          const tasks = (msg as { tasks?: { task_type?: string; ambient?: boolean }[] }).tasks ?? [];
          ctx.background = tasks.filter((t) => !t.ambient).map((t) => t.task_type ?? '');
        } else if (msg.subtype === 'compact_boundary') {
          hooks.lines([{ kind: 'system', text: '✻ Conversation compacted' }]);
        } else if (msg.subtype === 'task_started' && msg.task_type === 'local_agent') {
          // a subagent: known by the Agent tool call that started it, which its own messages point back to
          const id = msg.tool_use_id ?? msg.task_id;
          ctx.helpers.set(msg.task_id, id);
          hooks.helper?.({ kind: 'started', id, description: msg.description, type: msg.subagent_type });
          // their transcript starts with what they were asked
          const prompt = msg.tool_use_id ? ctx.calls.get(msg.tool_use_id)?.input.prompt : undefined;
          hooks.helperLines?.(id, [{ kind: 'system', text: `✻ ${msg.description}` }, ...(typeof prompt === 'string' && prompt.trim() ? [{ kind: 'manager' as const, text: `▶ ${prompt.trim()}` }] : [])]);
        } else if (msg.subtype === 'task_started' && msg.task_type === 'local_workflow') {
          // a workflow: its agents report nothing of their own, only how the whole of it stands in its progress
          ctx.workflows.add(msg.task_id);
          ctx.permits?.started(msg.task_id, msg.tool_use_id);
          hooks.workflow?.({ kind: 'started', id: msg.task_id, name: msg.workflow_name ?? '', description: msg.description });
        } else if (msg.subtype === 'task_progress' && ctx.workflows.has(msg.task_id)) {
          const progress = workflowProgress((msg as { workflow_progress?: unknown }).workflow_progress);
          if (progress) {
            ctx.permits?.seen(msg.task_id, progress.agents);
            hooks.workflow?.({ kind: 'progress', id: msg.task_id, ...progress });
          }
        } else if (msg.subtype === 'task_notification' && ctx.workflows.has(msg.task_id)) {
          hooks.workflow?.({ kind: 'ended', id: msg.task_id, ok: msg.status === 'completed' });
          ctx.permits?.ended(msg.task_id);
          ctx.workflows.delete(msg.task_id);
        } else if (msg.subtype === 'task_progress') {
          const id = ctx.helpers.get(msg.task_id);
          const activity = msg.summary ?? (msg.last_tool_name ? `Using ${msg.last_tool_name}` : '');
          if (id && activity) hooks.helper?.({ kind: 'activity', id, activity: truncate(activity, 100) });
        } else if (msg.subtype === 'task_notification') {
          const id = ctx.helpers.get(msg.task_id);
          if (id) {
            hooks.helper?.({ kind: 'ended', id, ok: msg.status === 'completed', summary: truncate(msg.summary, 100) });
            hooks.helperLines?.(id, [msg.status === 'completed' ? { kind: 'success', text: '✔ Done' } : { kind: 'error', text: `✘ ${msg.status}` }]);
          }
          ctx.helpers.delete(msg.task_id);
        }
        return null;
      }

      case 'assistant': {
        // what the key spends, against its budget for while your plan's limit is reached
        if (ctx.onKey && !ctx.counted.has(msg.message.id)) {
          ctx.counted.add(msg.message.id);
          keyFallback.spent(requestUsd(msg.message.usage, msg.message.model));
        }
        if (msg.error) {
          hooks.lines([{ kind: 'error', text: `⚠ ${msg.error}` }]);
        }
        const nested = msg.parent_tool_use_id !== null;
        // a subagent's model is only in its own messages
        if (nested && msg.message.model && !ctx.modelled.has(msg.parent_tool_use_id!)) {
          ctx.modelled.add(msg.parent_tool_use_id!);
          hooks.helper?.({ kind: 'model', id: msg.parent_tool_use_id!, model: msg.message.model });
          hooks.helperLines?.(msg.parent_tool_use_id!, [{ kind: 'system', text: `✻ ${msg.message.model}` }]);
        }
        for (const block of msg.message.content) {
          if (block.type === 'text' && block.text.trim()) {
            const lines = renderText(block.text.trim());
            if (nested) helperLines(msg.parent_tool_use_id!, lines, 'output');
            else {
              hooks.lines(lines);
              hooks.activity(null, truncate(block.text.trim().split('\n')[0], 80));
            }
          } else if (block.type === 'thinking') {
            if (nested) helperLines(msg.parent_tool_use_id!, [{ kind: 'thinking', text: '✻ Thinking…' }]);
            else hooks.lines([{ kind: 'thinking', text: '✻ Thinking…' }]);
            hooks.activity(null, 'Thinking…');
          } else if (block.type === 'tool_use') {
            const call: ToolCall = { name: block.name, input: (block.input ?? {}) as Record<string, unknown> };
            ctx.calls.set(block.id, call);
            ctx.lastUrl = appUrl(call) ?? ctx.lastUrl;
            const rendered = renderToolUse(call.name, call.input, cwd);
            if (nested) helperLines(msg.parent_tool_use_id!, rendered.lines);
            else hooks.lines(rendered.lines);
            if (rendered.activity || rendered.status) hooks.activity(rendered.status ?? null, rendered.activity ?? '');
            // a subagent's tool call is what that helper is busy with
            if (nested && rendered.activity) hooks.helper?.({ kind: 'activity', id: msg.parent_tool_use_id!, activity: rendered.activity });
          }
        }
        return null;
      }

      case 'user': {
        const content = msg.message.content;
        if (!Array.isArray(content)) return null;
        const results = content.filter((b) => b.type === 'tool_result');
        // a workflow launched: where its agents' transcripts are written
        const launched = msg.tool_use_result as { taskId?: unknown; transcriptDir?: unknown } | undefined;
        if (launched && typeof launched.taskId === 'string' && typeof launched.transcriptDir === 'string') {
          hooks.workflow?.({ kind: 'transcripts', id: launched.taskId, dir: launched.transcriptDir });
        }
        for (const block of content) {
          if (block.type !== 'tool_result') continue;
          const call = ctx.calls.get(block.tool_use_id);
          ctx.calls.delete(block.tool_use_id);
          // a subagent's results only go in a transcript of its own: indented in the session's, they'd drown it
          if (msg.parent_tool_use_id === null) hooks.lines(renderToolResult(block as unknown as { type: string }));
          else hooks.helperLines?.(msg.parent_tool_use_id, renderToolResult(block as unknown as { type: string }));
          // the agent's own task list (a subagent's is its own business); the structured output is the message's only
          // when it carries this one result
          if (call && TASK_TOOLS.has(call.name) && msg.parent_tool_use_id === null) {
            const said = typeof block.content === 'string' ? block.content : (block.content ?? []).map((c) => (c.type === 'text' ? c.text : '')).join('\n');
            hooks.taskTool?.(call.name, call.input, results.length === 1 ? msg.tool_use_result : undefined, said);
          }
          // an image the agent (or a subagent) looked at goes on its laptop screen, like our browser tool's frames
          const frame = screenshotFrame(block as unknown as { type: string }, call, ctx.lastUrl, Date.now());
          if (frame) {
            hooks.browser(frame);
            const page = /^https?:\/\//.test(frame.url);
            hooks.activity(page ? 'testing' : null, `${page ? 'Checking a screenshot of' : 'Looking at'} ${truncate(frame.url, 60)}`);
          }
        }
        return null;
      }

      case 'rate_limit_event': {
        const until = limitReached(msg.rate_limit_info, Date.now());
        if (until === null) return null;
        keyFallback.limitHit(until);
        // a session on your plan stops here, and picks its conversation back up with your API key
        if (!ctx.onKey && !ctx.cloud && keyFallback.onKey()) {
          ctx.limited = true;
          hooks.lines([{ kind: 'error', text: `⚠ Your plan's usage limit is reached until ${clock(until)} – switching to your API key` }]);
          hooks.activity(null, 'Switching to your API key');
          return null;
        }
        hooks.lines([{ kind: 'error', text: `⚠ Your plan's usage limit is reached – waiting for it to reset at ${clock(until)}` }]);
        hooks.activity(null, 'Rate limited – waiting');
        return null;
      }

      case 'result': {
        hooks.cost(msg.total_cost_usd);
        if (msg.subtype === 'success') {
          hooks.lines([{ kind: 'success', text: `✔ Done in ${Math.round(msg.duration_ms / 1000)}s · ${msg.num_turns} turns` }]);
          return { text: msg.result, isError: msg.is_error, queued: msg.queued_turn_count ?? 0, structured: msg.structured_output };
        }
        const text = msg.errors?.join('\n') || msg.subtype;
        hooks.lines([{ kind: 'error', text: `✘ ${msg.subtype}: ${truncate(text, 300)}` }]);
        return { text, isError: true, queued: msg.queued_turn_count ?? 0 };
      }

      default:
        return null;
    }
  }
}
