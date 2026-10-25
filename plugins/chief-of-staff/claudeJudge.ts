import os from 'node:os';
import type { ReadOnlyResult, ReadOnlyRun } from '../../plugin-api/server';
import type { Judge } from './chief';
import { VERDICT_SCHEMA } from './judge';

/**
 * The model that judges a turn: Claude Code's alias for the latest Sonnet, as the defence backtest ran it (README.md#what-it-reads-a-turn-against).
 * About 3 cents a turn with what it reads a turn against, against Haiku's tenth of a cent: the user's call, for fewer turns routed wrong.
 */
export const JUDGE_MODEL = 'sonnet';

/** The chief of staff's judge, as a read-only Claude Code session: no tools, its own system prompt, a structured answer. */
export class ClaudeJudge implements Judge {
  readonly model = JUDGE_MODEL;

  /** `session` runs a read-only Claude Code session: the host's (`host.readOnlySession`), or a fake in a test. */
  constructor(private readonly session: (run: ReadOnlyRun) => Promise<ReadOnlyResult>) {}

  async judge(req: { system: string; prompt: string; settings: ReadOnlyRun['settings']; schema?: Record<string, unknown> }): Promise<{ structured: unknown; costUsd?: number; model?: string }> {
    const result = await this.session({
      cwd: os.tmpdir(),
      system: req.system,
      systemAppend: '',
      prompt: req.prompt,
      settings: req.settings,
      signal: new AbortController().signal,
      activity: () => undefined,
      builtins: [],
      schema: req.schema ?? VERDICT_SCHEMA,
      model: JUDGE_MODEL,
      maxTurns: 2,
      timeoutMs: 3 * 60_000,
    });
    return { structured: result.structured, costUsd: result.costUsd, model: result.model };
  }
}
