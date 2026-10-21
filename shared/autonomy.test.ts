import { describe, expect, it } from 'vitest';
import { autonomyChangeLine, effectiveAutonomy, isAutonomy } from './autonomy';

describe('effectiveAutonomy', () => {
  it('follows the Focus-wide setting when the agent has no mode of its own', () => {
    expect(effectiveAutonomy({}, { autonomy: 'ask' })).toBe('ask');
    expect(effectiveAutonomy({ autonomy: undefined }, { autonomy: 'auto' })).toBe('auto');
  });

  it("uses the captain's choice for the agent over the Focus-wide setting", () => {
    expect(effectiveAutonomy({ autonomy: 'full' }, { autonomy: 'ask' })).toBe('full');
    expect(effectiveAutonomy({ autonomy: 'ask' }, { autonomy: 'full' })).toBe('ask');
  });
});

describe('isAutonomy', () => {
  it('accepts the three modes and nothing else', () => {
    expect(['ask', 'auto', 'full'].every(isAutonomy)).toBe(true);
    expect(isAutonomy('bypassPermissions')).toBe(false);
    expect(isAutonomy('')).toBe(false);
    expect(isAutonomy(undefined)).toBe(false);
  });
});

describe('autonomyChangeLine', () => {
  it('names the new mode as the settings panel does', () => {
    expect(autonomyChangeLine('Frances', 'full', 'live')).toBe("✻ The captain set Frances's autonomy to Full autonomy");
    expect(autonomyChangeLine('Frances', 'ask', 'none')).toBe("✻ The captain set Frances's autonomy to Raise your hand");
  });

  it("says when it waits for the agent's next turn", () => {
    expect(autonomyChangeLine('Ada', 'auto', 'next-turn')).toBe("✻ The captain set Ada's autonomy to Auto mode (from their next turn)");
  });
});
