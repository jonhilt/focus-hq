import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BotHook, type BotLook, signature, webhookAuth, withLinks } from './botHook';
import type { InboxItem } from './inbox';

const item = (id: string, shown?: InboxItem['shown']): InboxItem => ({ id, kind: 'turn', projectId: 'p', agentId: 'a', who: 'Lt. Reyes', goal: 'Saved items', what: 'Slice 2?', lane: 'needs-you', ...(shown && { shown }) });

describe('a delivery to the bot', () => {
  it('signs a delivery as HMAC-SHA256 of its timestamp and body, which the bot can check', () => {
    const want = crypto.createHmac('sha256', 'k').update('100.{"a":1}').digest('hex');
    expect(signature('k', '100', '{"a":1}')).toBe(`sha256=${want}`);
  });

  it('sends FOCUS_BOT_WEBHOOK_AUTH as Authorization, stripping a pasted header line, and is unset when that’s empty', () => {
    expect(webhookAuth(undefined)).toBeUndefined();
    expect(webhookAuth('  ')).toBeUndefined();
    expect(webhookAuth('Bearer grok-secret')).toBe('Bearer grok-secret');
    expect(webhookAuth('Authorization: Bearer grok-secret')).toBe('Bearer grok-secret');
    expect(webhookAuth('Authorization:Bearer grok-secret')).toBe('Bearer grok-secret');
    expect(webhookAuth('Authorization:   ')).toBeUndefined();
  });
});

describe('withLinks', () => {
  it('makes the links whole from Focus’s address, when it’s known', () => {
    const shown = { event: 'shown' as const, projectId: 'p', agentId: 'a', who: 'R', goal: 'G', title: 'T', html: '/api/artifacts/a/t.html?v=1', image: '/api/artifacts/a/t.jpg?v=1' };
    expect(withLinks(shown, 'https://mac.ts.net:4477')).toMatchObject({ html: 'https://mac.ts.net:4477/api/artifacts/a/t.html?v=1', image: 'https://mac.ts.net:4477/api/artifacts/a/t.jpg?v=1' });
    expect(withLinks(shown, undefined)).toBe(shown);
    const opened = { event: 'item-opened' as const, item: item('t1', [{ title: 'T', html: '/x.html' }]) };
    expect(withLinks(opened, 'https://o')).toMatchObject({ item: { shown: [{ html: 'https://o/x.html' }] } });
  });
});

describe('BotHook', () => {
  it('sends nothing for what was there when Focus started, then each change, signed', async () => {
    let look: BotLook = { open: [item('t1')], decided: [], leads: [] };
    const posts: { url: string; headers: Record<string, string>; body: string }[] = [];
    const hook = new BotHook(() => look, () => ({ token: 'k', webhook: 'https://grok/hook' }), async (url, init) => {
      posts.push({ url, headers: init.headers, body: init.body });
      return { ok: true, status: 200 };
    });
    await hook.tick();
    expect(posts).toEqual([]);
    look = { ...look, open: [item('t1'), item('t2')] };
    await hook.tick();
    expect(posts).toHaveLength(1);
    const [post] = posts;
    expect(post.url).toBe('https://grok/hook');
    expect(JSON.parse(post.body)).toMatchObject({ event: 'item-opened', item: { id: 't2' } });
    expect(post.headers).toMatchObject({ 'x-focus-event': 'item-opened', 'x-focus-signature': signature('k', post.headers['x-focus-timestamp'], post.body) });
    expect(post.headers.authorization).toBeUndefined();
  });

  it('sends Authorization when the webhook auth is set, still signed the same way, and never logs the value', async () => {
    const posts: { headers: Record<string, string>; body: string }[] = [];
    const warned: string[] = [];
    const warn = console.warn;
    console.warn = (text: string) => void warned.push(text);
    try {
      let look: BotLook = { open: [], decided: [], leads: [] };
      const hook = new BotHook(() => look, () => ({ token: 'k', webhook: 'https://grok/hook', auth: 'Authorization: Bearer grok-secret' }), async (_url, init) => {
        posts.push({ headers: init.headers, body: init.body });
        return { ok: false, status: 401 };
      });
      await hook.tick();
      look = { ...look, open: [item('t1')] };
      await hook.tick();
    } finally {
      console.warn = warn;
    }
    expect(posts).toHaveLength(1);
    const [post] = posts;
    expect(post.headers.authorization).toBe('Bearer grok-secret');
    expect(post.headers['x-focus-signature']).toBe(signature('k', post.headers['x-focus-timestamp'], post.body));
    expect(warned.join('\n')).toMatch(/item-opened/);
    expect(warned.join('\n')).not.toMatch(/grok-secret/);
  });

  it('carries on when the webhook fails', async () => {
    let look: BotLook = { open: [], decided: [], leads: [] };
    const hook = new BotHook(() => look, () => ({ token: 'k', webhook: 'https://grok/hook' }), () => Promise.reject(new Error('down')));
    await hook.tick();
    look = { ...look, open: [item('t1')] };
    await expect(hook.tick()).resolves.toBeUndefined();
  });

  it('sends nothing without a token and a webhook, and once given them, nothing for what was there already', async () => {
    let bot: { token?: string; webhook?: string } = {};
    let look: BotLook = { open: [item('t1')], decided: [], leads: [] };
    const posts: string[] = [];
    const hook = new BotHook(() => look, () => bot, async (url) => {
      posts.push(url);
      return { ok: true, status: 200 };
    });
    await hook.tick();
    look = { ...look, open: [item('t1'), item('t2')] };
    await hook.tick();
    bot = { token: 'k', webhook: 'https://grok/hook' };
    await hook.tick();
    expect(posts).toEqual([]);
    look = { ...look, open: [item('t1'), item('t2'), item('t3')] };
    await hook.tick();
    expect(posts).toEqual(['https://grok/hook']);
  });
});
