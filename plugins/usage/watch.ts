// Reading your plan's usage from Claude Code's structured /usage every few minutes, with how the office signs in.
import { query, type SDKControlGetUsageResponse, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { agentEnv, errorMessage, type PluginState, type SignIn } from '../../plugin-api/server';
import type { PlanUsage, Usage, UsageWindow } from './shared';

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

/**
 * The readout: a plan's reading (or why there's none) with how the office signs in. `error` is always there, undefined
 * once a reading works, so setting the plugin's state with it clears an error from before.
 */
export const usageOf = (plan: PlanUsage | null, error: string | undefined, signIn: SignIn): Usage => ({
  plan,
  error,
  signIn: signIn.mode,
  onKey: signIn.onKey,
  keySpentUsd: signIn.keySpentUsd,
  keyBudgetUsd: signIn.keyBudgetUsd,
});

/**
 * Main engineering's usage readout: your plan's limits, read every few minutes, and how the office's sessions sign in
 * (`host.signIn`), in the plugin's state whenever either changes. On the API key alone there's no plan to read.
 */
export class UsageWatch {
  private plan: PlanUsage | null = null;
  private error?: string;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly state: PluginState<Usage>,
    private readonly signIn: () => SignIn,
    private readonly read: () => Promise<PlanUsage | null>,
  ) {}

  current(): Usage {
    return usageOf(this.plan, this.error, this.signIn());
  }

  /** Says how the office signs in straight away, and reads the plan every few minutes, unless there's none to read. */
  start(): void {
    this.changed();
    if (this.signIn().mode === 'key') return;
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
    this.state.set(this.current());
  }
}
