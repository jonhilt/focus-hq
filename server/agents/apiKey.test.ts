import { describe, expect, it, vi } from 'vitest';
import { KeyFallback, requestUsd, rereadUsd, signInToast } from './apiKey';

const NOW = 1_800_000_000_000;

describe('what the key costs', () => {
  it('prices a request by model, with cache writes and reads and output', () => {
    const usage = { input_tokens: 1e6, cache_creation_input_tokens: 1e6, cache_read_input_tokens: 1e6, output_tokens: 1e6 };
    expect(requestUsd(usage, 'claude-opus-5-5')).toBeCloseTo(4 + 5 + 0.2 + 20);
    expect(requestUsd(usage, 'claude-sonnet-5-5')).toBeCloseTo(2 + 2.5 + 0.2 + 10);
    expect(requestUsd({ output_tokens: 1e6 }, 'claude-fable-5-1')).toBeCloseTo(50);
    expect(requestUsd({ input_tokens: 1e6 }, 'claude-haiku-4-5')).toBeCloseTo(1);
  });

  it('prices a re-read as writing the conversation to the cache, at Opus’s price when the model is Claude Code’s default', () => {
    expect(rereadUsd(400_000, 'opus')).toBeCloseTo(2);
    expect(rereadUsd(400_000, '')).toBeCloseTo(2);
    expect(rereadUsd(400_000, undefined)).toBeCloseTo(2);
    expect(rereadUsd(400_000, 'claude-opus-4-8')).toBeCloseTo(2.5);
    expect(rereadUsd(400_000, 'sonnet')).toBeCloseTo(1);
    expect(rereadUsd(400_000, 'claude-sonnet-4-6')).toBeCloseTo(1.5);
  });
});

describe('signInToast', () => {
  const spell = { until: NOW + 3_600_000, spentUsd: 4.567 };

  it('says agents carry on with the key, up to its budget, until the plan’s limit resets', () => {
    const toast = signInToast(true, spell, 10, NOW);
    expect(toast.level).toBe('info');
    expect(toast.text).toMatch(/usage limit is reached until .+: agents carry on with your API key \(up to \$10\)/);
  });

  it('warns that agents wait, when the key’s budget is spent before the limit resets', () => {
    const toast = signInToast(false, spell, 10, NOW);
    expect(toast.level).toBe('error');
    expect(toast.text).toMatch(/^🔑 Your API key has spent its \$10: agents wait .+ reset at /);
  });

  it('says agents are back on the plan once its limit has reset, with what the key spent', () => {
    expect(signInToast(false, { ...spell, until: NOW }, 10, NOW)).toEqual({ level: 'success', text: "🔑 Your plan's usage limit has reset: agents are back on it (the key spent about $4.57)" });
  });
});

describe('KeyFallback', () => {
  it('moves new sessions to the key when the plan’s limit is reached, and back when the budget is spent', () => {
    let now = NOW;
    const keys = new KeyFallback('fallback', 10, () => now);
    const changes = vi.fn();
    keys.onChange = changes;
    expect(keys.onKey()).toBe(false);
    keys.limitHit(NOW + 60_000);
    expect(keys.onKey()).toBe(true);
    expect(keys.resetsAt()).toBe(NOW + 60_000);
    expect(changes).toHaveBeenLastCalledWith(true, { until: NOW + 60_000, spentUsd: 0 });
    keys.spent(6);
    expect(keys.onKey()).toBe(true);
    keys.spent(5);
    expect(keys.onKey()).toBe(false);
    expect(changes).toHaveBeenLastCalledWith(false, { until: NOW + 60_000, spentUsd: 11 });
    expect(keys.signIn()).toEqual({ mode: 'fallback', onKey: false, keySpentUsd: 11, keyBudgetUsd: 10 });
    now = NOW + 60_000;
    expect(keys.resetsAt()).toBeUndefined();
    expect(keys.spentUsd()).toBe(0);
    expect(keys.signIn()).toEqual({ mode: 'fallback', onKey: false, keySpentUsd: 0, keyBudgetUsd: 10 });
  });

  it('never uses the key on your login alone', () => {
    const keys = new KeyFallback('login', 10, () => NOW);
    keys.onChange = vi.fn();
    keys.limitHit(NOW + 60_000);
    expect(keys.onKey()).toBe(false);
    expect(keys.onChange).not.toHaveBeenCalled();
  });
});
