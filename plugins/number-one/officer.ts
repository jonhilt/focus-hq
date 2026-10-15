// Number One's Claude Code session (README.md): read-only, like the rest of the permanent crew, with the ship's state
// and any project's code on demand through the office's ship tools.
import fs from 'node:fs';
import path from 'node:path';
import { createSdkMcpServer, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { CODE_TOOLS, runReadOnly, shipTools, WEB_TOOLS } from '../../server/agents/claudeCrew';
import { paths } from '../../server/config';
import { asNumberOneReply, type NumberOneOfficer, type NumberOneReply, type NumberOneTurn, numberOnePrompt, numberOneReplySchema, numberOneSystemPrompt } from './chat';
import { NUMBER_ONE } from './shared';

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

/** Number One's own tools (`mcp__number-one__…`): the ship's state, and a project's code on demand. Neither changes anything aboard. */
function numberOneServer(req: NumberOneTurn, activity: (text: string) => void): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: NUMBER_ONE,
    version: '1.0.0',
    alwaysLoad: true,
    tools: shipTools(req, activity, (dir) => path.relative(paths.planning, dir)),
  });
}
