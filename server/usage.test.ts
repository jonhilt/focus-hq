import { describe, expect, it } from 'vitest';
import { planUsage } from './usage';

const at = Date.parse('2026-10-12T22:00:00Z');

describe('planUsage', () => {
  it('reads the session and weekly windows, with when they reset', () => {
    const usage = planUsage({
      subscription_type: 'max',
      rate_limits: {
        five_hour: { utilization: 9.4, resets_at: '2026-10-13T02:59:59.631392+00:00' },
        seven_day: { utilization: 22, resets_at: '2026-10-18T13:59:59Z' },
        seven_day_opus: null,
        model_scoped: [{ display_name: 'Fable', utilization: 61, resets_at: null }],
      },
    }, at);
    expect(usage).toEqual({
      at,
      plan: 'max',
      windows: [
        { label: 'session', percent: 9, resetsAt: Date.parse('2026-10-13T02:59:59.631Z') },
        { label: 'week', percent: 22, resetsAt: Date.parse('2026-10-18T13:59:59Z') },
        { label: 'week · Fable', percent: 61 },
      ],
    });
  });

  it('leaves out limits with no reading, and limits under codenames', () => {
    const limits = { five_hour: { utilization: null, resets_at: null }, iguana_necktie: { utilization: 100, resets_at: null } };
    expect(planUsage({ subscription_type: 'pro', rate_limits: limits }, at)?.windows).toEqual([]);
  });

  it('reads extra usage from the currency’s minor units', () => {
    const usage = planUsage({
      subscription_type: 'max',
      rate_limits: { extra_usage: { is_enabled: true, monthly_limit: 5000, used_credits: 1250, utilization: 25, currency: 'GBP' } },
    }, at);
    expect(usage?.extra).toEqual({ enabled: true, used: 12.5, limit: 50, currency: 'GBP', percent: 25 });
  });

  it('is null when there’s no plan to read (an API key)', () => {
    expect(planUsage({ subscription_type: null, rate_limits: null }, at)).toBeNull();
  });
});
