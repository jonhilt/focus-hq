import { describe, expect, it } from 'vitest';
import type { SignIn } from '../../plugin-api/shared';
import { office, until } from '../../plugin-api/testing';
import usagePlugin from './server';
import { USAGE, type Usage } from './shared';

/** The office with the readout switched on, signing in as `signIn` says. */
function aboard(signIn: SignIn) {
  const o = office();
  o.agents.startPlugins([usagePlugin], { demo: true, ownRepo: () => undefined, signIn: () => signIn });
  const state = () => o.agents.plugins.stateOf(USAGE) as Usage | undefined;
  return { ...o, state };
}

describe('the usage plugin', () => {
  it('says how the office signs in at once, reads the demo’s made-up plan, and keeps none of it in state.json', async () => {
    const signIn: SignIn = { mode: 'fallback', onKey: false, keySpentUsd: 0, keyBudgetUsd: 20 };
    const o = aboard(signIn);
    expect(o.state()).toMatchObject({ signIn: 'fallback', onKey: false, keyBudgetUsd: 20 });
    await until(() => !!o.state()?.plan);
    expect(o.state()?.plan).toMatchObject({ plan: 'max', windows: [{ label: 'session' }, { label: 'week', percent: 27 }] });
    expect(o.store.plugins).toEqual({});

    // the plan's limit is reached: new sessions are on the key
    signIn.onKey = true;
    signIn.keySpentUsd = 1.5;
    o.agents.plugins.signInChanged(signIn);
    expect(o.state()).toMatchObject({ onKey: true, keySpentUsd: 1.5, plan: { plan: 'max' } });
  });

  it('reads no plan on the API key alone', async () => {
    const o = aboard({ mode: 'key', onKey: true, keySpentUsd: 0, keyBudgetUsd: 20 });
    expect(o.state()).toMatchObject({ plan: null, signIn: 'key' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(o.state()?.plan).toBeNull();
  });
});
