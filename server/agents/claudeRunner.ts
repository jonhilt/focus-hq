import { query, type CanUseTool, type Options, type Query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { cloudSessionUrl } from '../../shared/cloud';
import { errorMessage, sleep, truncate } from '../util';
import { BrowserPool, browserMcpServer } from './browserTool';
import { appUrl, renderText, renderToolResult, renderToolUse, screenshotFrame, type ToolCall } from './render';
import { type AgentRunner, type AgentSession, type RunHooks, type RunOutcome, type RunRequest, STOPPED_BY_CAPTAIN } from './types';

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

/** The environment every Claude Code session gets. */
export function agentEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'focus/0.1.0' };
  if (process.env.FOCUS_USE_API_KEY !== '1') {
    // Agents run on your Claude subscription login, not on an API key that happens to be in the environment.
    delete env.ANTHROPIC_API_KEY;
  }
  return env;
}

/** What one run remembers between messages: tool calls waiting for their results, and the page last pointed at. */
interface RunContext {
  cwd: string;
  cloud: boolean;
  calls: Map<string, ToolCall>;
  lastUrl?: string;
  /** The cloud session's id, once the CLI has reported it. */
  cloudId?: string;
}

/**
 * Runs agents with the Claude Agent SDK, i.e. real Claude Code instances using your local Claude login. A cloud agent
 * runs through the bundled CLI's headless `--cloud` mode: the CLI starts (or reattaches to) a Claude Code cloud session
 * and relays it in the same message stream, so it renders like a local one.
 */
export class ClaudeRunner implements AgentRunner {
  constructor(private readonly browsers: BrowserPool) {}

  start(req: RunRequest, hooks: RunHooks): AgentSession {
    const input = new InputQueue();
    const abort = new AbortController();
    const cloud = req.cloud;
    // A new cloud session gets its instructions in the first message: which local options reach it is up to the CLI.
    input.push(cloud && !req.resumeSessionId ? `${req.systemAppend}\n\n---\n\n${req.prompt}` : req.prompt);

    const autonomy = req.settings.autonomy;
    // a cloud agent has to push its own branch, and only that one
    const askCommands = cloud ? [...ASK_MODE_COMMANDS, `Bash(git push origin HEAD:${cloud.branch})`] : ASK_MODE_COMMANDS;
    const canUseTool: CanUseTool = async (toolName, toolInput, { signal, title }) => {
      if (autonomy === 'ask' && (ASK_MODE_TOOLS.has(toolName) || toolName.startsWith('mcp__browser__'))) {
        return { behavior: 'allow', updatedInput: toolInput };
      }
      const summary = title || summarizeInput(toolName, toolInput);
      const approved = await hooks.permission(toolName, summary, signal);
      return approved
        ? { behavior: 'allow', updatedInput: toolInput }
        : {
            behavior: 'deny',
            message: 'The manager declined this action. Find another approach, or explain in your final summary why it is needed.',
          };
    };

    const env = agentEnv();

    const stderrTail: string[] = [];
    const options: Options = {
      cwd: req.cwd,
      abortController: abort,
      model: req.settings.model || undefined,
      effort: req.effort,
      settingSources: ['user', 'project', 'local'],
      disallowedTools: ['AskUserQuestion', 'EnterPlanMode'],
      ...(cloud
        ? // the cloud VM has its own browser; ours runs on this machine. `--cloud <id>` reattaches to the session.
          { systemPrompt: { type: 'preset', preset: 'claude_code' }, extraArgs: { cloud: req.resumeSessionId ?? null } }
        : {
            systemPrompt: { type: 'preset', preset: 'claude_code', append: req.systemAppend },
            mcpServers: { browser: browserMcpServer(this.browsers, req.agentId, hooks) },
            resume: req.resumeSessionId,
          }),
      outputFormat: req.outputSchema ? { type: 'json_schema', schema: req.outputSchema } : undefined,
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
    const ctx: RunContext = { cwd: req.cwd, cloud: !!cloud, calls: new Map() };
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
          if (result) {
            ok = !result.isError;
            summary = result.text;
            structured = result.structured ?? structured;
            error = result.isError ? result.text : undefined;
            // Messages sent mid-turn are folded into that turn, so don't count results per message: finish once the
            // CLI has nothing queued. Anything still in our queue is delivered before the input reports it is done.
            if (!result.queued) input.close();
          }
        }
        if (stopping) return { ok: false, summary, error: STOPPED_BY_CAPTAIN, aborted: true, started };
        return { ok, summary, structured, error, started };
      } catch (err) {
        if (stopping || abort.signal.aborted) return { ok: false, summary, error: STOPPED_BY_CAPTAIN, aborted: true, started };
        const detail = stderrTail.join('').trim().split('\n').slice(-3).join(' ');
        return { ok: false, summary, error: `${errorMessage(err)}${detail ? ` — ${truncate(detail, 300)}` : ''}`, started };
      } finally {
        input.close();
        await this.browsers.close(req.agentId);
      }
    })();

    const kill = () => {
      abort.abort();
      input.close();
    };
    return {
      send: (text) => input.push(text),
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
        } else if (msg.subtype === 'compact_boundary') {
          hooks.lines([{ kind: 'system', text: '✻ Conversation compacted' }]);
        }
        return null;
      }

      case 'assistant': {
        if (msg.error) {
          hooks.lines([{ kind: 'error', text: `⚠ ${msg.error}` }]);
        }
        const nested = msg.parent_tool_use_id !== null;
        for (const block of msg.message.content) {
          if (block.type === 'text' && block.text.trim()) {
            const lines = renderText(block.text.trim());
            hooks.lines(nested ? lines.map((l) => ({ ...l, kind: 'output', text: `    ${l.text}` })) : lines);
            if (!nested) hooks.activity(null, truncate(block.text.trim().split('\n')[0], 80));
          } else if (block.type === 'thinking') {
            hooks.lines([{ kind: 'thinking', text: '✻ Thinking…' }]);
            hooks.activity(null, 'Thinking…');
          } else if (block.type === 'tool_use') {
            const call: ToolCall = { name: block.name, input: (block.input ?? {}) as Record<string, unknown> };
            ctx.calls.set(block.id, call);
            ctx.lastUrl = appUrl(call) ?? ctx.lastUrl;
            const rendered = renderToolUse(call.name, call.input, cwd);
            hooks.lines(nested ? rendered.lines.map((l) => ({ ...l, text: `    ${l.text}` })) : rendered.lines);
            if (rendered.activity || rendered.status) hooks.activity(rendered.status ?? null, rendered.activity ?? '');
          }
        }
        return null;
      }

      case 'user': {
        const content = msg.message.content;
        if (!Array.isArray(content)) return null;
        for (const block of content) {
          if (block.type !== 'tool_result') continue;
          const call = ctx.calls.get(block.tool_use_id);
          ctx.calls.delete(block.tool_use_id);
          if (msg.parent_tool_use_id === null) hooks.lines(renderToolResult(block as unknown as { type: string }));
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

      case 'rate_limit_event':
        if (msg.rate_limit_info.status === 'rejected') {
          hooks.lines([{ kind: 'error', text: '⚠ Subscription rate limit reached – waiting for it to reset' }]);
          hooks.activity(null, 'Rate limited – waiting');
        }
        return null;

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
