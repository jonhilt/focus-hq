// Number One's Claude Code session: read-only, like the rest of the permanent crew, with the ship's state
// and any project's code on demand through the office's ship tools.
import { CODE_TOOLS, type ReadOnlyResult, type ShipSessionRun, WEB_TOOLS } from '../../plugin-api/server';
import { asNumberOneReply, type NumberOneOfficer, type NumberOneReply, type NumberOneTurn, numberOnePrompt, numberOneReplySchema, numberOneSystemPrompt } from './chat';

/**
 * Number One: one session for the whole ship, in the one the office lends its crew (`host.shipSession`): from the
 * office's planning folder, so every project's checkout is in reach once it's opened, with the agents' worktrees
 * readable too, to see what an agent has done so far, and the ship tools (`mcp__number-one__ship_status`, `open_project`).
 */
export class ClaudeNumberOne implements NumberOneOfficer {
  /** `session` runs a session with the run of the ship: the host's, or a fake in a test. */
  constructor(private readonly session: (run: ShipSessionRun) => Promise<ReadOnlyResult>) {}

  async turn(req: NumberOneTurn, activity: (text: string) => void): Promise<NumberOneReply> {
    const ids = req.projects.map((p) => p.id);
    const result = await this.session({
      systemAppend: ({ workspaces }) => numberOneSystemPrompt({ projects: req.projects, workspaces }),
      prompt: numberOnePrompt(req),
      settings: req.settings,
      signal: req.signal,
      activity,
      builtins: [...CODE_TOOLS, ...WEB_TOOLS],
      resume: req.resumeSessionId,
      schema: numberOneReplySchema(ids),
      projects: req.projects,
      shipStatus: req.shipStatus,
    });
    return { ...asNumberOneReply(result.structured, result.text, ids), sessionId: result.sessionId, costUsd: result.costUsd };
  }
}
