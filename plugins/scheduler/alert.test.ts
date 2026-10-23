import { describe, expect, it } from 'vitest';
import { type Alert, ALERT_GAP_MS, alertBody, alertCaptain, alertWait, signature } from './alert';

const ALERT: Alert = { projectId: 'p', agentId: 'lead-1', agentName: 'Novak', goal: 'Backtest Jev', text: 'Novak hasn’t answered the 15:07 check (sch-1) after 20 min.' };
const AT = Date.parse('2026-10-23T14:27:00Z');

/** A host lending the toast, the ledger and the bot's settings, keeping what it's given. */
function host(bot: { token?: string; webhook?: string; auth?: string } = {}) {
  const toasts: unknown[] = [];
  const records: unknown[] = [];
  return { toasts, records, host: { toast: (...t: unknown[]) => void toasts.push(t), record: (...r: unknown[]) => void records.push(r), bot } };
}

describe('alerting the captain', () => {
  it('toasts and writes the ship’s log, and leaves the webhook be with no bot set', async () => {
    const o = host();
    const posts: unknown[] = [];
    await alertCaptain(o.host, ALERT, AT, (url) => (posts.push(url), Promise.resolve({ ok: true, status: 200 })));
    expect(o.toasts).toEqual([['error', ALERT.text, 'lead-1']]);
    expect(o.records).toEqual([['p', { kind: 'alert', by: 'scheduler', agent: 'Novak', goal: 'Backtest Jev', text: ALERT.text }, AT]]);
    expect(posts).toEqual([]);
  });

  it('posts a signed alert to the bot’s webhook, with its header', async () => {
    const o = host({ token: 'tok', webhook: 'https://hook.example/x', auth: 'Authorization: Bearer abc' });
    const posts: { url: string; headers: Record<string, string>; body: string }[] = [];
    await alertCaptain(o.host, ALERT, AT, (url, init) => (posts.push({ url, headers: init.headers, body: init.body }), Promise.resolve({ ok: true, status: 200 })));
    const body = alertBody(ALERT, AT);
    expect(JSON.parse(body)).toEqual({ event: 'alert', by: 'scheduler', agent: 'Novak', agentId: 'lead-1', goal: 'Backtest Jev', text: ALERT.text, at: AT });
    expect(posts).toEqual([{
      url: 'https://hook.example/x',
      body,
      headers: { 'content-type': 'application/json', 'x-focus-event': 'alert', 'x-focus-timestamp': String(AT), 'x-focus-signature': signature('tok', String(AT), body), authorization: 'Bearer abc' },
    }]);
  });

  it('lets a lead alert at most every 10 minutes', () => {
    expect(alertWait(undefined, AT)).toBe(0);
    expect(alertWait(AT, AT + 60_000)).toBe(ALERT_GAP_MS - 60_000);
    expect(alertWait(AT, AT + ALERT_GAP_MS)).toBe(0);
  });

  it('still toasts and logs when the webhook fails', async () => {
    const o = host({ token: 'tok', webhook: 'https://hook.example/x' });
    await alertCaptain(o.host, ALERT, AT, () => Promise.reject(new Error('offline')));
    expect(o.toasts).toHaveLength(1);
    expect(o.records).toHaveLength(1);
  });
});
