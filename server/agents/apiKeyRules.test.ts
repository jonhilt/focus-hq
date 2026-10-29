import { describe, expect, it } from 'vitest';
import { afterLimit, DEFAULT_BUDGET_USD, keyBudget, keyMode, limitHit, limitReached, resumeChoice, switchesToKey, UNKNOWN_RESET_MS, useKey } from './apiKeyRules';

const NOW = 1_800_000_000_000;

describe('keyMode', () => {
  it('uses the key only when there is one and FOCUS_USE_API_KEY asks for it', () => {
    expect(keyMode({})).toBe('login');
    expect(keyMode({ ANTHROPIC_API_KEY: 'sk' })).toBe('login');
    expect(keyMode({ ANTHROPIC_API_KEY: 'sk', FOCUS_USE_API_KEY: '1' })).toBe('key');
    expect(keyMode({ ANTHROPIC_API_KEY: 'sk', FOCUS_USE_API_KEY: 'fallback' })).toBe('fallback');
    expect(keyMode({ FOCUS_USE_API_KEY: 'fallback' })).toBe('login');
  });
});

describe('keyBudget', () => {
  it('reads FOCUS_API_BUDGET, and falls back to the default for anything that is not an amount', () => {
    expect(keyBudget({})).toBe(DEFAULT_BUDGET_USD);
    expect(keyBudget({ FOCUS_API_BUDGET: '5.5' })).toBe(5.5);
    expect(keyBudget({ FOCUS_API_BUDGET: '0' })).toBe(0);
    expect(keyBudget({ FOCUS_API_BUDGET: 'lots' })).toBe(DEFAULT_BUDGET_USD);
    expect(keyBudget({ FOCUS_API_BUDGET: '-3' })).toBe(DEFAULT_BUDGET_USD);
  });
});

describe('limitReached', () => {
  it('is when a rejected request’s limit resets, in ms', () => {
    expect(limitReached({ status: 'rejected', resetsAt: NOW / 1000 + 3600 }, NOW)).toBe(NOW + 3600_000);
    expect(limitReached({ status: 'rejected', resetsAt: NOW + 60_000 }, NOW)).toBe(NOW + 60_000);
  });

  it('is null while requests still go through, on the plan or on extra usage', () => {
    expect(limitReached({ status: 'allowed' }, NOW)).toBeNull();
    expect(limitReached({ status: 'allowed_warning', resetsAt: NOW / 1000 }, NOW)).toBeNull();
    expect(limitReached({ status: 'rejected', overageStatus: 'allowed' }, NOW)).toBeNull();
    expect(limitReached({ status: 'rejected', isUsingOverage: true }, NOW)).toBeNull();
    expect(limitReached({ status: 'rejected', overageStatus: 'rejected' }, NOW)).not.toBeNull();
  });

  it('tries again in a while when it doesn’t say when, or says a time already past', () => {
    expect(limitReached({ status: 'rejected' }, NOW)).toBe(NOW + UNKNOWN_RESET_MS);
    expect(limitReached({ status: 'rejected', resetsAt: NOW / 1000 - 10 }, NOW)).toBe(NOW + UNKNOWN_RESET_MS);
  });
});

describe('limitHit and useKey', () => {
  it('starts a spell with nothing spent, and keeps what was spent while it lasts', () => {
    const spell = limitHit(undefined, NOW + 1000, NOW);
    expect(spell).toEqual({ until: NOW + 1000, spentUsd: 0 });
    expect(limitHit({ ...spell, spentUsd: 4 }, NOW + 5000, NOW)).toEqual({ until: NOW + 5000, spentUsd: 4 });
    expect(limitHit({ ...spell, spentUsd: 4 }, NOW + 500, NOW)).toEqual({ until: NOW + 1000, spentUsd: 4 });
    // over: the next one starts afresh
    expect(limitHit({ ...spell, spentUsd: 4 }, NOW + 9000, NOW + 2000)).toEqual({ until: NOW + 9000, spentUsd: 0 });
  });

  it('uses the key in a fallback spell while the budget lasts', () => {
    const spell = { until: NOW + 1000, spentUsd: 3 };
    expect(useKey('fallback', undefined, 20, NOW)).toBe(false);
    expect(useKey('fallback', spell, 20, NOW)).toBe(true);
    expect(useKey('fallback', spell, 3, NOW)).toBe(false);
    expect(useKey('fallback', spell, 20, NOW + 1000)).toBe(false);
    expect(useKey('login', spell, 20, NOW)).toBe(false);
    expect(useKey('key', undefined, 0, NOW)).toBe(true);
  });
});

describe('resumeChoice', () => {
  it('goes ahead when it costs little, or nothing extra', () => {
    expect(resumeChoice(undefined, undefined, true)).toBe('go');
    expect(resumeChoice(0.4, undefined, false)).toBe('go');
  });

  it('asks the captain before a costly re-read, and goes ahead or waits as they say', () => {
    expect(resumeChoice(3, undefined, true)).toBe('ask');
    expect(resumeChoice(3, 'key', true)).toBe('go');
    expect(resumeChoice(3, 'wait', true)).toBe('hold');
  });

  it('holds anyone else’s news for a costly one until the limit resets', () => {
    expect(resumeChoice(3, undefined, false)).toBe('hold');
  });
});

describe('afterLimit', () => {
  it('carries on with the key when that’s cheap, and holds otherwise', () => {
    expect(afterLimit(0.3, true)).toBe('carry-on');
    expect(afterLimit(undefined, true)).toBe('carry-on');
    expect(afterLimit(3, true)).toBe('hold');
    expect(afterLimit(0.3, false)).toBe('hold');
  });
});

describe('your plan’s usage limit', () => {
  it('moves a session on your plan to the key, once Ops says so', () => {
    expect(switchesToKey({ onKey: false }, () => true)).toBe(true);
    expect(switchesToKey({ onKey: false }, () => false)).toBe(false);
  });

  it('never moves a session already on the key, and doesn’t ask then', () => {
    const ask = () => {
      throw new Error('asked');
    };
    expect(switchesToKey({ onKey: true }, ask)).toBe(false);
  });
});
