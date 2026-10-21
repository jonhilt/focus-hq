import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { InboxItem } from '../shared/captainsInbox';
import { botGuard, BotHook, type BotLook, signature, tokenOk, withLinks } from './bot';

const item = (id: string, shown?: InboxItem['shown']): InboxItem => ({ id, kind: 'turn', projectId: 'p', agentId: 'a', who: 'Lt. Reyes', goal: 'Saved items', what: 'Slice 2?', lane: 'needs-you', ...(shown && { shown }) });

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
      botGuard(token)({ headers: { authorization } }, { status: (code) => ((out.code = code), { json: () => undefined }) }, () => (out.next = true));
      return out;
    };
    expect(run(undefined, 'Bearer x')).toEqual({ code: 404 });
    expect(run('x')).toEqual({ code: 401 });
    expect(run('x', 'Bearer x')).toEqual({ next: true });
  });

  it('signs a delivery as HMAC-SHA256 of its timestamp and body, which the bot can check', () => {
    const want = crypto.createHmac('sha256', 'k').update('100.{"a":1}').digest('hex');
    expect(signature('k', '100', '{"a":1}')).toBe(`sha256=${want}`);
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
    const hook = new BotHook(() => look, { token: 'k', webhook: 'https://grok/hook' }, async (url, init) => {
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
  });

  it('carries on when the webhook fails', async () => {
    let look: BotLook = { open: [], decided: [], leads: [] };
    const hook = new BotHook(() => look, { token: 'k', webhook: 'https://grok/hook' }, () => Promise.reject(new Error('down')));
    await hook.tick();
    look = { ...look, open: [item('t1')] };
    await expect(hook.tick()).resolves.toBeUndefined();
  });
});
