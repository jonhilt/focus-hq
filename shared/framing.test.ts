import { describe, expect, it } from 'vitest';
import { BOUNDS, FRAME_HEIGHT, lerpPose, solveFraming } from './framing';
import type { V3 } from './stagePlan';

const at = (points: Record<string, V3>) => (name: string) => points[name];
const distance = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('solveFraming', () => {
  it('frames one subject straight on at the size’s height', () => {
    const pose = solveFraming({ size: 'MS', on: { lead: [0.5, 0.5] }, angle: [0, 0], fov: 40 }, at({ lead: [0, 1, 0] }));
    const d = FRAME_HEIGHT.MS / (2 * Math.tan((20 * Math.PI) / 180));
    expect(pose.pos[0]).toBeCloseTo(0);
    expect(pose.pos[2]).toBeCloseTo(d);
    expect(pose.look).toEqual([0, 1, 0]);
  });

  it('comes round from screen-right for a positive yaw, and up for a negative pitch', () => {
    const pose = solveFraming({ size: 'MS', on: { lead: [0.5, 0.5] }, angle: [30, -20] }, at({ lead: [0, 1, 0] }));
    expect(pose.pos[0]).toBeGreaterThan(0);
    expect(pose.pos[1]).toBeGreaterThan(1);
  });

  it('puts a subject left of centre by looking right of it', () => {
    const pose = solveFraming({ size: 'MS', on: { lead: [0.3, 0.5] }, angle: [0, 0] }, at({ lead: [0, 1, 0] }));
    expect(pose.look[0]).toBeGreaterThan(0);
  });

  it('sizes the frame to fit two subjects at their screen points', () => {
    const near = solveFraming({ on: { a: [0.4, 0.5], b: [0.6, 0.5] }, angle: [0, 0] }, at({ a: [-1, 1, 0], b: [1, 1, 0] }));
    const far = solveFraming({ on: { a: [0.2, 0.5], b: [0.8, 0.5] }, angle: [0, 0] }, at({ a: [-1, 1, 0], b: [1, 1, 0] }));
    // the closer together they must be on screen, the further back the camera goes
    expect(near.pos[2]).toBeGreaterThan(far.pos[2]);
    expect(near.look[0]).toBeCloseTo(0);
  });

  it('keeps the camera in the hall, on the audience side', () => {
    const pose = solveFraming({ size: 'ELS', on: { hall: [0.5, 0.5] }, angle: [0, -60] }, at({ hall: [0, 1, 0] }));
    expect(Math.hypot(pose.pos[0], pose.pos[2])).toBeLessThanOrEqual(BOUNDS.radius + 1e-9);
    expect(pose.pos[1]).toBeLessThanOrEqual(BOUNDS.height + 1e-9);
    expect(pose.pos[2]).toBeGreaterThanOrEqual(BOUNDS.minZ);
  });

  it('takes a pose as given', () => {
    expect(solveFraming({ pos: [1, 2, 3], look: [0, 1, 0], fov: 30 }, at({}))).toEqual({ pos: [1, 2, 3], look: [0, 1, 0], fov: 30 });
  });
});

describe('lerpPose', () => {
  it('blends position, aim and lens', () => {
    const p = lerpPose({ pos: [0, 0, 0], look: [0, 0, 1], fov: 30 }, { pos: [2, 0, 0], look: [0, 0, 3], fov: 50 }, 0.5);
    expect(distance(p.pos, [1, 0, 0])).toBeCloseTo(0);
    expect(p.look).toEqual([0, 0, 2]);
    expect(p.fov).toBe(40);
  });
});
