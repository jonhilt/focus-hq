import { describe, expect, it } from 'vitest';
import type { Usage } from './shared';
import { agentSignIn, signInLine, usageHeadline, usageRows, usageStat, usageTone } from './readout';

const now = new Date(2026, 9, 12, 22, 0).getTime();
const usage = (change: Partial<Usage> = {}): Usage => ({
  plan: {
    at: now,
    plan: 'max',
    windows: [
      { label: 'session', percent: 9, resetsAt: new Date(2026, 9, 12, 23, 59).getTime() },
      { label: 'week', percent: 92 },
    ],
    extra: { enabled: false, used: 0, limit: 50, currency: 'GBP', percent: 0 },
  },
  signIn: 'login',
  onKey: false,
  keySpentUsd: 0,
  keyBudgetUsd: 20,
  ...change,
});

describe('usageTone', () => {
  it('warns from 75% and says it’s nearly out from 90%', () => {
    expect([0, 74, 75, 89, 90, 100].map(usageTone)).toEqual(['ok', 'ok', 'warn', 'warn', 'bad', 'bad']);
  });
});

describe('usageRows', () => {
  it('reads each limit with when it resets, and leaves extra usage out while it’s off', () => {
    const rows = usageRows(usage(), now);
    expect(rows.map((r) => [r.label, r.percent, r.tone])).toEqual([['session', 9, 'ok'], ['week', 92, 'bad']]);
    expect(rows[0].note).toMatch(/^resets \d/);
    expect(rows[1].note).toBe('');
  });

  it('adds extra usage when it’s on, with what it’s spent this month', () => {
    const on = usage();
    on.plan!.extra = { enabled: true, used: 12.5, limit: 50, currency: 'GBP', percent: 25 };
    expect(usageRows(on, now).at(-1)).toMatchObject({ label: 'extra usage', percent: 25, tone: 'ok', note: expect.stringMatching(/12\.5.*50.*this month/) });
  });

  it('is empty with no reading', () => {
    expect(usageRows(null)).toEqual([]);
    expect(usageRows(usage({ plan: null }))).toEqual([]);
  });
});

describe('usageHeadline', () => {
  it('names the plan, or says why there’s nothing to show', () => {
    expect(usageHeadline(usage())).toBe('Max plan');
    expect(usageHeadline(null)).toMatch(/Reading/);
    expect(usageHeadline(usage({ plan: null, signIn: 'key' }))).toMatch(/API key/);
    expect(usageHeadline(usage({ plan: null, error: 'timed out' }))).toMatch(/timed out/);
  });
});

describe('signInLine', () => {
  it('says how sessions sign in, and what the key has spent while it’s standing in', () => {
    expect(signInLine(usage())).toMatch(/Claude plan/);
    expect(signInLine(usage({ signIn: 'key' }))).toMatch(/API key/);
    expect(signInLine(usage({ signIn: 'fallback' }))).toMatch(/then your API key \(up to \$20\)/);
    expect(signInLine(usage({ signIn: 'fallback', onKey: true, keySpentUsd: 3.2 }))).toMatch(/\$3\.20 of \$20/);
  });
});

describe('agentSignIn', () => {
  it('is the cloud session’s plan, the key, or your plan', () => {
    expect(agentSignIn({ cloud: true, onKey: true })).toBe('cloud');
    expect(agentSignIn({ onKey: true })).toBe('key');
    expect(agentSignIn({})).toBe('plan');
  });
});

describe('usageStat', () => {
  it('lists each limit, toned by the nearest to running out', () => {
    expect(usageStat(usage())).toEqual({ text: 'session 9% · week 92%', tone: 'bad' });
  });

  it('shows nothing without a plan reading', () => {
    expect(usageStat(null)).toBeNull();
    expect(usageStat(usage({ plan: null }))).toBeNull();
  });
});
