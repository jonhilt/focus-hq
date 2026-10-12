// Declarative framing for the studio's holodeck stage (studio/director.md, rule 15 and "The shot plan"): a shot says
// where its subjects sit on screen, how big, and from what angle, and `solveFraming` works out where the camera goes.
// In the stage frame: metres from the middle of the hall floor, +x screen-right, +z towards the audience, y up.

import type { Framing, V3 } from './stagePlan';

export interface Pose {
  pos: V3;
  look: V3;
  /** Vertical field of view, degrees. */
  fov: number;
}

/** How tall the frame is (metres) at the subject for each shot size, for a seated crew member (big-headed, so roomier than a person); props size alike. */
export const FRAME_HEIGHT: Record<string, number> = { ECU: 0.45, CU: 0.8, MCU: 1.15, MS: 1.7, MLS: 2.4, FS: 3.0, LS: 6.5, ELS: 14 };

/** Where the camera may go: inside the hall, under its ceiling, on the audience's side. */
export const BOUNDS = { radius: 10, height: 6, minZ: 0.3, floor: 0.4 };

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => scale(a, 1 / (Math.hypot(...a) || 1));
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Whether a camera position is somewhere the stage allows. */
function inBounds(p: V3): boolean {
  return Math.hypot(p[0], p[2]) <= BOUNDS.radius && p[1] <= BOUNDS.height && p[1] >= BOUNDS.floor && p[2] >= BOUNDS.minZ;
}

/**
 * Where the camera goes for a framing, given where each named subject is (`where`; a crew member's is their head).
 * One subject: it lands at its screen point, at the size's frame height, from the angle. Two or more: the first two
 * set the frame's size by how far apart they must be on screen, and their middle lands at the middle of their points.
 * A camera that would leave the hall comes closer along its line of sight until it's back inside.
 */
export function solveFraming(f: Framing, where: (name: string) => V3 | undefined, aspect = 16 / 9): Pose {
  const fov = f.fov ?? 40;
  if (f.pos && f.look) return { pos: f.pos, look: f.look, fov };
  const named = Object.entries(f.on ?? {})
    .map(([name, screen]) => ({ at: where(name), screen }))
    .filter((s): s is { at: V3; screen: [number, number] } => !!s.at);
  if (!named.length) named.push({ at: [0, 1, 0], screen: [0.5, 0.5] });
  const [yaw, pitch] = f.angle ?? [0, -10];
  // from the subject towards the camera: straight on is +z, + yaw comes round from screen-right, − pitch looks down
  const back: V3 = [Math.sin(rad(yaw)) * Math.cos(rad(pitch)), Math.sin(rad(-pitch)), Math.cos(rad(yaw)) * Math.cos(rad(pitch))];
  const forward = scale(back, -1);
  const right = norm(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const tan = Math.tan(rad(fov) / 2);

  let height = FRAME_HEIGHT[f.size ?? 'MS'] ?? FRAME_HEIGHT.MS;
  let aim = named[0].at;
  let screen = named[0].screen;
  if (named.length >= 2) {
    const [a, b] = named;
    const apart = sub(b.at, a.at);
    const across = Math.abs(dot(apart, right));
    const down = Math.abs(dot(apart, up));
    const sx = Math.abs(b.screen[0] - a.screen[0]);
    const sy = Math.abs(b.screen[1] - a.screen[1]);
    const fits = [sx > 0.05 && across > 0.05 ? across / sx / aspect : 0, sy > 0.05 && down > 0.05 ? down / sy : 0];
    if (Math.max(...fits) > 0) height = Math.max(...fits);
    aim = scale(add(a.at, b.at), 0.5);
    screen = [(a.screen[0] + b.screen[0]) / 2, (a.screen[1] + b.screen[1]) / 2];
  }
  let distance = height / (2 * tan);
  let pos = add(aim, scale(back, distance));
  for (let tries = 0; !inBounds(pos) && tries < 40; tries++) {
    distance *= 0.92;
    pos = add(aim, scale(back, distance));
  }
  // the subject lands off-centre by aiming the other way: across by the width, up by the height, at its distance
  const frameH = 2 * distance * tan;
  const look = add(add(aim, scale(right, (0.5 - screen[0]) * frameH * aspect)), scale(up, (screen[1] - 0.5) * frameH));
  return { pos, look, fov };
}

/** A pose `k` of the way from one to another. */
export function lerpPose(a: Pose, b: Pose, k: number): Pose {
  const mix = (x: V3, y: V3): V3 => [x[0] + (y[0] - x[0]) * k, x[1] + (y[1] - x[1]) * k, x[2] + (y[2] - x[2]) * k];
  return { pos: mix(a.pos, b.pos), look: mix(a.look, b.look), fov: a.fov + (b.fov - a.fov) * k };
}
