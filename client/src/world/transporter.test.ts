import { describe, expect, it } from 'vitest';
import { beamPhase } from './transporter';

describe('beamPhase', () => {
  it('beams in: sparkles first, the figure solidifying out of them, then the sparkles fade', () => {
    expect(beamPhase(0, 'in')).toEqual({ sparkle: 0, solid: 0 });
    expect(beamPhase(0.3, 'in').sparkle).toBe(1);
    expect(beamPhase(0.3, 'in').solid).toBeLessThan(0.2);
    expect(beamPhase(0.8, 'in').solid).toBe(1);
    expect(beamPhase(1, 'in')).toEqual({ sparkle: 0, solid: 1 });
  });

  it('beams out the other way round: solid at first, gone by the time the sparkles fade', () => {
    expect(beamPhase(0, 'out')).toEqual({ sparkle: 0, solid: 1 });
    expect(beamPhase(0.5, 'out').sparkle).toBe(1);
    expect(beamPhase(0.75, 'out').solid).toBe(0);
    expect(beamPhase(1, 'out')).toEqual({ sparkle: 0, solid: 0 });
  });
});
