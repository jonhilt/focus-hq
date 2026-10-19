import { describe, expect, it } from 'vitest';
import { HALL_SCREEN } from '../../plugin-api/layout';
import { HALL_MACHINES, hallMachines } from './spot';

describe('hallMachines', () => {
  it('hangs clear of the team pods and the entrance’s wall, facing the hall’s middle', () => {
    const radius = 11;
    const half = HALL_MACHINES.width / 2 / HALL_SCREEN.r;
    // the pods stand at ±45° and ±90°, about 1.2 m either side of their middle at the wall
    for (const pod of [45, 90].map((d) => (d * Math.PI) / 180)) expect(Math.abs(Math.abs(HALL_MACHINES.angle) - pod)).toBeGreaterThan(half + 1.2 / radius);
    expect(Math.abs(HALL_MACHINES.angle) + half).toBeLessThan(Math.PI - Math.asin(2.4 / radius));
    const { at, yaw } = hallMachines();
    // a plane's front (+Z) turned by yaw points back at the middle
    const front = { x: Math.sin(yaw), z: Math.cos(yaw) };
    const toMiddle = { x: -at.x / Math.hypot(at.x, at.z), z: -at.z / Math.hypot(at.x, at.z) };
    expect(front.x * toMiddle.x + front.z * toMiddle.z).toBeCloseTo(1);
  });
});
