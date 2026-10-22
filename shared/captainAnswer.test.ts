import { describe, expect, it } from 'vitest';
import { landed } from './captainAnswer';

describe('an answer to an agent', () => {
  it('counts as given unless Ops came back to ask about cost, or warn before closing', () => {
    expect(landed({ sent: true })).toBe(true);
    expect(landed(undefined)).toBe(true);
    expect(landed({ costly: { usd: 3 } })).toBe(false);
    expect(landed({ warn: ['unmerged PR'] })).toBe(false);
  });
});
