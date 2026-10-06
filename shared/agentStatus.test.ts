import { describe, expect, it } from 'vitest';
import { contextLevel } from './agentStatus';

describe('contextLevel', () => {
  it('reads how full a context is: fine, filling up, nearly full', () => {
    expect(contextLevel(0)).toBe('ok');
    expect(contextLevel(59)).toBe('ok');
    expect(contextLevel(60)).toBe('filling');
    expect(contextLevel(79)).toBe('filling');
    expect(contextLevel(80)).toBe('full');
    expect(contextLevel(104)).toBe('full');
  });
});
