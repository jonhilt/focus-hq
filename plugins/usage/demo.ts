// The demo office's plan, made up: there's no Claude Code to ask.
import type { PlanUsage } from './shared';

/**
 * The demo's plan: a session filling up as the hours go by, and a week that's a quarter gone. It answers at once, so
 * it has no wait for the demo's pace to quicken.
 */
export function demoPlanUsage(now = Date.now()): Promise<PlanUsage> {
  const hour = 60 * 60_000;
  const intoSession = now % (5 * hour);
  return Promise.resolve({
    at: now,
    plan: 'max',
    windows: [
      { label: 'session', percent: Math.round((intoSession / (5 * hour)) * 90), resetsAt: now - intoSession + 5 * hour },
      { label: 'week', percent: 27, resetsAt: now + 4.5 * 24 * hour },
    ],
    extra: { enabled: false, used: 0, limit: 50, currency: 'GBP', percent: 0 },
  });
}
