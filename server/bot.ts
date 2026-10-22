import crypto from 'node:crypto';

// A bot speaking for the captain (Grok Bot, over Tailscale: docs/ledger.md#the-captains-inbox-api). It calls the
// /api/bot routes (the plugins' routes for bots, `PluginRoute.bot`) with Focus's bot token, which these let through.

/** Whether a request's `Authorization` header carries the bot token. */
export function tokenOk(header: string | undefined, token: string): boolean {
  const given = Buffer.from(/^Bearer (.+)$/.exec(header ?? '')?.[1] ?? '');
  const want = Buffer.from(token);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

/** Lets through only requests with the bot token; with none set, there are no bot routes. */
export const botGuard =
  (token: string | undefined) =>
  (req: { headers: { authorization?: string } }, res: { status(code: number): { json(body: unknown): unknown } }, next: () => void): void => {
    if (!token) return void res.status(404).json({ error: 'No bot token is set: start Focus with FOCUS_BOT_TOKEN' });
    if (!tokenOk(req.headers.authorization, token)) return void res.status(401).json({ error: 'Send the bot token: Authorization: Bearer <token>' });
    next();
  };
