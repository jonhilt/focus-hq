import { describe, expect, it } from 'vitest';
import type { AgentStatus } from '../../../shared/types';
import { keyboardPose, paddPose, type Pose, type PoseInput } from './pose';

const STATUSES: AgentStatus[] = ['queued', 'setting-up', 'working', 'testing', 'waiting', 'pushing', 'done', 'error', 'stopped'];
const INPUTS: Omit<PoseInput, 'p'>[] = STATUSES.flatMap((status) =>
  [false, true].flatMap((thinking) => [false, true].map((celebrating) => ({ status, thinking, celebrating }))),
);
const TIMES = Array.from({ length: 1000 }, (_, i) => i * 0.01);

/** The fastest either hand swings, in radians per second. */
function fastestArm(pose: (input: PoseInput) => Pose, input: Omit<PoseInput, 'p'>): number {
  let fastest = 0;
  for (const p of TIMES) {
    const a = pose({ ...input, p });
    const b = pose({ ...input, p: p + 0.01 });
    fastest = Math.max(fastest, Math.abs(b.armL.z - a.armL.z) / 0.01, Math.abs(b.armR.z - a.armR.z) / 0.01);
  }
  return fastest;
}

const onKeyboard = (pose: Pose) => Math.abs(pose.armL.z + 0.38) < 0.11 && Math.abs(pose.armR.z + 0.38) < 0.11 && pose.armL.y === 0.15;

describe('paddPose', () => {
  it('never uses the keyboard pose', () => {
    for (const input of INPUTS) for (const p of TIMES) expect(onKeyboard(paddPose({ ...input, p })), JSON.stringify({ ...input, p })).toBe(false);
  });

  it('never makes the fast typing motion while working', () => {
    expect(fastestArm(keyboardPose, { status: 'working', thinking: false, celebrating: false })).toBeGreaterThan(1.5);
    for (const status of ['setting-up', 'working', 'testing', 'pushing'] as const) {
      for (const thinking of [false, true]) expect(fastestArm(paddPose, { status, thinking, celebrating: false })).toBeLessThan(0.6);
    }
  });

  it('keeps the left hand on the PADD while the right hand thinks, waves or cheers', () => {
    for (const input of INPUTS) {
      const { armL } = paddPose({ ...input, p: 1 });
      // the left arm stays low and forward: never raised, never dropped to the side
      expect(armL.z).toBeLessThan(0);
      expect(armL.z).toBeGreaterThan(-0.6);
      expect(armL.y).toBeLessThan(0);
    }
  });
});
