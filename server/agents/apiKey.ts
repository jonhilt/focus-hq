import { clock } from '../../shared/clock';
import type { SignIn } from '../../shared/types';
import { keyBudget, keyMode, limitHit, useKey, type KeyMode, type Spell } from './apiKeyRules';

/**
 * API prices, in dollars per million tokens: input, and reading from the prompt cache. Output costs five times input,
 * and writing to the cache (for five minutes, as Claude Code does) 1.25 times. The first match wins: a bare alias
 * ('opus') is the latest of its family, and Claude Code's default is priced as Opus.
 */
const PRICES: [RegExp, number, number][] = [
  [/fable-5-1|mythos-5-1|^fable|^mythos/, 10, 0.25],
  [/fable|mythos/, 10, 1],
  [/opus-5-5|^opus/, 4, 0.2],
  [/opus/, 5, 0.5],
  [/sonnet-4/, 3, 0.3],
  [/sonnet/, 2, 0.2],
  [/haiku-4/, 1, 0.1],
  [/haiku/, 0.1, 0.01],
];
const CACHE_WRITE = 1.25;
const OUTPUT = 5;

function prices(model: string | undefined): { input: number; read: number } {
  const name = (model ?? '').toLowerCase();
  const [, input, read] = PRICES.find(([match]) => match.test(name)) ?? PRICES[2];
  return { input, read };
}

/** One request's tokens, as the API reports them. */
export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/** What one request cost on the key, in dollars. */
export function requestUsd(usage: Usage, model: string | undefined): number {
  const { input, read } = prices(model);
  const cost = (usage.input_tokens ?? 0) * input
    + (usage.cache_creation_input_tokens ?? 0) * input * CACHE_WRITE
    + (usage.cache_read_input_tokens ?? 0) * read
    + (usage.output_tokens ?? 0) * input * OUTPUT;
  return cost / 1e6;
}

/**
 * What picking a conversation of `tokens` back up on the key costs: a new sign-in has nothing in the prompt cache, so
 * Claude Code writes all of it there again.
 */
export function rereadUsd(tokens: number, model: string | undefined): number {
  return (tokens * prices(model).input * CACHE_WRITE) / 1e6;
}

/** What the captain is told when new sessions move to the key (`onKey`), or off it: its budget spent, or the plan's limit reset. */
export function signInToast(onKey: boolean, spell: Spell, budgetUsd: number, now: number): { level: 'info' | 'error' | 'success'; text: string } {
  if (onKey) return { level: 'info', text: `🔑 Your plan's usage limit is reached until ${clock(spell.until, now)}: agents carry on with your API key (up to $${budgetUsd})` };
  if (spell.until > now) return { level: 'error', text: `🔑 Your API key has spent its $${budgetUsd}: agents wait for your plan's usage limit to reset at ${clock(spell.until, now)}` };
  return { level: 'success', text: `🔑 Your plan's usage limit has reset: agents are back on it (the key spent about $${spell.spentUsd.toFixed(2)})` };
}

/**
 * Whether Focus's new sessions sign in with your login or your API key: the plan's usage limit as it stands, and
 * what the key has spent while it's reached. Every Claude Code session Focus starts asks it (`agentEnv`).
 */
export class KeyFallback {
  private spell?: Spell;
  private timer?: NodeJS.Timeout;
  /** Told when new sessions move to the key, or back to your plan (`onKey` false). */
  onChange?: (onKey: boolean, spell: Spell) => void;

  constructor(
    readonly mode: KeyMode,
    readonly budgetUsd: number,
    private readonly now: () => number = Date.now,
  ) {}

  onKey(): boolean {
    return useKey(this.mode, this.spell, this.budgetUsd, this.now());
  }

  /** When your plan's limit resets, while it's reached. */
  resetsAt(): number | undefined {
    return this.reached()?.until;
  }

  spentUsd(): number {
    return this.reached()?.spentUsd ?? 0;
  }

  /** Where Focus stands on your plan and your key now (lent to plugins as `host.signIn`). */
  signIn(): SignIn {
    return { mode: this.mode, onKey: this.onKey(), keySpentUsd: this.spentUsd(), keyBudgetUsd: this.budgetUsd };
  }

  /** The spell at the plan's limit, while it lasts. */
  private reached(): Spell | undefined {
    return this.spell && this.spell.until > this.now() ? this.spell : undefined;
  }

  /** A session ran into the plan's limit, which resets at `until`. */
  limitHit(until: number): void {
    const before = this.onKey();
    this.spell = limitHit(this.spell, until, this.now());
    this.changed(before);
    if (this.mode !== 'fallback') return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.changed(true), Math.max(0, this.spell.until - this.now()) + 1000);
    this.timer.unref();
  }

  /** A session on the key spent `usd`. */
  spent(usd: number): void {
    if (!this.spell || usd <= 0) return;
    const before = this.onKey();
    this.spell = { ...this.spell, spentUsd: this.spell.spentUsd + usd };
    this.changed(before);
  }

  private changed(before: boolean): void {
    const after = this.onKey();
    if (after !== before && this.spell && this.mode === 'fallback') this.onChange?.(after, this.spell);
  }
}

/** Focus's one: what FOCUS_USE_API_KEY, ANTHROPIC_API_KEY and FOCUS_API_BUDGET say. */
export const keyFallback = new KeyFallback(keyMode(process.env), keyBudget(process.env));
