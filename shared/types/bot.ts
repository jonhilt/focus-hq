// A bot speaking for the captain (server/bot.ts), as the ready room's Settings shows it: where each of its settings
// comes from, never the secrets themselves.

/** An environment variable's (which the browser can't change), the captain's from Settings, or none. */
export type SetBy = 'env' | 'captain' | null;

export interface BotStatus {
  /** Opens the /api/bot routes to the bot, and signs what its webhook is sent. */
  token: SetBy;
  /** Where Focus tells the bot what changed: only its host is shown, as its path is often its secret. */
  webhook: { by: SetBy; host?: string };
  /** Sent as Authorization on each delivery to the webhook. */
  auth: SetBy;
  /** Focus's address as the bot reaches it, which makes the links it's sent whole. */
  publicUrl: { by: SetBy; url?: string };
}

/** What the captain changes from Settings: a string sets it, null (or an empty one) clears it, missing leaves it be. */
export interface BotChange {
  /** A token of the captain's own (the bot's they already have), rather than one Focus makes. */
  token?: string | null;
  webhook?: string | null;
  auth?: string | null;
}
