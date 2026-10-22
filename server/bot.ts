import crypto from 'node:crypto';
import type { BotChange, BotStatus, SetBy } from '../shared/types';
import type { SecretName } from './secrets';

// A bot speaking for the captain (Grok Bot, over Tailscale: docs/ledger.md#the-captains-inbox-api). It calls the
// /api/bot routes (the plugins' routes for bots, `PluginRoute.bot`) with Focus's bot token, which these let through.

/** Whether a request's `Authorization` header carries the bot token. */
export function tokenOk(header: string | undefined, token: string): boolean {
  const given = Buffer.from(/^Bearer (.+)$/.exec(header ?? '')?.[1] ?? '');
  const want = Buffer.from(token);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

/** Lets through only requests with the bot token, as it is now; with none set, there are no bot routes. */
export const botGuard =
  (tokenNow: () => string | undefined) =>
  (req: { headers: { authorization?: string } }, res: { status(code: number): { json(body: unknown): unknown } }, next: () => void): void => {
    const token = tokenNow();
    if (!token) return void res.status(404).json({ error: 'No bot token is set: make one in Settings, or start Focus with FOCUS_BOT_TOKEN' });
    if (!tokenOk(req.headers.authorization, token)) return void res.status(401).json({ error: 'Send the bot token: Authorization: Bearer <token>' });
    next();
  };

/** The bot as Focus uses it now (`PluginHost.bot`). */
export interface BotConfig {
  token?: string;
  webhook?: string;
  auth?: string;
  publicUrl?: string;
}

/**
 * An http(s) address as Focus keeps one: trimmed, without a trailing slash. '' when there's nothing but spaces (unset),
 * undefined when it isn't one.
 */
export function httpUrl(raw: string): string | undefined {
  const url = raw.trim().replace(/\/+$/, '');
  if (!url) return '';
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol) ? url : undefined;
  } catch {
    return undefined;
  }
}

/** The captain's change to the bot (PATCH /api/settings/bot, any JSON): each of `webhook` and `auth` a string or null, anything else ignored. */
export function botChange(body: unknown): BotChange {
  const b: Partial<Record<keyof BotChange, unknown>> = body !== null && typeof body === 'object' ? body : {};
  const one = (v: unknown) => (typeof v === 'string' || v === null ? v : undefined);
  const [webhook, auth] = [one(b.webhook), one(b.auth)];
  return { ...(webhook !== undefined && { webhook }), ...(auth !== undefined && { auth }) };
}

/** A new bot token: 32 random bytes, as base64url. */
export const newBotToken = (): string => crypto.randomBytes(32).toString('base64url');

/** Where Focus keeps what the captain sets, as `BotSetup` reads and writes it. */
interface Kept {
  secrets: { get(name: SecretName): string | undefined; set(name: SecretName, value: string | undefined): void };
  /** The captain's `Settings.publicUrl`. */
  publicUrl(): string | undefined;
}

const ENV_OF = { token: 'FOCUS_BOT_TOKEN', webhook: 'FOCUS_BOT_WEBHOOK', auth: 'FOCUS_BOT_WEBHOOK_AUTH' } as const satisfies Record<string, SecretName>;

/**
 * The bot's settings, each from its environment variable where that's set (FOCUS_BOT_TOKEN, FOCUS_BOT_WEBHOOK,
 * FOCUS_BOT_WEBHOOK_AUTH, FOCUS_PUBLIC_URL), else what the captain set in Settings: the secrets in the secrets file
 * (server/secrets.ts), the public address in `Settings`. Read afresh each time, so a change applies at once.
 */
export class BotSetup {
  constructor(
    private readonly kept: Kept,
    private readonly env: Record<string, string | undefined> = process.env,
  ) {}

  private fromEnv(name: string): string | undefined {
    return this.env[name]?.trim() || undefined;
  }

  private secret(key: keyof typeof ENV_OF): { by: SetBy; value?: string } {
    const env = this.fromEnv(ENV_OF[key]);
    if (env) return { by: 'env', value: env };
    const saved = this.kept.secrets.get(ENV_OF[key]);
    return saved ? { by: 'captain', value: saved } : { by: null };
  }

  private publicUrl(): { by: SetBy; url?: string } {
    const env = this.fromEnv('FOCUS_PUBLIC_URL')?.replace(/\/+$/, '');
    if (env) return { by: 'env', url: env };
    const saved = this.kept.publicUrl();
    return saved ? { by: 'captain', url: saved } : { by: null };
  }

  config(): BotConfig {
    const [token, webhook, auth, publicUrl] = [this.secret('token').value, this.secret('webhook').value, this.secret('auth').value, this.publicUrl().url];
    return { ...(token && { token }), ...(webhook && { webhook }), ...(auth && { auth }), ...(publicUrl && { publicUrl }) };
  }

  status(): BotStatus {
    const webhook = this.secret('webhook');
    const host = webhook.value && URL.parse(webhook.value)?.host;
    return { token: this.secret('token').by, webhook: { by: webhook.by, ...(host && { host }) }, auth: this.secret('auth').by, publicUrl: this.publicUrl() };
  }

  /** The captain's change to the webhook or its Authorization header: refused for one an environment variable sets. */
  change(change: BotChange): BotStatus {
    if (change.webhook !== undefined && change.webhook !== null && !httpUrl(change.webhook)) throw new Error('The webhook has to be an http(s) address');
    for (const key of ['webhook', 'auth'] as const) {
      const value = change[key];
      if (value === undefined) continue;
      this.mayChange(key);
      this.kept.secrets.set(ENV_OF[key], value === null ? undefined : key === 'webhook' ? httpUrl(value) : value);
    }
    return this.status();
  }

  /** A new token, saved, and told the captain this once (to give the bot): the one before stops working. */
  newToken(): string {
    this.mayChange('token');
    const token = newBotToken();
    this.kept.secrets.set(ENV_OF.token, token);
    return token;
  }

  /** Clears the token: no bot routes, and nothing sent to the webhook. */
  clearToken(): BotStatus {
    this.mayChange('token');
    this.kept.secrets.set(ENV_OF.token, undefined);
    return this.status();
  }

  private mayChange(key: keyof typeof ENV_OF): void {
    if (this.fromEnv(ENV_OF[key])) throw new Error(`${ENV_OF[key]} is set in Focus's environment: change it there, or unset it to change it here`);
  }
}
