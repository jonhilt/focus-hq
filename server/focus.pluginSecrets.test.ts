import { Effect, Layer, ManagedRuntime } from 'effect';
import { afterEach, expect, it, vi } from 'vitest';
import type { FocusPlugin, PluginHost } from '../plugin-api/server';
import { DemoDrafter, demoWorkspace } from './agents/demoRunner';
import { focus as fakeFocus } from './agents/fakeFocus';
import { IssuePlanner } from './agents/planner';
import { demoLayer } from './github/demo';
import { GitHub, toProvider } from './github/service';
import { Hub } from './hub';
import { Focus } from './focus';
import { Previews } from './previews';
import { withoutSecrets } from './secrets';
import { Voice } from './voice';

afterEach(() => vi.unstubAllEnvs());

/** Focus with a plugin that needs a key, and what it hears of it. */
async function withKeyedPlugin() {
  const gh = await ManagedRuntime.make(demoLayer).runPromise(GitHub.use(Effect.succeed));
  const github = Layer.succeed(GitHub, gh);
  const o = fakeFocus(demoWorkspace, github);
  const hub = new Hub();
  const provider = toProvider(github);
  const focus = new Focus(o.store, hub, provider, new Previews(hub, provider, true), new IssuePlanner(o.store, hub, new DemoDrafter()), new Voice(hub, true), 'test');
  focus.agents = o.agents;
  let host: PluginHost | undefined;
  const changed: string[] = [];
  const keyed: FocusPlugin = {
    id: 'keyed',
    secrets: [{ name: 'KEYED_API_KEY', label: 'Keyed API key' }],
    start: (h) => {
      host = h;
      return { secretChanged: (name) => void changed.push(name) };
    },
  };
  focus.startPlugins([keyed], {}, { pinnedBy: null, startedWith: ['keyed'], available: [], canRestart: false });
  if (!host) throw new Error('the plugin didn’t start');
  return { focus, host, changed };
}

it('lends a plugin the secret the captain sets, tells it, and never tells a browser or a child process', async () => {
  const { focus, host, changed } = await withKeyedPlugin();
  expect(host.secret('KEYED_API_KEY')).toBeUndefined();
  expect(focus.infoChanged().pluginSecrets).toEqual({ keyed: [{ name: 'KEYED_API_KEY', label: 'Keyed API key', by: null }] });

  focus.changePluginSecret('keyed', 'KEYED_API_KEY', ' sk-live-123 ');
  expect(host.secret('KEYED_API_KEY')).toBe('sk-live-123');
  expect(changed).toEqual(['KEYED_API_KEY']);
  expect(focus.infoChanged().pluginSecrets.keyed?.[0]?.by).toBe('captain');
  expect(JSON.stringify(focus.infoChanged())).not.toContain('sk-live-123');

  vi.stubEnv('KEYED_API_KEY', 'from-env');
  expect(withoutSecrets()).not.toHaveProperty('KEYED_API_KEY');

  vi.unstubAllEnvs();
  focus.changePluginSecret('keyed', 'KEYED_API_KEY', '');
  expect(host.secret('KEYED_API_KEY')).toBeUndefined();
});

it('lets the environment variable win, refusing a change from the browser while it does', async () => {
  const { focus, host } = await withKeyedPlugin();
  vi.stubEnv('KEYED_API_KEY', 'from-env');
  expect(host.secret('KEYED_API_KEY')).toBe('from-env');
  expect(focus.infoChanged().pluginSecrets.keyed?.[0]?.by).toBe('env');
  expect(() => focus.changePluginSecret('keyed', 'KEYED_API_KEY', 'mine')).toThrow('KEYED_API_KEY is set in Focus');
});

it('lends a plugin only the secrets it declared, and refuses a change to one it didn’t', async () => {
  const { focus, host } = await withKeyedPlugin();
  vi.stubEnv('FOCUS_BOT_TOKEN', 'the-bots');
  expect(host.secret('FOCUS_BOT_TOKEN')).toBeUndefined();
  expect(() => focus.changePluginSecret('keyed', 'FOCUS_BOT_TOKEN', 'x')).toThrow('keeps no secret called FOCUS_BOT_TOKEN');
  expect(() => focus.changePluginSecret('other', 'KEYED_API_KEY', 'x')).toThrow('other keeps no secret');
});

it('leaves out a plugin that names a secret like anything but an API key, saying why', async () => {
  const { focus } = await withKeyedPlugin();
  const greedy: FocusPlugin = { id: 'greedy', secrets: [{ name: 'PATH', label: 'Path' }], start: () => ({}) };
  focus.agents.plugins.start([greedy], () => ({}) as PluginHost);
  expect(focus.agents.plugins.ids()).not.toContain('greedy');
  expect(focus.agents.plugins.leftOut).toContainEqual({ id: 'greedy', why: expect.stringContaining('named like an API key') });
  expect(withoutSecrets({ PATH: '/bin' })).toEqual({ PATH: '/bin' });
});
