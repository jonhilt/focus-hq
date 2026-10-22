// What the captain sets from the browser that mustn't reach it again, or the agents: the bot's token, say. Kept in
// <data>/secrets.env (KEY=value, like a .env, so it can be edited by hand too), readable by the captain alone, and
// never loaded into process.env, which every agent's session is handed a copy of (`agentEnv`). An environment
// variable of the same name wins over the file (docs/settings.md).
import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';

/** The names the file keeps, each the environment variable that overrides it. */
export const SECRET_NAMES = ['FOCUS_BOT_TOKEN', 'FOCUS_BOT_WEBHOOK', 'FOCUS_BOT_WEBHOOK_AUTH'] as const;
export type SecretName = (typeof SECRET_NAMES)[number];

/**
 * The environment, without the secrets of Focus's own (SECRET_NAMES) that may be set in it: what Focus hands anything
 * it starts (agents' sessions, a preview's dev server, a pull request's checks, git and gh), none of which needs them.
 */
export function withoutSecrets(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const rest = { ...env };
  for (const name of SECRET_NAMES) delete rest[name];
  return rest;
}

export const isSecretName = (name: unknown): name is SecretName => SECRET_NAMES.some((n) => n === name);

const HEADER = '# Focus\'s secrets (docs/settings.md): set from Settings in the ready room, or here by hand (read as Focus starts).\n';

/** A value as a .env line keeps it: in the first of ' " ` it doesn't have (the file's quotes have no escapes). */
function quoted(value: string): string {
  const quote = ["'", '"', '`'].find((q) => !value.includes(q));
  if (!quote) throw new Error('A secret can’t have all three of \' " `');
  return `${quote}${value}${quote}`;
}

/**
 * The file's text with `name` set to `value`, or its line taken out when `value` is undefined: every other line (the
 * captain's comments, other names) as it was. A value can't span lines.
 */
export function withSecret(text: string, name: SecretName, value: string | undefined): string {
  if (value !== undefined && /[\r\n]/.test(value)) throw new Error('A secret has to fit on one line');
  const isIt = (l: string) => new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`).test(l);
  const lines = (text || HEADER).replace(/\n$/, '').split('\n');
  const at = lines.findIndex(isIt);
  const kept = lines.filter((l) => !isIt(l));
  if (value !== undefined) kept.splice(at === -1 ? kept.length : at, 0, `${name}=${quoted(value)}`);
  return `${kept.join('\n')}\n`;
}

/** The secrets the file holds, by name (anything else in it ignored); an empty value is unset. */
export function parseSecrets(text: string): Partial<Record<SecretName, string>> {
  const all = parseEnv(text);
  return Object.fromEntries(SECRET_NAMES.flatMap((n) => (all[n]?.trim() ? [[n, all[n].trim()]] : [])));
}

/** The secrets file: read as Focus starts, and written whole (to a file beside it, then renamed over it) on each change. */
export class Secrets {
  private values: Partial<Record<SecretName, string>>;

  constructor(private readonly file: string) {
    this.values = parseSecrets(this.text());
  }

  get(name: SecretName): string | undefined {
    return this.values[name];
  }

  /** Sets `name` (or clears it, with undefined or nothing but spaces), and saves the file at once. */
  set(name: SecretName, value: string | undefined): void {
    const text = withSecret(this.text(), name, value?.trim() || undefined);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, text, { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    this.values = parseSecrets(text);
  }

  private text(): string {
    try {
      return fs.readFileSync(this.file, 'utf8');
    } catch {
      return '';
    }
  }
}
