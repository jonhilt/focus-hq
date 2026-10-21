import { describe, expect, it } from 'vitest';
import type { ReadOnlyRun, Settings } from '../../plugin-api/server';
import { ClaudeJudge, JUDGE_MODEL } from './claudeJudge';
import { VERDICT_SCHEMA } from './judge';

describe('ClaudeJudge', () => {
  it('judges in a read-only session Ops lends it: Haiku, no tools, its own system prompt, a structured answer', async () => {
    const runs: ReadOnlyRun[] = [];
    const judge = new ClaudeJudge((run) => {
      runs.push(run);
      return Promise.resolve({ text: '', structured: { route: 1, why: 'Progress.', message: '' }, costUsd: 0.001, model: 'claude-haiku-4-5' });
    });
    const settings = {} as Settings;
    expect(await judge.judge({ system: 'rules', prompt: 'Goal: G', settings })).toEqual({ structured: { route: 1, why: 'Progress.', message: '' }, costUsd: 0.001, model: 'claude-haiku-4-5' });
    expect(runs.map((r) => [r.model, r.builtins, r.system, r.prompt, r.schema])).toEqual([[JUDGE_MODEL, [], 'rules', 'Goal: G', VERDICT_SCHEMA]]);
    expect(JUDGE_MODEL).toBe('haiku');
  });
});
