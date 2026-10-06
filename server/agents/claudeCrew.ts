import fs from 'node:fs';
import path from 'node:path';
import { createSdkMcpServer, type McpSdkServerConfigWithInstance, type Options, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { Brief, Settings, StepProposal } from '../../shared/types';
import { paths } from '../config';
import { errorMessage, truncate } from '../util';
import {
  asOfficerReply,
  asQaNote,
  type BriefingOfficer,
  type BriefingQa,
  briefingPrompt,
  briefingQaPrompt,
  briefingQaSystemPrompt,
  briefingSystemPrompt,
  mergeBrief,
  type OfficerHooks,
  type OfficerReply,
  type OfficerTurn,
  officerReplySchema,
  qaNoteSchema,
  type QaReply,
  type QaTurn,
  stepSchema,
} from './briefing';
import { asBreakdown, breakdownSchema } from './breakdown';
import { agentEnv } from './claudeRunner';
import { type BriefingEngineer, decodeEngineeringReport, ENGINEERING_SCHEMA, type EngineerReply, type EngineerTurn, engineerPrompt, engineerSystemPrompt } from './engineering';
import { type Drafter, type DraftRequest, type DraftResult, draftSchema, plannerPrompt, standDraftSchema, plannerSystemPrompt, repoFolders } from './planner';
import { renderToolUse } from './render';
import { parseTriage, TRIAGE_SCHEMA, type TriageDecision, type Triager, type TriageRequest, triagePrompt, triageSystemPrompt } from './triage';
import { checkoutLatest } from './workspace';

// The permanent crew's Claude Code sessions (the ship's engineer included): they read the project's code (and, in briefings, the web) and change
// nothing. Read-only because they only have Read, Glob and Grep, plus WebSearch and WebFetch in briefings and the
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
  /** The office's own tools for this session, all pre-approved. */
  tools?: { server: McpSdkServerConfigWithInstance; names: string[] };
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
  const timer = setTimeout(onAbort, TURN_TIMEOUT_MS);
  const extra = run.tools ? run.tools.names.map((n) => `mcp__${run.tools!.server.name}__${n}`) : [];
  const options: Options = {
    cwd: run.cwd,
    abortController: abort,
    model: run.settings.model || undefined,
    systemPrompt: { type: 'preset', preset: 'claude_code', append: run.systemAppend },
    tools: run.builtins,
    allowedTools: [...run.builtins, ...extra],
    permissionMode: 'dontAsk',
    settingSources: [],
    mcpServers: run.tools ? { [run.tools.server.name]: run.tools.server } : {},
    strictMcpConfig: true,
    outputFormat: run.schema ? { type: 'json_schema', schema: run.schema } : undefined,
    maxTurns: 40,
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
            if (block.name.startsWith('mcp__brief__')) run.activity('Updating the brief');
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
    if (abort.signal.aborted) throw new Error(`Gave up after ${TURN_TIMEOUT_MS / 60_000} minutes`, { cause: err });
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
      schema: standDraftSchema(req.repos),
    }).catch((err: Error) => {
      throw req.signal.aborted ? new Error('Discarded') : err;
    });
    return { ...asDraft(result.structured, req.repos), sessionId: result.sessionId, costUsd: result.costUsd };
  }
}

/** The officer in a briefing: each turn resumes the same session, with a tool to keep the brief on the wall screen. */
export class ClaudeOfficer implements BriefingOfficer {
  async turn(req: OfficerTurn, hooks: OfficerHooks): Promise<OfficerReply> {
    // fresh code at the start, on reconvening a goal (its step has landed since) and after a lost session; other turns read what's already checked out
    const fresh = req.kind === 'open' || req.kind === 'reconvene' || !req.resumeSessionId;
    const cwd = fresh ? await checkouts(req.projectId, req.repos, hooks.activity) : planningDir(req.projectId);
    if (req.signal.aborted) throw new Error('Stopped');
    let brief = req.brief;
    const server = briefServer(() => brief, (next) => {
      brief = next;
      hooks.brief(next);
    });
    const wrapUp = req.kind === 'wrap-up';
    const breakDown = req.kind === 'break-down';
    const step = req.kind === 'step';
    const result = await runReadOnly({
      cwd,
      systemAppend: briefingSystemPrompt(req),
      prompt: briefingPrompt(req),
      settings: req.settings,
      signal: req.signal,
      activity: hooks.activity,
      builtins: [...CODE_TOOLS, ...WEB_TOOLS],
      resume: req.resumeSessionId,
      schema: wrapUp ? draftSchema(req.repos) : breakDown ? breakdownSchema(req.repos) : step ? stepSchema(req.repos) : officerReplySchema,
      tools: { server, names: ['update_brief'] },
    });
    const written = (): StepProposal => {
      const { repo, title, body } = asDraft(result.structured, req.repos);
      return { repo, title, body };
    };
    return {
      ...(wrapUp || breakDown || step ? { text: '' } : asOfficerReply(result.structured, result.text)),
      sessionId: result.sessionId,
      costUsd: result.costUsd,
      draft: wrapUp ? asDraft(result.structured, req.repos) : undefined,
      breakdown: breakDown ? asBreakdown(result.structured, req.repos) : undefined,
      step: step ? written() : undefined,
    };
  }
}

/** The QA officer at a briefing: reads the code the officer checked out, and answers with one note or none. */
export class ClaudeBriefingQa implements BriefingQa {
  async check(req: QaTurn, activity: (text: string) => void): Promise<QaReply> {
    const result = await runReadOnly({
      cwd: planningDir(req.projectId),
      systemAppend: briefingQaSystemPrompt(req),
      prompt: briefingQaPrompt(req),
      settings: req.settings,
      signal: req.signal,
      activity,
      builtins: CODE_TOOLS,
      resume: req.resumeSessionId,
      schema: qaNoteSchema,
    });
    return { note: asQaNote(result.structured), sessionId: result.sessionId, costUsd: result.costUsd };
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

/** The ship's engineer at a briefing: reads the code the officer checked out, and answers with options. */
export class ClaudeEngineer implements BriefingEngineer {
  async propose(req: EngineerTurn, activity: (text: string) => void): Promise<EngineerReply> {
    const result = await runReadOnly({
      cwd: planningDir(req.projectId),
      systemAppend: engineerSystemPrompt(req),
      prompt: engineerPrompt(req),
      settings: req.settings,
      signal: req.signal,
      activity,
      builtins: CODE_TOOLS,
      resume: req.resumeSessionId,
      schema: ENGINEERING_SCHEMA,
    });
    return { report: decodeEngineeringReport(result.structured), sessionId: result.sessionId, costUsd: result.costUsd };
  }
}

/** The update_brief tool: the officer's pen for the lounge's wall screen. */
function briefServer(get: () => Brief, set: (brief: Brief) => void): McpSdkServerConfigWithInstance {
  const lines = z.array(z.string()).optional();
  return createSdkMcpServer({
    name: 'brief',
    version: '1.0.0',
    alwaysLoad: true,
    tools: [
      tool(
        'update_brief',
        'Update the brief on the observation lounge wall screen, which the manager can see. Pass only the fields that change; a list replaces the whole list. One short line per entry.',
        {
          summary: z.string().optional().describe('What we are building, in one sentence'),
          why: z.string().optional().describe('The problem it solves and why it matters'),
          who: z.string().optional().describe('Who it is for'),
          scope: lines.describe('What is in'),
          out_of_scope: lines.describe('What is deliberately left out or for later'),
          acceptance: lines.describe('Observable, testable acceptance criteria agreed so far'),
          open_questions: lines.describe('What still needs deciding; drop entries once answered'),
          diagrams: z
            .array(z.object({ title: z.string().describe('"Today", "Option A: …" or "Chosen: …"'), mermaid: z.string().describe('Mermaid source: flowchart, classDiagram or sequenceDiagram, labels in quotes') }))
            .optional()
            .describe('Architecture diagrams, at most 4; replaces the whole list'),
        },
        async (patch) => {
          set(mergeBrief(get(), patch));
          return { content: [{ type: 'text', text: 'The brief on the screen is updated.' }] };
        },
      ),
    ],
  });
}
