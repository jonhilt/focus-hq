import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BotSetup } from './bot';
import { checkAtOnce, checkRestart, type Running, type Subject } from './agents/invariants';
import { keepSecrets, type SecretName, Secrets, secretSetBy } from './secrets';

// The secrets file (server/secrets.ts) under Focus's two rules (docs/invariants.md): a restart ends as if a change
// to it had never started, or had finished, and two changes at once as one after the other would. Its promises are
// docs/settings.md's. It waits on nothing outside: each change is written whole before it says it's done, so a
// restart only ever falls between changes.

/** What survives: whether there's a token (each one made is new), the webhook, its Authorization header, and a plugin's key. */
interface Kept {
  token: boolean;
  webhook?: string;
  auth?: string;
  pluginKey: 'env' | 'captain' | null;
}

/** A plugin's API key, kept beside the bot's (docs/plugins.md, Secrets). */
const PLUGIN_KEY = 'INVARIANT_API_KEY';
keepSecrets([PLUGIN_KEY]);

type Keeper = (file: string) => { get(name: SecretName): string | undefined; set(name: SecretName, value: string | undefined): void };

/** The bot's setup on a secrets file of its own: `keep` reads and writes it (the real file, or a break planted in it). */
function secretsSubject(keep: Keeper): Subject<Kept> {
  return {
    name: 'secrets',
    start: () => {
      const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'secrets-')), 'secrets.env');
      const life = (): Running<Kept> => {
        const kept = keep(file);
        const bot = new BotSetup({ secrets: kept, publicUrl: () => undefined }, {});
        return {
          actions: () => [
            { name: 'make a token', run: () => bot.newToken() },
            { name: 'set a token of my own', run: () => bot.change({ token: 'a-token-of-my-own-1234' }) },
            { name: 'clear the token', run: () => bot.clearToken() },
            { name: 'set the webhook', run: () => bot.change({ webhook: 'https://hook.example/a' }) },
            { name: 'set another webhook', run: () => bot.change({ webhook: 'https://hook.example/b' }) },
            { name: 'clear the webhook', run: () => bot.change({ webhook: null }) },
            { name: 'set its header', run: () => bot.change({ auth: "Bearer it's" }) },
            { name: 'clear its header', run: () => bot.change({ auth: null }) },
            { name: 'set a plugin’s key', run: () => kept.set(PLUGIN_KEY, 'sk-live-1') },
            { name: 'clear a plugin’s key', run: () => kept.set(PLUGIN_KEY, undefined) },
          ],
          durable: () => {
            const { token, webhook, auth } = bot.config();
            return { token: token !== undefined, ...(webhook && { webhook }), ...(auth && { auth }), pluginKey: secretSetBy(PLUGIN_KEY, {}, kept) };
          },
          settle: () => Promise.resolve(),
          restart: () => life(),
        };
      };
      return life();
    },
  };
}

const secrets = secretsSubject((file) => new Secrets(file));

describe('the secrets file, under Focus’s two rules', () => {
  it('ends a restart as if a change had never started, or had finished', async () => {
    await checkRestart(secrets, { runs: 30 });
    // a write per action, 30 runs: slow on a busy machine, so more than vitest's 5 s
  }, 30_000);

  it('ends two changes at once as one after the other would', async () => {
    await checkAtOnce(secrets, { runs: 30 });
  }, 30_000);

  // docs/settings.md: "What you set in Settings is kept across a restart"
  it('keeps what the captain set across a restart, and forgets what they cleared', async () => {
    const r = await secrets.start((_l, work) => work());
    for (const name of ['make a token', 'set the webhook', 'set its header', 'clear its header', 'set a plugin’s key']) r.actions().find((a) => a.name === name)?.run();
    expect((await r.restart((_l, work) => work())).durable()).toEqual({ token: true, webhook: 'https://hook.example/a', pluginKey: 'captain' });
  });

  it('reaches a file with everything set, and with everything cleared again', async () => {
    const r = await secrets.start((_l, work) => work());
    const take = (name: string) => r.actions().find((a) => a.name === name)?.run();
    for (const name of ['make a token', 'set another webhook', 'set its header']) take(name);
    take('set a plugin’s key');
    expect(r.durable()).toEqual({ token: true, webhook: 'https://hook.example/b', auth: "Bearer it's", pluginKey: 'captain' });
    for (const name of ['clear the token', 'clear the webhook', 'clear its header', 'clear a plugin’s key']) take(name);
    expect(r.durable()).toEqual({ token: false, pluginKey: null });
  });

  it('catches a break: changes kept in memory, never written', async () => {
    const forgetful: Keeper = () => {
      const held = new Map<SecretName, string>();
      return { get: (n) => held.get(n), set: (n, v) => void (v === undefined ? held.delete(n) : held.set(n, v)) };
    };
    await expect(checkRestart(secretsSubject(forgetful), { runs: 30 })).rejects.toThrow('restarted during');
  }, 30_000);
});
