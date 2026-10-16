import os from 'node:os';
import { chiefEngineer, type ReadOnlyResult, type ReadOnlyRun, type Settings } from '../../plugin-api/server';
import type { RetroOfficer, RetroRequest } from './engineer';
import { READ_SCHEMA, readerSystemPrompt } from './frictions';
import { DRAFTS_SCHEMA, engineerPrompt, engineerSystemPrompt } from './retro';

/** The model that reads sessions for frictions at retro time: it labels the same trouble the same way (see README.md). */
export const READER_MODEL = 'claude-opus-5-5';

/**
 * The chief engineer on a retro, as read-only Claude Code sessions: reads the evidence the plugin gathered into its own
 * folder (the frictions that keep coming back, the ledger, closed goals) and nothing else, and drafts issues from them.
 */
export class ClaudeEngineer implements RetroOfficer {
  /** `session` runs a read-only Claude Code session: the host's (`host.readOnlySession`), or a fake in a test. */
  constructor(private readonly session: (run: ReadOnlyRun) => Promise<ReadOnlyResult>) {}

  /** A batch of sessions' spans for their frictions: no tools, a short system prompt of its own, a structured answer. */
  async read(req: { prompt: string; settings: Settings; signal: AbortSignal }): Promise<{ structured: unknown; costUsd?: number }> {
    const result = await this.session({
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
    const result = await this.session({
      cwd: req.cwd,
      systemAppend: engineerSystemPrompt(chiefEngineer().name),
      prompt: engineerPrompt(req.days, req.groups),
      settings: req.settings,
      signal: req.signal,
      activity,
      builtins: ['Read', 'Glob', 'Grep'],
      schema: DRAFTS_SCHEMA,
      maxTurns: 60,
      timeoutMs: 15 * 60_000,
    });
    return { structured: result.structured, text: result.text, costUsd: result.costUsd };
  }
}
