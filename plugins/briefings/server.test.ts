// The briefings plugin's `/writer` route: the captain's writer setting, changed a field at a time, and refused when it's
// not one the writer knows.
import { describe, expect, it } from 'vitest';
import type { PluginHost, PluginState } from '../../plugin-api/server';
import briefings from './server';
import { type BriefingsState, freshBriefings } from './shared';

function writerRoute() {
  let saved = freshBriefings();
  const state = (): PluginState<BriefingsState> => ({ get: () => saved, set: (patch) => (saved = { ...saved, ...patch }) });
  const host = { state, settings: () => ({ model: 'claude-opus-5-5', leadEffort: 'high' }), dataDir: () => '/data' } as unknown as PluginHost;
  const route = briefings.start(host).routes?.find((r) => r.path === '/writer');
  if (!route) throw new Error('no /writer route');
  return (body: Record<string, unknown>) => route.handle({ body, query: {} });
}

describe('the writer setting', () => {
  it('changes what it’s sent and keeps the rest', async () => {
    const post = writerRoute();
    expect(await post({ model: 'claude-haiku-4-5-20251001' })).toMatchObject({ writer: { model: 'claude-haiku-4-5-20251001', effort: '', fast: false } });
    expect(await post({ effort: 'low', fast: true })).toMatchObject({ writer: { model: 'claude-haiku-4-5-20251001', effort: 'low', fast: true } });
  });

  it('refuses a model it doesn’t know', async () => {
    const post = writerRoute();
    await expect(async () => post({ model: 'gpt-5' })).rejects.toThrow("there's no writer model gpt-5");
  });
});
