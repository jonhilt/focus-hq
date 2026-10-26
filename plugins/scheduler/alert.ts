// Telling the captain directly, not through anyone's routing: a toast, a line in the ship's log, and, when Focus has
// a bot speaking for the captain, an `alert` on its webhook (docs/ledger.md#the-captains-inbox-api), signed as every
// delivery there is, so it reaches their phone while they're away from the ship.
import crypto from 'node:crypto';
import type { PluginHost } from '../../plugin-api/server';
import { errorMessage } from '../../plugin-api/server';
import { SCHEDULER } from './shared';

/** What the captain is alerted of: who it's about, in which project, and what they're told. */
export interface Alert {
  projectId: string;
  agentId: string;
  agentName: string;
  goal?: string;
  text: string;
}

/** The webhook's body for an alert, as every delivery's: `event` and `at`, then what it's about. */
export const alertBody = (a: Alert, at: number) => JSON.stringify({ event: 'alert', by: SCHEDULER, agent: a.agentName, agentId: a.agentId, ...(a.goal && { goal: a.goal }), text: a.text, at });

/** A delivery's signature, as the bot checks every one: HMAC-SHA256, keyed by the bot token, of its timestamp, a dot, and its body. */
export const signature = (token: string, timestamp: string, body: string): string =>
  `sha256=${crypto.createHmac('sha256', token).update(`${timestamp}.${body}`).digest('hex')}`;

type Post = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

/** The bot's webhook's Authorization header, as Settings has it (a pasted `Authorization:` prefix taken off). */
const authHeader = (raw: string | undefined) => raw?.trim().replace(/^Authorization:\s*/, '') || undefined;

/** Alerts the captain: toast, ledger, and the bot's webhook if there is one (a delivery that fails is logged, not sent again). */
export async function alertCaptain(host: Pick<PluginHost, 'toast' | 'record' | 'bot'>, a: Alert, now: number, post: Post = fetch): Promise<void> {
  host.toast('error', a.text, a.agentId);
  host.record(a.projectId, { kind: 'alert', by: SCHEDULER, agent: a.agentName, ...(a.goal && { goal: a.goal }), text: a.text }, now);
  const { token, webhook, auth } = host.bot;
  if (!token || !webhook) return;
  const body = alertBody(a, now);
  const timestamp = String(now);
  const authorization = authHeader(auth);
  const headers = { 'content-type': 'application/json', 'x-focus-event': 'alert', 'x-focus-timestamp': timestamp, 'x-focus-signature': signature(token, timestamp, body), ...(authorization && { authorization }) };
  try {
    const res = await post(webhook, { method: 'POST', headers, body, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) console.warn(`[scheduler] the bot’s webhook answered an alert with ${res.status}`);
  } catch (err) {
    console.warn(`[scheduler] sending an alert to the bot’s webhook failed: ${errorMessage(err)}`);
  }
}
