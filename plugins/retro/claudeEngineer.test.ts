import { describe, expect, it } from 'vitest';
import type { ReadOnlyRun, Settings } from '../../plugin-api/server';
import { ClaudeEngineer, READER_MODEL } from './claudeEngineer';

describe('ClaudeEngineer', () => {
  it('reads and drafts in the read-only sessions Ops lends it: no tools to read, the code tools to draft', async () => {
    const runs: ReadOnlyRun[] = [];
    const engineer = new ClaudeEngineer((run) => {
      runs.push(run);
      return Promise.resolve({ text: 'drafted', structured: { drafts: [] }, costUsd: 0.5 });
    });
    const settings = {} as Settings;
    const signal = new AbortController().signal;
    expect(await engineer.read({ prompt: 'spans', settings, signal })).toEqual({ structured: { drafts: [] }, costUsd: 0.5 });
    expect(await engineer.retro({ cwd: '/evidence', days: 14, groups: 3, settings, signal }, () => undefined)).toEqual({ structured: { drafts: [] }, text: 'drafted', costUsd: 0.5 });
    expect(runs.map((r) => [r.builtins, r.model, r.cwd === '/evidence'])).toEqual([[[], READER_MODEL, false], [['Read', 'Glob', 'Grep'], undefined, true]]);
  });
});
