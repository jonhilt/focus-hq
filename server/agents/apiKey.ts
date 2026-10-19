import type { SDKRateLimitInfo } from '@anthropic-ai/claude-agent-sdk';
import type { ResumeHow, SignIn } from '../../shared/types';

/**
 * How agents sign in to Claude: with your Claude login ('login'), with your API key ('key'), or with the login until
 * your plan's usage limit is reached and with the key until it resets ('fallback').
 */
export type KeyMode = SignIn['mode'];

export function keyMode(env: Record<string, string | undefined>): KeyMode {
  if (!env.ANTHROPIC_API_KEY) return 'login';
  if (env.FOCUS_USE_API_KEY === '1') return 'key';
  if (env.FOCUS_USE_API_KEY === 'fallback') return 'fallback';
  return 'login';
}

/** The most the key spends each time your plan's limit is reached, unless FOCUS_API_BUDGET says otherwise. */
export const DEFAULT_BUDGET_USD = 20;

export function keyBudget(env: Record<string, string | undefined>): number {
  const usd = Number(env.FOCUS_API_BUDGET);
  return env.FOCUS_API_BUDGET && Number.isFinite(usd) && usd >= 0 ? usd : DEFAULT_BUDGET_USD;
}

/** Your plan's usage limit, reached: until when, and what the key has spent since. */
export interface Spell {
  until: number;
  spentUsd: number;
}

/** When the plan doesn't say when its limit resets, the office tries it again after this long. */
export const UNKNOWN_RESET_MS = 60 * 60_000;

/**
 * When the usage limit a rate limit event reports resets (ms), or null when the limit stopped nothing: it wasn't
 * reached, or extra usage carries on past it.
 */
export function limitReached(info: Pick<SDKRateLimitInfo, 'status' | 'resetsAt' | 'overageStatus' | 'isUsingOverage'>, now: number): number | null {
  if (info.status !== 'rejected') return null;
  if (info.isUsingOverage || info.overageStatus === 'allowed' || info.overageStatus === 'allowed_warning') return null;
  // Claude Code reports it in seconds
  const at = info.resetsAt ? (info.resetsAt < 1e12 ? info.resetsAt * 1000 : info.resetsAt) : 0;
  return at > now ? at : now + UNKNOWN_RESET_MS;
}

/** The limit reached (again): the spell it's part of, which keeps what the key has spent, or a new one. */
export function limitHit(spell: Spell | undefined, until: number, now: number): Spell {
  if (spell && spell.until > now) return { ...spell, until: Math.max(spell.until, until) };
  return { until, spentUsd: 0 };
}

/** Whether a session starting now signs in with the key. */
export function useKey(mode: KeyMode, spell: Spell | undefined, budgetUsd: number, now: number): boolean {
  if (mode === 'key') return true;
  if (mode === 'login' || !spell || spell.until <= now) return false;
  return spell.spentUsd < budgetUsd;
}

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

/** Picking a conversation back up on the key for more than this asks the captain first. */
export const RESUME_WARN_USD = 1;

/**
 * What happens to a message that picks an agent's conversation back up, given what that costs on the key (undefined
 * when it's on your plan, or there's nothing to re-read): it goes ahead, the captain is asked first, or it's held
 * until the plan's limit resets. The captain's `how` is their answer; anyone else's news waits.
 */
export function resumeChoice(costUsd: number | undefined, how: ResumeHow | undefined, fromCaptain: boolean): 'go' | 'ask' | 'hold' {
  if (costUsd === undefined || costUsd < RESUME_WARN_USD || how === 'key') return 'go';
  if (how === 'wait' || !fromCaptain) return 'hold';
  return 'ask';
}

/**
 * The plan's limit stopped an agent mid-turn: they carry on with the key straight away when that's cheap, and are
 * held until the limit resets when it isn't, or when the key can't be used (its budget is spent).
 */
export function afterLimit(costUsd: number | undefined, onKey: boolean): 'carry-on' | 'hold' {
  return onKey && (costUsd === undefined || costUsd < RESUME_WARN_USD) ? 'carry-on' : 'hold';
}

/**
 * Whether the office's new sessions sign in with your login or your API key: the plan's usage limit as it stands, and
 * what the key has spent while it's reached. Every Claude Code session the office starts asks it (`agentEnv`).
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

  /** Where the office stands on your plan and your key now (lent to plugins as `host.signIn`). */
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

/** The office's one: what FOCUS_USE_API_KEY, ANTHROPIC_API_KEY and FOCUS_API_BUDGET say. */
export const keyFallback = new KeyFallback(keyMode(process.env), keyBudget(process.env));
