import { describe, expect, it } from 'vitest';
import { botChange, BotSetup, botGuard, httpUrl, tokenOk } from './bot';

describe('the bot token', () => {
  it('lets through only the token, as a bearer', () => {
    expect(tokenOk('Bearer s3cret', 's3cret')).toBe(true);
    expect(tokenOk('Bearer s3cre', 's3cret')).toBe(false);
    expect(tokenOk('s3cret', 's3cret')).toBe(false);
    expect(tokenOk(undefined, 's3cret')).toBe(false);
  });

  it('guards the bot routes: none without a token set, refused without the token', () => {
    const run = (token: string | undefined, authorization?: string) => {
      const out: { code?: number; next?: boolean } = {};
      botGuard(() => token)({ headers: { authorization } }, { status: (code) => ((out.code = code), { json: () => undefined }) }, () => (out.next = true));
      return out;
    };
    expect(run(undefined, 'Bearer x')).toEqual({ code: 404 });
    expect(run('x')).toEqual({ code: 401 });
    expect(run('x', 'Bearer x')).toEqual({ next: true });
  });
});

describe('the bot’s setup', () => {
  const setup = (env: Record<string, string> = {}, publicUrl?: string) => {
    const kept = new Map<string, string>();
    const secrets = { get: (n: string) => kept.get(n), set: (n: string, v: string | undefined) => void (v === undefined ? kept.delete(n) : kept.set(n, v)) };
    return { bot: new BotSetup({ secrets, publicUrl: () => publicUrl }, env), kept };
  };

  it('has nothing set to begin with', () => {
    expect(setup().bot.config()).toEqual({});
    expect(setup().bot.status()).toEqual({ token: null, webhook: { by: null }, auth: null, publicUrl: { by: null } });
  });

  it('takes the captain’s, and tells the browser only where each comes from and the webhook’s host', () => {
    const { bot } = setup({}, 'https://focus.ts.net');
    const token = bot.newToken();
    bot.change({ webhook: 'https://hook.example/s3cret/', auth: 'Bearer x' });
    expect(bot.config()).toEqual({ token, webhook: 'https://hook.example/s3cret', auth: 'Bearer x', publicUrl: 'https://focus.ts.net' });
    expect(JSON.stringify(bot.status())).not.toMatch(/s3cret|Bearer/);
    expect(JSON.stringify(bot.status())).not.toContain(token);
    expect(bot.status()).toEqual({ token: 'captain', webhook: { by: 'captain', host: 'hook.example' }, auth: 'captain', publicUrl: { by: 'captain', url: 'https://focus.ts.net' } });
  });

  it('makes a new token each time, and clears it', () => {
    const { bot } = setup();
    const first = bot.newToken();
    expect(first).toMatch(/^[\w-]{43}$/);
    expect(bot.newToken()).not.toBe(first);
    bot.clearToken();
    expect(bot.config().token).toBeUndefined();
  });

  it('lets an environment variable win, and refuses to change one it sets', () => {
    const { bot, kept } = setup({ FOCUS_BOT_TOKEN: 'env', FOCUS_PUBLIC_URL: 'https://env.ts.net/' }, 'https://mine');
    kept.set('FOCUS_BOT_TOKEN', 'saved');
    expect(bot.config()).toMatchObject({ token: 'env', publicUrl: 'https://env.ts.net' });
    expect(bot.status()).toMatchObject({ token: 'env', publicUrl: { by: 'env' } });
    expect(() => bot.newToken()).toThrow('FOCUS_BOT_TOKEN is set in Focus');
    expect(() => bot.clearToken()).toThrow('FOCUS_BOT_TOKEN');
    expect(kept.get('FOCUS_BOT_TOKEN')).toBe('saved');
  });

  it('takes a token of the captain’s own, refusing a short one or one with spaces', () => {
    const { bot } = setup();
    bot.change({ token: '  the-bots-own-token-123  ' });
    expect(bot.config().token).toBe('the-bots-own-token-123');
    expect(bot.status().token).toBe('captain');
    expect(() => bot.change({ token: 'short' })).toThrow('at least 16');
    expect(() => bot.change({ token: 'has a space in it, so no' })).toThrow('no spaces');
    expect(bot.config().token).toBe('the-bots-own-token-123');
    bot.change({ token: null });
    expect(bot.config().token).toBeUndefined();
  });

  it('refuses the captain’s own token where FOCUS_BOT_TOKEN is set, changing nothing else in that change', () => {
    const { bot } = setup({ FOCUS_BOT_TOKEN: 'from-the-environment' });
    expect(() => bot.change({ token: 'a-token-of-my-own-here', webhook: 'https://h/x' })).toThrow('FOCUS_BOT_TOKEN');
    expect(bot.config()).toEqual({ token: 'from-the-environment' });
  });

  it('clears a field left empty, as Clear does', () => {
    const { bot } = setup();
    bot.change({ webhook: 'https://h/x', auth: 'a' });
    bot.change({ webhook: '', auth: '  ' });
    expect(bot.config()).toEqual({});
  });

  it('clears the webhook and its header with null, and refuses a webhook that isn’t an http(s) address', () => {
    const { bot } = setup();
    bot.change({ webhook: 'https://h/x', auth: 'a' });
    bot.change({ webhook: null, auth: null });
    expect(bot.config()).toEqual({});
    expect(() => bot.change({ webhook: 'ftp://h' })).toThrow('http(s)');
    expect(() => bot.change({ webhook: 'not a url' })).toThrow('http(s)');
  });
});

describe('the captain’s change to the bot', () => {
  it('takes a string or null for each, and nothing else', () => {
    expect(botChange({ webhook: 'https://h', auth: null, token: 'x', other: 'y' })).toEqual({ token: 'x', webhook: 'https://h', auth: null });
    expect(botChange({ webhook: 3 })).toEqual({});
    expect(botChange(null)).toEqual({});
  });
});

describe('an http(s) address', () => {
  it('is trimmed, without a trailing slash; empty is unset; anything else isn’t one', () => {
    expect(httpUrl(' https://a.b/c// ')).toBe('https://a.b/c');
    expect(httpUrl('  ')).toBe('');
    expect(httpUrl('javascript:alert(1)')).toBeUndefined();
    expect(httpUrl('nope')).toBeUndefined();
  });
});
