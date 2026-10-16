import { describe, expect, it } from 'vitest';
import { HALL_SCREEN, SPACE } from '../../plugin-api/layout';
import { ARRIVAL, EXIT_ARCH, HALL_CHART, hallChart, MAX_PANELS, PANELS, panelSpots, PLATFORM, reachOf } from './spaceLayout';
import { ARCH } from './arch';

const flat = (p: { x: number; z: number }) => Math.hypot(p.x, p.z);

describe('panelSpots', () => {
  it('puts the first straight ahead, and has room for no more than MAX_PANELS', () => {
    expect(panelSpots(1)).toEqual([{ at: PANELS.ahead.at, yaw: 0, width: PANELS.ahead.width }]);
    expect(panelSpots(40)).toHaveLength(MAX_PANELS);
    expect(panelSpots(0)).toEqual([]);
  });

  it('turns each to face the platform', () => {
    for (const { at, yaw } of panelSpots(MAX_PANELS)) {
      // a plane turned by yaw faces (sin yaw, 0, cos yaw): back towards the middle
      const facing = { x: Math.sin(yaw), z: Math.cos(yaw) };
      expect((facing.x * -at.x + facing.z * -at.z) / flat(at)).toBeCloseTo(1, 6);
    }
  });

  it('keeps them apart, off the platform and inside the space', () => {
    const spots = panelSpots(MAX_PANELS);
    for (const [i, a] of spots.entries()) {
      expect(flat(a.at)).toBeGreaterThan(PLATFORM.radius + 3);
      expect(flat(a.at) + a.width).toBeLessThan(SPACE.radius / 2);
      for (const b of spots.slice(i + 1)) {
        const apart = Math.hypot(a.at.x - b.at.x, a.at.y - b.at.y, a.at.z - b.at.z);
        expect(apart).toBeGreaterThan((a.width + b.width) / 2);
      }
    }
  });

  it('can be read up close from anywhere on the platform', () => {
    for (const spot of panelSpots(MAX_PANELS)) expect(reachOf(spot)).toBeGreaterThan(flat(spot.at) + PLATFORM.radius);
  });
});

describe('the platform', () => {
  it('has room to arrive in front of the arch you leave by, which stands on it', () => {
    expect(flat(ARRIVAL.at)).toBeLessThan(PLATFORM.radius - 1);
    expect(EXIT_ARCH.at.z - ARCH.depth - ARRIVAL.at.z).toBeGreaterThan(1.5);
    const corner = { x: ARCH.width / 2 + ARCH.pillar, z: EXIT_ARCH.at.z + ARCH.depth / 2 };
    expect(flat(corner)).toBeLessThan(PLATFORM.radius);
  });
});

describe('hallChart', () => {
  it('hangs on the wall, turned to the middle, its bottom over your head, and you come back in front of it', () => {
    const { at, yaw, back } = hallChart();
    expect(flat(at)).toBeCloseTo(HALL_SCREEN.r, 6);
    expect(at.y - HALL_CHART.width / HALL_CHART.aspect / 2).toBeCloseTo(HALL_CHART.bottom, 6);
    // a plane turned by yaw faces (sin yaw, 0, cos yaw): towards the middle
    expect((Math.sin(yaw) * -at.x + Math.cos(yaw) * -at.z) / flat(at)).toBeCloseTo(1, 6);
    expect(flat(back.at)).toBeLessThan(flat(at) - 2);
    expect(flat(at) - flat(back.at)).toBeLessThan(HALL_CHART.reach);
  });
});
