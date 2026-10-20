import os from 'node:os';
import type { ReadOnlyResult, ReadOnlyRun } from '../../plugin-api/server';
import type { Judge } from './chief';
import { VERDICT_SCHEMA } from './judge';

/** The model that judges a turn: Claude Code's alias for the latest Haiku, as the backtest ran it. About a tenth of a cent a turn. */
export const JUDGE_MODEL = 'haiku';

/** The chief of staff's judge, as a read-only Claude Code session: no tools, its own system prompt, a structured answer. */
export class ClaudeJudge implements Judge {
  readonly model = JUDGE_MODEL;

  /** `session` runs a read-only Claude Code session: the host's (`host.readOnlySession`), or a fake in a test. */
  constructor(private readonly session: (run: ReadOnlyRun) => Promise<ReadOnlyResult>) {}

  async judge(req: { system: string; prompt: string; settings: ReadOnlyRun['settings'] }): Promise<{ structured: unknown; costUsd?: number; model?: string }> {
    const result = await this.session({
      cwd: os.tmpdir(),
      system: req.system,
      systemAppend: '',
      prompt: req.prompt,
      settings: req.settings,
      signal: new AbortController().signal,
      activity: () => undefined,
      builtins: [],
      schema: VERDICT_SCHEMA,
      model: JUDGE_MODEL,
      maxTurns: 2,
      timeoutMs: 3 * 60_000,
    });
    return { structured: result.structured, costUsd: result.costUsd, model: result.model };
  }
}
