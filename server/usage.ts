import { query, type SDKControlGetUsageResponse, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { PlanUsage, Usage, UsageWindow } from '../shared/types';
import { agentEnv } from './agents/claudeRunner';
import type { KeyFallback } from './agents/apiKey';
import type { Hub } from './hub';
import { errorMessage } from './util';

/** How often the office reads your plan's usage: each reading starts a Claude Code process, but sends it nothing. */
export const READ_EVERY_MS = 3 * 60_000;
/** A reading that takes longer than this has failed. */
const READ_TIMEOUT_MS = 30_000;

type RateLimits = NonNullable<SDKControlGetUsageResponse['rate_limits']>;
type Limit = { utilization: number | null; resets_at: string | null } | null | undefined;

const WINDOWS: [keyof RateLimits, string][] = [
  ['five_hour', 'session'],
  ['seven_day', 'week'],
  ['seven_day_opus', 'week · Opus'],
  ['seven_day_sonnet', 'week · Sonnet'],
];

const window = (label: string, limit: Limit): UsageWindow | undefined => {
  if (limit?.utilization == null) return undefined;
  const resetsAt = limit.resets_at ? Date.parse(limit.resets_at) : NaN;
  return { label, percent: Math.round(limit.utilization), ...(Number.isFinite(resetsAt) && { resetsAt }) };
};

/**
 * Your plan's usage from Claude Code's structured `/usage` (`usage_EXPERIMENTAL…`), or null when there's no plan to
 * read (an API key). Its limits under codenames it hasn't announced are left out; extra usage comes in the currency's
 * minor units (pence, cents).
 */
export function planUsage(raw: Pick<SDKControlGetUsageResponse, 'subscription_type' | 'rate_limits'>, at: number): PlanUsage | null {
  const limits = raw.rate_limits;
  if (!limits) return null;
  const windows = [
    ...WINDOWS.map(([key, label]) => window(label, limits[key] as Limit)),
    ...(limits.model_scoped ?? []).map((m) => window(`week · ${m.display_name}`, m)),
  ].filter((w): w is UsageWindow => !!w);
  const extra = limits.extra_usage;
  const minor = 10 ** ((extra as { decimal_places?: number } | null | undefined)?.decimal_places ?? 2);
  return {
    at,
    ...(raw.subscription_type && { plan: raw.subscription_type }),
    windows,
    ...(extra && {
      extra: {
        enabled: extra.is_enabled,
        used: (extra.used_credits ?? 0) / minor,
        limit: (extra.monthly_limit ?? 0) / minor,
        currency: extra.currency ?? 'USD',
        percent: Math.round(extra.utilization ?? 0),
      },
    }),
  };
}

/**
 * Reads your plan's usage the way the office's sessions sign in, from a Claude Code session that's sent no prompt, so
 * it spends nothing and leaves no transcript.
 */
export async function readPlanUsage(cwd: string): Promise<PlanUsage | null> {
  const abort = new AbortController();
  // a prompt that never comes: the session only answers the office's control request
  const prompt: AsyncIterable<SDKUserMessage> = {
    [Symbol.asyncIterator]: () => ({
      next: () => new Promise<IteratorResult<SDKUserMessage>>((resolve) => abort.signal.addEventListener('abort', () => resolve({ done: true, value: undefined }))),
    }),
  };
  const q = query({ prompt, options: { cwd, env: agentEnv(false), abortController: abort, settingSources: [] } });
  const timer = setTimeout(() => abort.abort(), READ_TIMEOUT_MS);
  try {
    return planUsage(await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }), Date.now());
  } finally {
    clearTimeout(timer);
    abort.abort();
    q.close();
  }
}

/** The demo's plan: a session filling up as the minutes go by, and a week that's a quarter gone. */
export async function demoPlanUsage(): Promise<PlanUsage> {
  const now = Date.now();
  const hour = 60 * 60_000;
  const intoSession = now % (5 * hour);
  return {
    at: now,
    plan: 'max',
    windows: [
      { label: 'session', percent: Math.round((intoSession / (5 * hour)) * 90), resetsAt: now - intoSession + 5 * hour },
      { label: 'week', percent: 27, resetsAt: now + 4.5 * 24 * hour },
    ],
    extra: { enabled: false, used: 0, limit: 50, currency: 'GBP', percent: 0 },
  };
}

/**
 * Main engineering's usage readout: your plan's limits, read every few minutes, and how the office's sessions sign in
 * (`keyFallback`), sent to the browsers whenever either changes. On the API key alone there's no plan to read.
 */
export class UsageWatch {
  private plan: PlanUsage | null = null;
  private error?: string;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly hub: Hub,
    private readonly keys: KeyFallback,
    private readonly read: () => Promise<PlanUsage | null>,
  ) {}

  current(): Usage {
    return {
      plan: this.plan,
      ...(this.error && { error: this.error }),
      signIn: this.keys.mode,
      onKey: this.keys.onKey(),
      keySpentUsd: this.keys.spentUsd(),
      keyBudgetUsd: this.keys.budgetUsd,
    };
  }

  start(): void {
    if (this.keys.mode === 'key') return this.changed();
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), READ_EVERY_MS);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  async refresh(): Promise<void> {
    try {
      this.plan = await this.read();
      this.error = this.plan ? undefined : "Claude Code didn't report your plan's limits";
    } catch (err) {
      // keep the last reading: it's still the best guess, and says when it was read
      this.error = errorMessage(err);
    }
    this.changed();
  }

  /** Something about how the office signs in changed. */
  changed(): void {
    this.hub.send({ type: 'usage', usage: this.current() });
  }
}
