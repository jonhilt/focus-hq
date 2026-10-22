import crypto from 'node:crypto';
import type { Agent } from '../../plugin-api/server';
import { errorMessage } from '../../plugin-api/server';
import { type BotEvent, botEvents, type BotSeen, heard, shownBy } from './botEvents';
import type { DecisionEvent, InboxItem } from './inbox';

// A bot speaking for the captain (Grok Bot, over Tailscale: docs/ledger.md#the-captains-inbox-api). It answers the
// inbox on the /api/bot routes with Focus's bot token (the plugin's routes for bots), and hears what changes there on
// its webhook, each delivery signed with that token, so it can tell Focus's from anyone else's.

/** A delivery's signature: HMAC-SHA256, keyed by the bot token, of its timestamp, a dot, and its body. */
export const signature = (token: string, timestamp: string, body: string): string =>
  `sha256=${crypto.createHmac('sha256', token).update(`${timestamp}.${body}`).digest('hex')}`;

/**
 * The Authorization header value for the bot's webhook (`FOCUS_BOT_WEBHOOK_AUTH`). A leading `Authorization:` is
 * stripped so pasting a full header line works; empty after that is unset.
 */
export function webhookAuth(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  const stripped = value.startsWith('Authorization:') ? value.slice('Authorization:'.length).trim() : value;
  return stripped || undefined;
}

/** An item with the links to what was shown made whole, from Focus's address as the bot reaches it (`base`), when it's known. */
export function itemWithLinks(item: InboxItem, base: string | undefined): InboxItem {
  if (!base || !item.shown) return item;
  return { ...item, shown: item.shown.map((s) => ({ ...s, html: `${base}${s.html}`, ...(s.image && { image: `${base}${s.image}` }) })) };
}

/** An event with its links made whole, as `itemWithLinks`. */
export function withLinks(e: BotEvent, base: string | undefined): BotEvent {
  if (!base) return e;
  if (e.event === 'shown') return { ...e, html: `${base}${e.html}`, ...(e.image && { image: `${base}${e.image}` }) };
  if (e.event === 'item-opened') return { ...e, item: itemWithLinks(e.item, base) };
  return e;
}

/** How things stand for the bot: what's waiting, what was decided lately, and the leads, for what they've shown. */
export interface BotLook {
  open: InboxItem[];
  decided: DecisionEvent[];
  leads: Agent[];
}

type Post = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

/**
 * Tells the bot's webhook what changed since it last looked (`tick`, every few seconds): what it hears of when the
 * Focus starts is what's there already, which it reads from the inbox, so nothing is sent for that.
 */
export class BotHook {
  private seen: BotSeen | undefined;
  private ticking = false;

  constructor(
    private readonly look: () => BotLook,
    private readonly bot: { token: string; webhook: string; publicUrl?: string; auth?: string },
    private readonly post: Post = fetch,
  ) {}

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const { open, decided, leads } = this.look();
      const now: BotSeen = { items: heard(open), shown: shownBy(leads) };
      const before = this.seen;
      this.seen = now;
      if (before) for (const e of botEvents(before, now, decided, leads)) await this.send(e);
    } finally {
      this.ticking = false;
    }
  }

  /** Posts one event, signed; one that doesn't land is logged, not sent again (the bot can always read the inbox). */
  private async send(e: BotEvent): Promise<void> {
    const body = JSON.stringify({ ...withLinks(e, this.bot.publicUrl), at: Date.now() });
    const timestamp = String(Date.now());
    const auth = webhookAuth(this.bot.auth);
    const headers = {
      'content-type': 'application/json',
      'x-focus-event': e.event,
      'x-focus-timestamp': timestamp,
      'x-focus-signature': signature(this.bot.token, timestamp, body),
      ...(auth && { authorization: auth }),
    };
    try {
      const res = await this.post(this.bot.webhook, { method: 'POST', headers, body, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) console.warn(`[chief-of-staff] the bot’s webhook answered ${e.event} with ${res.status}`);
    } catch (err) {
      console.warn(`[chief-of-staff] sending ${e.event} to the bot’s webhook failed: ${errorMessage(err)}`);
    }
  }
}
