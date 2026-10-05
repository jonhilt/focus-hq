import type { AgentStatus } from '../../../shared/types';
import type { Expression } from './head';

/** An arm's rotation from its shoulder pivot; the arm points along +X, so negative z lowers it. */
export interface ArmPose {
  x: number;
  y: number;
  z: number;
}

/** Where a seated character's arms, head and body go on one frame. */
export interface Pose {
  armL: ArmPose;
  armR: ArmPose;
  headTilt: number;
  headTurn: number;
  bodyY: number;
  expression: Expression;
}

export interface PoseInput {
  status: AgentStatus;
  /** Hand on chin. */
  thinking: boolean;
  /** Just finished: the few seconds of cheering after `done`. */
  celebrating: boolean;
  /** Time plus the character's own phase, in seconds. */
  p: number;
}

/** A character at a workstation: every pose starts from fingertips on the touch panel. */
export function keyboardPose({ status: s, thinking, celebrating, p }: PoseInput): Pose {
  // defaults: fingertips on the touch panel
  let lz = -0.38, rz = -0.38, rx = 0;
  const lx = 0;
  let headTilt = 0, headTurn = 0, bodyY = 0;
  let expression: Expression = 'idle';

  if (s === 'working' || s === 'setting-up' || s === 'pushing') {
    lz += Math.sin(p * 17) * 0.1;
    rz += Math.sin(p * 17 + 2) * 0.1;
    headTilt = Math.sin(p * 2) * 0.04;
    expression = 'focused';
    if (thinking) {
      expression = 'thinking';
      rz = 0.25;
      rx = -0.5;
      headTilt = 0.15;
      headTurn = Math.sin(p) * 0.15;
    }
  } else if (s === 'testing') {
    lz += Math.sin(p * 6) * 0.06;
    rz += Math.sin(p * 9) * 0.08;
    headTurn = Math.sin(p * 0.8) * 0.12;
    expression = 'focused';
  } else if (s === 'waiting') {
    rz = 1.35 + Math.sin(p * 9) * 0.15;
    rx = 0.2;
    bodyY = Math.abs(Math.sin(p * 4)) * 0.04;
    headTurn = -0.5;
    headTilt = 0.15;
    expression = 'eager';
  } else if (s === 'done') {
    lz = -1.1;
    rz = -1.1;
    headTilt = 0.12;
    expression = 'happy';
    if (celebrating) {
      expression = 'grin';
      lz = rz = 1.2 + Math.sin(p * 14) * 0.2;
      bodyY = Math.abs(Math.sin(p * 9)) * 0.18;
    }
  } else if (s === 'error') {
    lz = rz = -1.2;
    headTilt = -0.35;
    expression = 'worried';
  } else if (s === 'stopped' || s === 'queued') {
    lz = rz = -1.15;
    headTilt = s === 'stopped' ? -0.25 + Math.sin(p * 1.2) * 0.04 : Math.sin(p * 0.7) * 0.05;
    headTurn = s === 'queued' ? Math.sin(p * 0.5) * 0.4 : 0;
    if (s === 'stopped') expression = 'asleep';
  }

  return { armL: { x: lx, y: 0.15, z: lz }, armR: { x: rx, y: -0.15, z: rz }, headTilt, headTurn, bodyY, expression };
}

/** A handheld pose also says how far the PADD leans back from upright, so its screen faces the eyes. */
export interface PaddPose extends Pose {
  lean: number;
}

/** Both hands on the PADD's lower corners, held up in front of the chest. The arms mirror each other, so the right hand lands on the right corner. */
const HOLD = { armL: { x: 0, y: -0.35, z: -0.3 }, armR: { x: 0, y: 0.35, z: -0.3 }, lean: 0.7 };
/** Both hands on the PADD, resting it low over the lap. */
const LAP = { armL: { x: 0, y: -0.35, z: -0.5 }, armR: { x: 0, y: 0.35, z: -0.5 }, lean: 1.05 };
/** Left hand only, PADD lowered, leaving the right hand free. */
const ASIDE = { armL: { x: 0, y: -0.25, z: -0.4 }, lean: 0.85 };

/**
 * A character with no workstation, holding a PADD in the left hand (and the right, when it isn't busy). Every motion is
 * slow: reading and the odd tap, never typing.
 */
export function paddPose({ status: s, thinking, celebrating, p }: PoseInput): PaddPose {
  switch (s) {
    case 'working':
    case 'setting-up':
    case 'pushing':
    case 'testing': {
      if (thinking) {
        return {
          ...ASIDE,
          armR: { x: -0.5, y: -0.15, z: 0.25 },
          headTilt: 0.15,
          headTurn: Math.sin(p) * 0.15,
          bodyY: 0,
          expression: 'thinking',
        };
      }
      // reading: a gentle bob, and every few seconds the right hand lifts to tap the screen
      const bob = Math.sin(p * 1.3) * 0.03;
      const tap = Math.max(0, Math.sin(p * 1.4)) ** 6;
      return {
        armL: { ...HOLD.armL, z: HOLD.armL.z + bob },
        armR: { x: 0, y: HOLD.armR.y + tap * 0.25, z: HOLD.armR.z + bob + tap * 0.22 },
        lean: HOLD.lean,
        headTilt: -0.12 + Math.sin(p * 0.9) * 0.03,
        headTurn: Math.sin(p * 0.6) * 0.06,
        bodyY: 0,
        expression: 'focused',
      };
    }
    case 'waiting':
      return {
        ...ASIDE,
        armR: { x: 0.2, y: -0.15, z: 1.35 + Math.sin(p * 9) * 0.15 },
        headTilt: 0.15,
        headTurn: -0.5,
        bodyY: Math.abs(Math.sin(p * 4)) * 0.04,
        expression: 'eager',
      };
    case 'done':
      if (celebrating) {
        return {
          ...ASIDE,
          armR: { x: 0, y: -0.15, z: 1.2 + Math.sin(p * 14) * 0.2 },
          headTilt: 0.12,
          headTurn: 0,
          bodyY: Math.abs(Math.sin(p * 9)) * 0.18,
          expression: 'grin',
        };
      }
      return { ...LAP, headTilt: 0.12, headTurn: 0, bodyY: 0, expression: 'happy' };
    case 'error':
      return { ...LAP, headTilt: -0.35, headTurn: 0, bodyY: 0, expression: 'worried' };
    case 'queued':
      return { ...LAP, headTilt: Math.sin(p * 0.7) * 0.05, headTurn: Math.sin(p * 0.5) * 0.4, bodyY: 0, expression: 'idle' };
    case 'stopped':
      return { ...LAP, headTilt: -0.25 + Math.sin(p * 1.2) * 0.04, headTurn: 0, bodyY: 0, expression: 'asleep' };
  }
}
