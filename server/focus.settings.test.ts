import { Effect, Layer, ManagedRuntime } from 'effect';
import { expect, it } from 'vitest';
import { DemoDrafter, demoWorkspace } from './agents/demoRunner';
import { focus as fakeFocus } from './agents/fakeFocus';
import { IssuePlanner } from './agents/planner';
import { demoLayer } from './github/demo';
import { GitHub, toProvider } from './github/service';
import { Hub } from './hub';
import { Focus } from './focus';
import { Previews } from './previews';
import { Voice } from './voice';

it('an empty terminal, browser path or public address in Settings clears what was saved', async () => {
  const gh = await ManagedRuntime.make(demoLayer).runPromise(GitHub.use(Effect.succeed));
  const github = Layer.succeed(GitHub, gh);
  const o = fakeFocus(demoWorkspace, github);
  const hub = new Hub();
  const provider = toProvider(github);
  const focus = new Focus(o.store, hub, provider, new Previews(hub, provider, true), new IssuePlanner(o.store, hub, new DemoDrafter()), new Voice(hub, true), 'test');
  focus.agents = o.agents;
  const held = o.store.settings;
  focus.updateSettings({ terminal: 'kitty -e', browserPath: '/x/chromium', publicUrl: 'https://focus.ts.net' });
  expect(o.store.settings).toMatchObject({ terminal: 'kitty -e', browserPath: '/x/chromium', publicUrl: 'https://focus.ts.net' });
  focus.updateSettings({ terminal: '', browserPath: ' ', publicUrl: '' });
  expect(o.store.settings).not.toHaveProperty('terminal');
  expect(o.store.settings).not.toHaveProperty('browserPath');
  expect(o.store.settings).not.toHaveProperty('publicUrl');
  // the same object, so code holding it sees the change
  expect(o.store.settings).toBe(held);
});
