// What the captain sets from the browser that mustn't reach it again, or the agents: the bot's token, say. Kept in
// <data>/secrets.env (KEY=value, like a .env, so it can be edited by hand too), readable by the captain alone, and
// never loaded into process.env, which every agent's session is handed a copy of (`agentEnv`). An environment
// variable of the same name wins over the file (docs/settings.md).
import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { isOneOf } from '../shared/records';

/** Focus's own secrets, each the environment variable that overrides it. */
export const SECRET_NAMES = ['FOCUS_BOT_TOKEN', 'FOCUS_BOT_WEBHOOK', 'FOCUS_BOT_WEBHOOK_AUTH'] as const;
/** A secret's name: Focus's own, or one a plugin keeps (`keepSecrets`). */
export type SecretName = string;

/**
 * What a plugin's secret can be called: an environment variable's name ending in _KEY, _TOKEN or _SECRET, so a plugin
 * can't keep PATH or HOME from what Focus starts (`withoutSecrets`).
 */
export const PLUGIN_SECRET = /^[A-Z][A-Z0-9_]*_(?:KEY|TOKEN|SECRET)$/;

/** Every name the file keeps: Focus's own, and those the plugins switched on keep. */
const kept = new Set<string>(SECRET_NAMES);

/** The plugins' secrets, kept too from as Focus starts them: a name that isn't a PLUGIN_SECRET, or is Focus's own, is refused. */
export function keepSecrets(names: readonly string[]): void {
  const wrong = names.find((n) => !PLUGIN_SECRET.test(n));
  if (wrong) throw new Error(`A plugin's secret is named like an API key (OPENAI_API_KEY): "${wrong}" isn't`);
  const focus = names.find((n) => isOneOf(SECRET_NAMES, n));
  if (focus) throw new Error(`${focus} is Focus’s own secret: a plugin can’t keep it`);
  for (const name of names) kept.add(name);
}

export const isSecretName = (name: string): boolean => kept.has(name);

/**
 * The environment, without the secrets the file keeps (Focus's own and the plugins') that may be set in it: what Focus
 * hands anything it starts (agents' sessions, a preview's dev server, a pull request's checks, git and gh), none of
 * which needs them.
 */
export function withoutSecrets(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const rest = { ...env };
  for (const name of kept) delete rest[name];
  return rest;
}

const HEADER = '# Focus\'s secrets (docs/settings.md): set from Settings or the Plugins tab in the ready room, or here by hand (read as Focus starts).\n';

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
  if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) throw new Error(`"${name}" isn't a secret's name`);
  if (value !== undefined && /[\r\n]/.test(value)) throw new Error('A secret has to fit on one line');
  const isIt = (l: string) => new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`).test(l);
  const lines = (text || HEADER).replace(/\n$/, '').split('\n');
  const at = lines.findIndex(isIt);
  const kept = lines.filter((l) => !isIt(l));
  if (value !== undefined) kept.splice(at === -1 ? kept.length : at, 0, `${name}=${quoted(value)}`);
  return `${kept.join('\n')}\n`;
}

/** The secrets the file holds, by name (anything but `names` ignored); an empty value is unset. */
export function parseSecrets(text: string, names: Iterable<string> = kept): Partial<Record<SecretName, string>> {
  const all = parseEnv(text);
  return Object.fromEntries([...names].flatMap((n) => (all[n]?.trim() ? [[n, all[n].trim()]] : [])));
}

/** Where secret `name` is set: its environment variable (which wins), the file (the captain's), or nowhere. */
export function secretSetBy(name: SecretName, env: NodeJS.ProcessEnv, file: { get(name: SecretName): string | undefined }): 'env' | 'captain' | null {
  if (env[name]?.trim()) return 'env';
  return file.get(name) ? 'captain' : null;
}

/** The secrets file: read as Focus starts, and written whole (to a file beside it, then renamed over it) on each change. */
export class Secrets {
  /** Everything the file holds, a plugin's secrets among them though it starts after the file's read. */
  private values: Partial<Record<SecretName, string>>;

  constructor(private readonly file: string) {
    this.values = parseSecrets(this.text(), Object.keys(parseEnv(this.text())));
  }

  /** A secret the file keeps (`isSecretName`): anything else in it is no one's. */
  get(name: SecretName): string | undefined {
    return isSecretName(name) ? this.values[name] : undefined;
  }

  /** Sets `name` (or clears it, with undefined or nothing but spaces), and saves the file at once. */
  set(name: SecretName, value: string | undefined): void {
    if (!isSecretName(name)) throw new Error(`Focus keeps no secret called ${name}`);
    const text = withSecret(this.text(), name, value?.trim() || undefined);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, text, { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    this.values = parseSecrets(text, Object.keys(parseEnv(text)));
  }

  private text(): string {
    try {
      return fs.readFileSync(this.file, 'utf8');
    } catch {
      return '';
    }
  }
}
