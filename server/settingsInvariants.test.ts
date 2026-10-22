import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Settings } from '../shared/types';
import { checkAtOnce, checkRestart, type Running, type Subject } from './agents/invariants';
import { paths } from './config';
import { changeSettings } from './settings';
import { Store } from './store';

// The captain's settings (server/settings.ts, kept in state.json by the store) under Focus's two rules
// (docs/invariants.md): a restart ends as if a change had never started, or had finished, and two changes at once as
// one after the other would. Its promises are docs/settings.md's. A change waits on nothing outside: it's taken
// whole, and Focus going down saves what's waiting (the store's exit hook), so a restart falls between changes.

/** What survives: the fields the captain sets and clears. */
type Kept = Pick<Settings, 'terminal' | 'browserPath' | 'publicUrl' | 'autoUpdate' | 'model'>;

/** How a change is made the store's: `replaceSettings`, or a break planted in its place. */
type Apply = (store: Store, next: Settings) => void;

const settingsSubject = (apply: Apply): Subject<Kept> => ({
  name: 'settings',
  start: () => {
    fs.rmSync(paths.state, { force: true });
    const life = (): Running<Kept> => {
      const store = new Store(true);
      store.load();
      // as Focus.updateSettings does: the change cleaned up, then made the store's
      const change = (patch: Partial<Record<keyof Settings, unknown>>) => {
        apply(store, changeSettings(store.settings, patch));
        store.save();
      };
      return {
        actions: () => [
          { name: 'set the terminal', run: () => change({ terminal: 'kitty -e' }) },
          { name: 'clear the terminal', run: () => change({ terminal: '' }) },
          { name: 'set the browser', run: () => change({ browserPath: '/x/chromium' }) },
          { name: 'clear the browser', run: () => change({ browserPath: ' ' }) },
          { name: 'set the public address', run: () => change({ publicUrl: 'https://focus.ts.net/' }) },
          { name: 'clear the public address', run: () => change({ publicUrl: '' }) },
          { name: 'switch auto update off', run: () => change({ autoUpdate: false }) },
          { name: 'set the model', run: () => change({ model: 'claude-opus-5-5' }) },
        ],
        durable: () => {
          const { terminal, browserPath, publicUrl, autoUpdate, model } = store.settings;
          return { terminal, browserPath, publicUrl, autoUpdate, model };
        },
        settle: () => Promise.resolve(),
        // Focus going down saves what's waiting, then starts again on state.json
        restart: () => {
          store.flush();
          return life();
        },
      };
    };
    return life();
  },
});

const settings = settingsSubject((store, next) => store.replaceSettings(next));

/** The promise: set four, clear two, restart: what's left is what's set and not cleared. */
async function setClearRestart(subject: Subject<Kept>): Promise<Kept> {
  const r = await subject.start((_l, work) => work());
  const take = (name: string) => r.actions().find((a) => a.name === name)?.run();
  for (const name of ['set the terminal', 'set the browser', 'set the public address', 'clear the terminal', 'clear the public address']) take(name);
  return (await r.restart((_l, work) => work())).durable();
}

describe('the captain’s settings, under Focus’s two rules', () => {
  it('end a restart as if a change had never started, or had finished', async () => {
    await checkRestart(settings, { runs: 20 });
  });

  it('end two changes at once as one after the other would', async () => {
    await checkAtOnce(settings, { runs: 20 });
  });

  // docs/settings.md: "What you set in Settings is kept across a restart, and what you clear stays cleared"
  it('keep what the captain set across a restart, and keep what they cleared cleared', async () => {
    expect(await setClearRestart(settings)).toEqual({ browserPath: '/x/chromium', model: '' });
  });

  it('catches a break with that promise: a change merged into the settings, keeping what was cleared (#610’s QA)', async () => {
    const merged = settingsSubject((store, next) => Object.assign(store.settings, next));
    expect(await setClearRestart(merged)).toMatchObject({ terminal: 'kitty -e', publicUrl: 'https://focus.ts.net' });
  });
});
