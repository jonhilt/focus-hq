import { describe, expect, it } from 'vitest';
import { burst, p, settle, stagger, takeHelpers, takeSyntaxError } from './takeScript';

describe('a take’s helpers', () => {
  it('ease between two times, and hold either side', () => {
    expect([p(0, 1, 2), p(1.5, 1, 2), p(3, 1, 2)]).toEqual([0, 0.5, 1]);
  });

  it('settle from 0 to 1 without ever passing it', () => {
    const at = [0, 0.5, 1, 1.2, 1.5, 2, 4].map((t) => settle(t, 1));
    expect(at[0]).toBe(0);
    expect(at[1]).toBe(0);
    for (let i = 1; i < at.length; i++) expect(at[i]).toBeGreaterThanOrEqual(at[i - 1]);
    expect(Math.max(...at)).toBeLessThanOrEqual(1);
    expect(at.at(-1)).toBeGreaterThan(0.99);
  });

  it('flash up quickly and die away', () => {
    expect(burst(0.9, 1)).toBe(0);
    expect(burst(1.04, 1)).toBeCloseTo(0.5);
    expect(burst(1.08, 1)).toBeCloseTo(1);
    expect(burst(3, 1)).toBeLessThan(0.05);
  });

  it('start each of many parts a gap after the last', () => {
    expect(stagger(1.2, 2, 1, 2, 0.1)).toBe(0);
    expect(stagger(2.2, 2, 1, 2, 0.1)).toBe(1);
  });

  it('time things by the take’s named phases, and say which there are when one isn’t', () => {
    const { phase } = takeHelpers({ dispatch: [0, 2], work: [2, 5] });
    expect(phase(1, 'dispatch')).toBe(0.5);
    expect(phase(1, 'work')).toBe(0);
    expect([phase.start('work'), phase.end('work')]).toEqual([2, 5]);
    expect(() => phase(1, 'fold')).toThrow('its phases are dispatch, work');
  });
});

describe('takeSyntaxError', () => {
  it('passes a script that parses with every helper in scope, and says why one doesn’t', () => {
    expect(takeSyntaxError('function render(t) { kit; phase(t, "a"); settle(t, 1); burst(t, 1); stagger(t, 0, 0, 1); }')).toBeUndefined();
    expect(takeSyntaxError('function render(t) {')).toBeTruthy();
  });
});
