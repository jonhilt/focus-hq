import { CODE_TOOLS, type ReadOnlyResult, type ShipSessionRun } from '../../plugin-api/server';
import type { LineOfficer, LineReply, LineTurn } from './line';

/**
 * The chief of staff on its direct line, as a Claude Code session with the run of the ship (`host.shipSession`): the
 * ship tools to look, Read, Glob and Grep for a project's code, and the line's own tools (`start_goal`, `tell_goal`),
 * all as `mcp__chief-of-staff__…`. Each turn resumes the last, so the conversation carries on.
 */
export class ClaudeLine implements LineOfficer {
  /** `session` runs a ship session: the host's, or a fake in a test. */
  constructor(private readonly session: (run: ShipSessionRun) => Promise<ReadOnlyResult>) {}

  async turn(req: LineTurn, activity: (text: string) => void): Promise<LineReply> {
    const result = await this.session({
      systemAppend: () => req.system,
      prompt: req.prompt,
      settings: req.settings,
      signal: req.signal,
      activity,
      builtins: CODE_TOOLS,
      resume: req.resumeSessionId,
      projects: req.projects,
      shipStatus: req.shipStatus,
      tools: req.tools,
    });
    return { text: result.text, sessionId: result.sessionId, costUsd: result.costUsd };
  }
}
