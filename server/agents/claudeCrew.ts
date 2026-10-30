import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSdkMcpServer, type McpSdkServerConfigWithInstance, type Options, query, type SDKAssistantMessage, type SDKMessage, type SDKResultMessage, tool } from '@anthropic-ai/claude-agent-sdk';
import { type ZodType, z } from 'zod';
import type { Effort, Settings } from '../../shared/types';
import { paths } from '../config';
import { errorMessage, truncate } from '../util';
import { agentEnv } from './claudeSession';
import { type Drafter, type DraftRequest, type DraftResult, draftSchema, plannerPrompt, plannerSystemPrompt, repoFolders } from './planner';
import type { ChatProject, ShipStatus } from './shipStatus';
import { renderToolUse } from './render';
import { parseTriage, TRIAGE_SCHEMA, type TriageDecision, type Triager, type TriageRequest, triagePrompt, triageSystemPrompt } from './triage';
import { checkoutLatest } from './workspace';
import { crewFile } from './crewFiles';
import type { CrewRoleName } from './crewRoles';
import { tidyGoalTitle } from '../../shared/goalTitle';
import { fieldsOf } from '../../shared/records';
import { GOAL_TITLE_SCHEMA, goalTitlePrompt, goalTitleSystemPrompt } from './goalTitles';
import { qaAgentModel } from '../../shared/qa';
import { parseQaChat, QA_CHAT_SCHEMA, type QaChatAnswer, qaChatPrompt, type QaChatRequest, qaChatSystemPrompt, type QaChatter } from './qaChat';

// The permanent crew's Claude Code sessions: they read the project's code (and, for some, the web) and change nothing.
// Read-only because they only have Read, Glob and Grep, plus WebSearch and WebFetch where they're given them and
// Ops' own tools, `dontAsk` denies anything not pre-approved, and none of your settings, hooks or MCP servers load.

/** The built-in tools a crew session may be given: none of them can change anything. */
export type ReadOnlyTool = 'Read' | 'Glob' | 'Grep' | 'WebSearch' | 'WebFetch';
export const CODE_TOOLS: ReadOnlyTool[] = ['Read', 'Glob', 'Grep'];
export const WEB_TOOLS: ReadOnlyTool[] = ['WebSearch', 'WebFetch'];
const TURN_TIMEOUT_MS = 8 * 60_000;

/**
 * A crew session's model, turns and time, from its role's crew file (.focus/crew/): what the file leaves out is a
 * read-only session's default (the captain's model, 40 turns, `TURN_TIMEOUT_MS`).
 */
export function crewSession(role: CrewRoleName): Pick<ReadOnlyRun, 'model' | 'maxTurns' | 'timeoutMs'> {
  const { model, maxTurns, timeoutMs } = crewFile(role).settings;
  return { ...(model && { model }), ...(maxTurns && { maxTurns }), ...(timeoutMs && { timeoutMs }) };
}

/** planning/<project>/<repo>: one folder per repo under the session's cwd, so Glob and Grep reach all of them. */
const planningDir = (projectId: string) => path.join(paths.planning, projectId);

async function checkouts(projectId: string, repos: string[], activity: (text: string) => void): Promise<string> {
  const cwd = planningDir(projectId);
  activity(`Pulling the latest ${repos.length === 1 ? 'code' : `code of ${repos.length} repos`}`);
  await Promise.all([...repoFolders(repos)].map(([repo, folder]) => checkoutLatest(repo, path.join(cwd, folder))));
  return cwd;
}

export interface ReadOnlyRun {
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
  /** Ops' own tools for this session, all pre-approved, and what the activity line says while one runs. */
  tools?: { server: McpSdkServerConfigWithInstance; names: string[]; activity: (name: string) => string };
  /** Folders outside `cwd` the session may read too. */
  readable?: string[];
  /** For sessions that read a lot: more turns, and longer, than a quick look. */
  maxTurns?: number;
  /** A model of its own (Haiku, for a cheap extraction), and a system prompt of its own in place of Claude Code's. */
  model?: string;
  system?: string;
  timeoutMs?: number;
  /** How hard it thinks; missing = the model's default. */
  effort?: Effort;
  /** Fast mode: quicker output at a higher price, on a model that has it (Opus). */
  fast?: boolean;
}

export interface ReadOnlyResult {
  text: string;
  structured: unknown;
  sessionId?: string;
  costUsd?: number;
  /** The model it ran on, as Claude Code reported it. */
  model?: string;
}

/** Claude Code's `query`, or a fake stream of its messages in a test. */
export type Ask = (params: { prompt: string; options: Options }) => AsyncIterable<SDKMessage>;

/**
 * The session's options: only the tools it's given, all pre-approved, `dontAsk` for anything else, none of your
 * settings, hooks or MCP servers, and Ops' own tools under `mcp__<server>__`.
 */
export function readOnlyOptions(run: ReadOnlyRun, abort: AbortController): Options {
  const tools = run.tools;
  const extra = tools ? tools.names.map((n) => `${toolPrefix(tools)}${n}`) : [];
  return {
    cwd: run.cwd,
    additionalDirectories: run.readable,
    abortController: abort,
    model: run.model ?? (run.settings.model || undefined),
    systemPrompt: run.system ?? { type: 'preset', preset: 'claude_code', append: run.systemAppend },
    tools: run.builtins,
    allowedTools: [...run.builtins, ...extra],
    permissionMode: 'dontAsk',
    settingSources: [],
    mcpServers: tools ? { [tools.server.name]: tools.server } : {},
    strictMcpConfig: true,
    outputFormat: run.schema ? { type: 'json_schema', schema: run.schema } : undefined,
    maxTurns: run.maxTurns ?? 40,
    effort: run.effort,
    // the SDK leaves fast mode off unless a session opts in through its flag settings
    settings: run.fast ? { fastMode: true } : undefined,
    resume: run.resume,
    env: agentEnv(),
  };
}

const toolPrefix = (tools: NonNullable<ReadOnlyRun['tools']>) => `mcp__${tools.server.name}__`;

type Block = SDKAssistantMessage['message']['content'][number];

/** What the activity line says for one block of the session's reply, or undefined for a block that doesn't show. */
export function blockActivity(block: Block, run: Pick<ReadOnlyRun, 'tools' | 'cwd'>): string | undefined {
  if (block.type === 'tool_use') {
    const prefix = run.tools ? toolPrefix(run.tools) : undefined;
    if (run.tools && prefix !== undefined && block.name.startsWith(prefix)) return run.tools.activity(block.name.slice(prefix.length));
    return renderToolUse(block.name, fieldsOf(block.input), run.cwd).activity ?? '';
  }
  if (block.type === 'thinking') return 'Thinking…';
  if (block.type === 'text' && block.text.trim()) return truncate(block.text.trim().split('\n')[0], 100);
  return undefined;
}

/** What a turn's last message comes to: what it answered, or the error it ended in. */
export function turnResult(msg: SDKResultMessage, seen: Seen): ReadOnlyResult | Error {
  if (msg.subtype !== 'success') return new Error(msg.errors?.join('\n') || msg.subtype);
  if (msg.is_error) return new Error(msg.result);
  return { text: msg.result, structured: msg.structured_output, sessionId: seen.sessionId, costUsd: msg.total_cost_usd, model: seen.model };
}

/** Why a turn that threw ended: the captain stopped it, it ran out of time, or what it threw. */
export function turnFailure(err: unknown, why: { stopped: boolean; timedOut: boolean; timeoutMs: number }): Error {
  if (why.stopped) return new Error('Stopped', { cause: err });
  if (why.timedOut) return new Error(`Gave up after ${why.timeoutMs / 60_000} minutes`, { cause: err });
  return new Error(errorMessage(err), { cause: err });
}

/** The session and model Claude Code reported when the turn started. */
interface Seen {
  sessionId?: string;
  model?: string;
}

/** Reads one message of the turn: notes the session it's in, shows what it's doing, and returns its result at the end. */
function readMessage(msg: SDKMessage, run: ReadOnlyRun, seen: Seen): ReadOnlyResult | Error | undefined {
  if (msg.type === 'system' && msg.subtype === 'init') Object.assign(seen, { sessionId: msg.session_id, model: msg.model });
  else if (msg.type === 'assistant' && msg.parent_tool_use_id === null) {
    for (const block of msg.message.content) {
      const line = blockActivity(block, run);
      if (line !== undefined) run.activity(line);
    }
  } else if (msg.type === 'result') return turnResult(msg, seen);
  return undefined;
}

/** One turn of a read-only session, reporting what it's doing as it goes. */
export async function runReadOnly(run: ReadOnlyRun, ask: Ask = query): Promise<ReadOnlyResult> {
  const abort = new AbortController();
  const onAbort = () => abort.abort();
  run.signal.addEventListener('abort', onAbort);
  const timeoutMs = run.timeoutMs ?? TURN_TIMEOUT_MS;
  const timer = setTimeout(onAbort, timeoutMs);
  const seen: Seen = { sessionId: run.resume };
  try {
    for await (const msg of ask({ prompt: run.prompt, options: readOnlyOptions(run, abort) })) {
      const end = readMessage(msg, run, seen);
      if (end instanceof Error) throw end;
      if (end) return end;
    }
    throw new Error('The session stopped without a result');
  } catch (err) {
    throw turnFailure(err, { stopped: run.signal.aborted, timedOut: abort.signal.aborted, timeoutMs });
  } finally {
    clearTimeout(timer);
    run.signal.removeEventListener('abort', onAbort);
  }
}

/** The planner's structured result as a draft: its repo, or the first of `repos` when it named none. */
export function asDraft(out: unknown, repos: string[]): DraftResult {
  const { repo, title, body, tooBig } = fieldsOf(out);
  if (typeof title !== 'string' || !title || typeof body !== 'string' || !body) throw new Error('Finished without writing the issue');
  return { repo: typeof repo === 'string' && repo ? repo : String(repos[0]), title, body, tooBig: typeof tooBig === 'string' && tooBig ? tooBig : undefined };
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
      ...crewSession('planner'),
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
      ...crewSession('triage'),
    });
    const decision = parseTriage(result.structured);
    if (!decision) throw new Error('Finished without choosing what to do');
    return { ...decision, costUsd: result.costUsd };
  }
}

/**
 * The QA officer answering the captain at the Playbook: one call on the QA model, given the Playbook and the talk in
 * its message, with no tools, so it reads nothing and changes nothing.
 */
export class ClaudeQaChat implements QaChatter {
  async answer(req: QaChatRequest): Promise<QaChatAnswer> {
    const result = await runReadOnly({
      cwd: os.tmpdir(),
      system: qaChatSystemPrompt(req),
      systemAppend: '',
      prompt: qaChatPrompt(req),
      settings: req.settings,
      signal: req.signal,
      activity: () => undefined,
      builtins: [],
      schema: QA_CHAT_SCHEMA,
      ...crewSession('qa-chat'),
      model: qaAgentModel(req.settings),
    });
    const answer = parseQaChat(result.structured);
    if (!answer) throw new Error('The QA officer finished without answering');
    return { ...answer, costUsd: result.costUsd };
  }
}

/** A read-only session with the run of the ship (`PluginHost.shipSession`): what it's given beside a read-only session's. */
export interface ShipSessionRun extends Omit<ReadOnlyRun, 'cwd' | 'readable' | 'tools' | 'systemAppend'> {
  /** Its system prompt's addition, told where the agents' worktrees are (readable, to see what an agent has done). */
  systemAppend: (where: { workspaces: string }) => string;
  /** The projects whose code `open_project` checks out. */
  projects: ChatProject[];
  /** The ship as it is right now, for `ship_status`. */
  shipStatus: () => Promise<ShipStatus>;
  /**
   * Tools of the session's own beside the ship tools, all pre-approved, as `mcp__<name>__<tool>`: unlike those, they do
   * what their `run` does, so a plugin that gives one answers for what it changes. A name the ship tools have is left out.
   */
  tools?: SessionTool[];
}

/** A tool a ship session is given of its own (`ShipSessionRun.tools`), answered in words. */
export interface SessionTool {
  /** Lowercase letters, digits and underscores. */
  name: string;
  /** What it's for and when to reach for it, as the session reads it. */
  description: string;
  /** Its input's fields, as zod types (the SDK's tool boundary takes zod). */
  input: Record<string, ZodType>;
  /** What the activity line says while it runs. */
  activity: string;
  /** Its answer, in words; a throw is said back to the session as the tool failing, in its message. */
  run(input: Record<string, unknown>): Promise<string>;
}

const SHIP_TOOLS = ['ship_status', 'open_project'];

/** A session tool as the SDK's: its answer in words, or what it threw as an error the session reads. */
function sessionTool(t: SessionTool) {
  return tool(t.name, t.description, t.input, async (input) => {
    try {
      return { content: [{ type: 'text' as const, text: await t.run(input) }] };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `${t.name} failed: ${errorMessage(err)}` }], isError: true };
    }
  });
}

/**
 * A read-only session with the run of the ship, as a crew member's (Number One's): from Focus's planning folder,
 * where `open_project` checks out each project, with the agents' worktrees readable and the ship tools
 * (`ship_status`, `open_project`, as `mcp__<name>__…`), neither of which changes anything aboard, and any tools of
 * its own it's given (`run.tools`), which do what they do.
 */
export function shipSession(name: string, run: ShipSessionRun, ask: Ask = query): Promise<ReadOnlyResult> {
  fs.mkdirSync(paths.planning, { recursive: true });
  const { tools: given = [], ...rest } = run;
  const own = given.filter((t) => !SHIP_TOOLS.includes(t.name));
  const server = createSdkMcpServer({ name, version: '1.0.0', alwaysLoad: true, tools: [...shipTools(run, run.activity, (dir) => path.relative(paths.planning, dir)), ...own.map(sessionTool)] });
  const activity = (tool: string) => own.find((t) => t.name === tool)?.activity ?? (tool === 'ship_status' ? 'Checking the ship’s status' : 'Opening a project');
  return runReadOnly({
    ...rest,
    cwd: paths.planning,
    readable: [paths.workspaces],
    systemAppend: run.systemAppend({ workspaces: paths.workspaces }),
    tools: { server, names: [...SHIP_TOOLS, ...own.map((t) => t.name)], activity },
  }, ask);
}

/**
 * The ship's state and a project's code on demand, for a crew session that reads the ship (Number One, and
 * plugins' crew): `shown` says where a checkout went, as the session should read it. Neither changes anything aboard.
 */
export function shipTools(req: { projects: ChatProject[]; shipStatus: () => Promise<ShipStatus> }, activity: (text: string) => void, shown: (dir: string) => string) {
  const text = (t: string, isError = false) => ({ content: [{ type: 'text' as const, text: t }], ...(isError && { isError }) });
  const project = (id: string): ChatProject | undefined => req.projects.find((p) => p.id === id);
  return [
    tool('ship_status', "The ship right now: per project, its agents (with their worktree paths), open pull requests with QA verdicts and checks, what needs the captain, and its closed goals (newest first) with each PR's state on GitHub right now (stale: true when it couldn't be looked up, so it's only the recorded outcome).", {}, async () =>
      text(JSON.stringify(await req.shipStatus(), null, 1)),
    ),
    tool(
      'open_project',
      "Checks out a project's repositories at their latest default branch, so you can read its code: it says where each went.",
      { projectId: z.string().describe('The project id, as listed in your instructions') },
      async ({ projectId }) => {
        const found = project(projectId);
        if (!found) return text(`There's no project with id ${projectId}. The projects are: ${req.projects.map((p) => `${p.name} (${p.id})`).join(', ') || 'none'}.`, true);
        if (!found.repos.length) return text(`${found.name} has no repositories yet.`, true);
        try {
          const cwd = await checkouts(found.id, found.repos, activity);
          const folders = [...repoFolders(found.repos)];
          return text(`${found.name} is checked out at its default branch:\n${folders.map(([r, folder]) => `- ${shown(path.join(cwd, folder))}/ (${r})`).join('\n')}`);
        } catch (err) {
          return text(`The checkout of ${found.name} failed: ${errorMessage(err)}`, true);
        }
      },
    ),
  ];
}

/** A short title for a goal from the captain's first words, on its crew file's model (Haiku); undefined when it doesn't give a usable one. */
export async function titleGoal(brief: string, settings: Settings): Promise<string | undefined> {
  const result = await runReadOnly({
    cwd: os.tmpdir(),
    system: goalTitleSystemPrompt(),
    systemAppend: '',
    prompt: goalTitlePrompt(brief),
    settings,
    signal: new AbortController().signal,
    activity: () => undefined,
    builtins: [],
    schema: GOAL_TITLE_SCHEMA,
    ...crewSession('goal-title'),
  });
  return tidyGoalTitle(fieldsOf(result.structured).title);
}

