import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSdkMcpServer, type McpSdkServerConfigWithInstance, type Options, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { Settings } from '../../shared/types';
import { paths } from '../config';
import { errorMessage, truncate } from '../util';
import { agentEnv } from './claudeRunner';
import { type Drafter, type DraftRequest, type DraftResult, draftSchema, plannerPrompt, plannerSystemPrompt, repoFolders } from './planner';
import { asNumberOneReply, type ChatProject, type NumberOneOfficer, type NumberOneReply, type NumberOneTurn, numberOnePrompt, numberOneReplySchema, numberOneSystemPrompt } from './numberOne';
import { renderToolUse } from './render';
import { parseTriage, TRIAGE_SCHEMA, type TriageDecision, type Triager, type TriageRequest, triagePrompt, triageSystemPrompt } from './triage';
import { checkoutLatest } from './workspace';
import type { RetroOfficer, RetroRequest } from './engineer';
import { DRAFTS_SCHEMA, engineerPrompt, engineerSystemPrompt } from './retro';
import { READ_SCHEMA, readerSystemPrompt } from './frictions';
import { chiefEngineer } from '../../shared/crew';

// The permanent crew's Claude Code sessions: they read the project's code (and, for Number One, the web) and change
// nothing. Read-only because they only have Read, Glob and Grep, plus WebSearch and WebFetch for Number One and the
// office's own tools, `dontAsk` denies anything not pre-approved, and none of your settings, hooks or MCP servers load.

/** The built-in tools a crew session may be given: none of them can change anything. */
type ReadOnlyTool = 'Read' | 'Glob' | 'Grep' | 'WebSearch' | 'WebFetch';
const CODE_TOOLS: ReadOnlyTool[] = ['Read', 'Glob', 'Grep'];
const WEB_TOOLS: ReadOnlyTool[] = ['WebSearch', 'WebFetch'];
const TURN_TIMEOUT_MS = 8 * 60_000;

/** planning/<project>/<repo>: one folder per repo under the session's cwd, so Glob and Grep reach all of them. */
const planningDir = (projectId: string) => path.join(paths.planning, projectId);

async function checkouts(projectId: string, repos: string[], activity: (text: string) => void): Promise<string> {
  const cwd = planningDir(projectId);
  const folders = repoFolders(repos);
  activity(`Pulling the latest ${repos.length === 1 ? 'code' : `code of ${repos.length} repos`}`);
  await Promise.all(repos.map((repo) => checkoutLatest(repo, path.join(cwd, folders.get(repo)!))));
  return cwd;
}

interface ReadOnlyRun {
  cwd: string;
  systemAppend: string;
  prompt: string;
  settings: Settings;
  signal: AbortSignal;
  activity: (text: string) => void;
  /** Built-in tools, all pre-approved. */
  builtins: ReadOnlyTool[];
  resume?: string;
  schema?: Record<string, unknown>;
  /** The office's own tools for this session, all pre-approved, and what the activity line says while one runs. */
  tools?: { server: McpSdkServerConfigWithInstance; names: string[]; activity: (name: string) => string };
  /** Folders outside `cwd` the session may read too. */
  readable?: string[];
  /** For sessions that read a lot (a retro): more turns, and longer, than a quick look. */
  maxTurns?: number;
  /** A model of its own (Haiku, for a cheap extraction), and a system prompt of its own in place of Claude Code's. */
  model?: string;
  system?: string;
  timeoutMs?: number;
}

interface ReadOnlyResult {
  text: string;
  structured: unknown;
  sessionId?: string;
  costUsd?: number;
}

/** One turn of a read-only session, reporting what it's doing as it goes. */
async function runReadOnly(run: ReadOnlyRun): Promise<ReadOnlyResult> {
  const abort = new AbortController();
  const onAbort = () => abort.abort();
  run.signal.addEventListener('abort', onAbort);
  const timeoutMs = run.timeoutMs ?? TURN_TIMEOUT_MS;
  const timer = setTimeout(onAbort, timeoutMs);
  const prefix = run.tools ? `mcp__${run.tools.server.name}__` : undefined;
  const extra = run.tools ? run.tools.names.map((n) => `${prefix}${n}`) : [];
  const options: Options = {
    cwd: run.cwd,
    additionalDirectories: run.readable,
    abortController: abort,
    model: run.model ?? (run.settings.model || undefined),
    systemPrompt: run.system ?? { type: 'preset', preset: 'claude_code', append: run.systemAppend },
    tools: run.builtins,
    allowedTools: [...run.builtins, ...extra],
    permissionMode: 'dontAsk',
    settingSources: [],
    mcpServers: run.tools ? { [run.tools.server.name]: run.tools.server } : {},
    strictMcpConfig: true,
    outputFormat: run.schema ? { type: 'json_schema', schema: run.schema } : undefined,
    maxTurns: run.maxTurns ?? 40,
    resume: run.resume,
    env: agentEnv(),
  };

  let sessionId = run.resume;
  try {
    for await (const msg of query({ prompt: run.prompt, options })) {
      if (msg.type === 'system' && msg.subtype === 'init') sessionId = msg.session_id;
      else if (msg.type === 'assistant' && msg.parent_tool_use_id === null) {
        for (const block of msg.message.content) {
          if (block.type === 'tool_use') {
            if (prefix && block.name.startsWith(prefix)) run.activity(run.tools!.activity(block.name.slice(prefix.length)));
            else run.activity(renderToolUse(block.name, (block.input ?? {}) as Record<string, unknown>, run.cwd).activity ?? '');
          } else if (block.type === 'thinking') run.activity('Thinking…');
          else if (block.type === 'text' && block.text.trim()) run.activity(truncate(block.text.trim().split('\n')[0], 100));
        }
      } else if (msg.type === 'result') {
        if (msg.subtype !== 'success' || msg.is_error) throw new Error(msg.subtype === 'success' ? msg.result : (msg.errors?.join('\n') || msg.subtype));
        return { text: msg.result, structured: msg.structured_output, sessionId, costUsd: msg.total_cost_usd };
      }
    }
    throw new Error('The session stopped without a result');
  } catch (err) {
    if (run.signal.aborted) throw new Error('Stopped', { cause: err });
    if (abort.signal.aborted) throw new Error(`Gave up after ${timeoutMs / 60_000} minutes`, { cause: err });
    throw new Error(errorMessage(err), { cause: err });
  } finally {
    clearTimeout(timer);
    run.signal.removeEventListener('abort', onAbort);
  }
}

function asDraft(out: unknown, repos: string[]): DraftResult {
  const d = (out ?? {}) as Partial<DraftResult>;
  if (!d.title || !d.body) throw new Error('Finished without writing the issue');
  return { repo: String(d.repo ?? repos[0]), title: String(d.title), body: String(d.body), tooBig: d.tooBig ? String(d.tooBig) : undefined };
}

/** The planner at a room's stand: one idea in, one issue draft out. */
export class ClaudeDrafter implements Drafter {
  forget(projectId: string): void {
    // the mirrors' `git worktree prune` drops the registrations next time
    fs.rmSync(planningDir(projectId), { recursive: true, force: true });
  }

  async draft(req: DraftRequest, activity: (text: string) => void): Promise<DraftResult> {
    const cwd = await checkouts(req.projectId, req.repos, activity);
    if (req.signal.aborted) throw new Error('Discarded');
    const result = await runReadOnly({
      cwd,
      systemAppend: plannerSystemPrompt(req),
      prompt: plannerPrompt(req),
      settings: req.settings,
      signal: req.signal,
      activity,
      builtins: CODE_TOOLS,
      resume: req.resumeSessionId,
      schema: draftSchema(req.repos),
    }).catch((err: Error) => {
      throw req.signal.aborted ? new Error('Discarded') : err;
    });
    return { ...asDraft(result.structured, req.repos), sessionId: result.sessionId, costUsd: result.costUsd };
  }
}

/** The operations officer looking at a stuck PR: reads its checkout and decides one thing to do. */
export class ClaudeTriager implements Triager {
  async triage(req: TriageRequest, activity: (text: string) => void): Promise<TriageDecision & { costUsd?: number }> {
    const result = await runReadOnly({
      cwd: req.cwd,
      systemAppend: triageSystemPrompt(req),
      prompt: triagePrompt(req),
      settings: req.settings,
      signal: req.signal,
      activity,
      builtins: CODE_TOOLS,
      schema: TRIAGE_SCHEMA,
    });
    const decision = parseTriage(result.structured);
    if (!decision) throw new Error('Finished without choosing what to do');
    return { ...decision, costUsd: result.costUsd };
  }
}

/**
 * Number One: one session for the whole ship, from planning/, so every project's checkout is in reach once it's opened.
 * Agents' worktrees are readable too, to see what an agent has done so far.
 */
export class ClaudeNumberOne implements NumberOneOfficer {
  async turn(req: NumberOneTurn, activity: (text: string) => void): Promise<NumberOneReply> {
    fs.mkdirSync(paths.planning, { recursive: true });
    const ids = req.projects.map((p) => p.id);
    const result = await runReadOnly({
      cwd: paths.planning,
      readable: [paths.workspaces],
      systemAppend: numberOneSystemPrompt({ projects: req.projects, workspaces: paths.workspaces }),
      prompt: numberOnePrompt(req),
      settings: req.settings,
      signal: req.signal,
      activity,
      builtins: [...CODE_TOOLS, ...WEB_TOOLS],
      resume: req.resumeSessionId,
      schema: numberOneReplySchema(ids),
      tools: {
        server: numberOneServer(req, activity),
        names: ['ship_status', 'open_project'],
        activity: (name) => (name === 'ship_status' ? 'Checking the ship’s status' : 'Opening a project'),
      },
    });
    return { ...asNumberOneReply(result.structured, result.text, ids), sessionId: result.sessionId, costUsd: result.costUsd };
  }
}

/** Number One's own tools: the ship's state, and a project's code on demand. Neither changes anything aboard. */
function numberOneServer(req: NumberOneTurn, activity: (text: string) => void): McpSdkServerConfigWithInstance {
  const text = (t: string, isError = false) => ({ content: [{ type: 'text' as const, text: t }], ...(isError && { isError }) });
  const project = (id: string): ChatProject | undefined => req.projects.find((p) => p.id === id);
  return createSdkMcpServer({
    name: 'number-one',
    version: '1.0.0',
    alwaysLoad: true,
    tools: [
      tool('ship_status', "The ship right now: per project, its agents (with their worktree paths), open pull requests with QA verdicts and checks, what needs the captain, and its closed goals (newest first) with each PR's state on GitHub right now (stale: true when it couldn't be looked up, so it's only the recorded outcome).", {}, async () =>
        text(JSON.stringify(await req.shipStatus(), null, 1)),
      ),
      tool(
        'open_project',
        "Checks out a project's repositories at their latest default branch, into <projectId>/<repo folder>/ under your current directory, so you can read its code.",
        { projectId: z.string().describe('The project id, as listed in your instructions') },
        async ({ projectId }) => {
          const found = project(projectId);
          if (!found) return text(`There's no project with id ${projectId}. The projects are: ${req.projects.map((p) => `${p.name} (${p.id})`).join(', ') || 'none'}.`, true);
          if (!found.repos.length) return text(`${found.name} has no repositories yet.`, true);
          try {
            const cwd = await checkouts(found.id, found.repos, activity);
            const folders = repoFolders(found.repos);
            return text(`${found.name} is checked out at its default branch:\n${found.repos.map((r) => `- ${path.relative(paths.planning, path.join(cwd, folders.get(r)!))}/ (${r})`).join('\n')}`);
          } catch (err) {
            return text(`The checkout of ${found.name} failed: ${errorMessage(err)}`, true);
          }
        },
      ),
    ],
  });
}

/**
 * The chief engineer on a retro: reads the evidence the office gathered into its own folder (the frictions that keep
 * coming back, the ledger, closed goals) and nothing else, and drafts issues from them.
 */
/** The model that reads sessions for frictions at retro time: it labels the same trouble the same way (see docs/retro.md). */
export const READER_MODEL = 'claude-opus-5-5';

export class ClaudeEngineer implements RetroOfficer {
  /** A batch of sessions' spans for their frictions: no tools, a short system prompt of its own, a structured answer. */
  async read(req: { prompt: string; settings: Settings; signal: AbortSignal }): Promise<{ structured: unknown; costUsd?: number }> {
    const result = await runReadOnly({
      cwd: os.tmpdir(),
      system: readerSystemPrompt(),
      systemAppend: '',
      prompt: req.prompt,
      settings: req.settings,
      signal: req.signal,
      activity: () => undefined,
      builtins: [],
      schema: READ_SCHEMA,
      model: READER_MODEL,
      maxTurns: 6,
      timeoutMs: 10 * 60_000,
    });
    return { structured: result.structured, costUsd: result.costUsd };
  }

  async retro(req: RetroRequest, activity: (text: string) => void): Promise<{ structured: unknown; text: string; costUsd?: number }> {
    const result = await runReadOnly({
      cwd: req.cwd,
      systemAppend: engineerSystemPrompt(chiefEngineer().name),
      prompt: engineerPrompt(req.days, req.groups),
      settings: req.settings,
      signal: req.signal,
      activity,
      builtins: CODE_TOOLS,
      schema: DRAFTS_SCHEMA,
      maxTurns: 60,
      timeoutMs: 15 * 60_000,
    });
    return { structured: result.structured, text: result.text, costUsd: result.costUsd };
  }
}
