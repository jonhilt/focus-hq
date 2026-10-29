import type { SDKRateLimitInfo } from '@anthropic-ai/claude-agent-sdk';
import type { ResumeHow, SignIn } from '../../shared/types';
import type { RunContext } from './sdkMessages';

// Which sign-in a session uses (your plan or your API key), when the plan's usage limit stops it, and what happens to
// a conversation that would be picked back up on the key. Pure, so it's unit tested (apiKeyRules.test.ts); apiKey.ts
// keeps the spell (KeyFallback), sdkMessages.ts and the manager act on what these say.

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

/** When the plan doesn't say when its limit resets, Ops tries it again after this long. */
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

/** Whether a session that's hit your plan's limit stops to carry on with the key: one on your plan, once Ops says so. */
export function switchesToKey(ctx: Pick<RunContext, 'onKey'>, keyNow: () => boolean): boolean {
  return !ctx.onKey && keyNow();
}
