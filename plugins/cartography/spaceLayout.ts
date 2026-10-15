// Where things stand in the architecture space (space.ts), and in a holodeck for the way there: nothing here draws,
// so it can be tested without a browser. The space's frame has its middle at the middle of the platform you stand on,
// its floor at y 0, and straight ahead, the way you face as you arrive, is -Z.
import { around } from '../../plugin-api/layout';

export interface Point {
  x: number;
  y: number;
  z: number;
}

/** The platform you stand on, out in the dark: how far round its middle you can walk. */
export const PLATFORM = { radius: 3.6 } as const;

/** Where you arrive, looking straight ahead at the whole map. */
export const ARRIVAL: { at: Point; lookAt: Point } = { at: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 2.8, z: -9.5 } };

/** The arch you leave by, at the back of the platform behind you as you arrive, facing the middle (it's built facing -Z). */
export const EXIT_ARCH = { at: { x: 0, y: 0, z: 2.6 } } as const;

/** A view's place in the space: its middle, its turn about Y to face the platform (a plane faces +Z), and its width. */
export interface PanelSpot {
  at: Point;
  yaw: number;
  width: number;
}

/** The whole map straight ahead, big; the others round the platform in rings, the nearer ring first. */
export const PANELS = {
  ahead: { at: { x: 0, y: 3.2, z: -9.5 }, width: 9.5 },
  width: 3.6,
  /** Each ring: how far out, how high, and how far round from straight ahead each of its spots is (degrees), filled in order. */
  rings: [
    { r: 7.5, y: 2.1, angles: [-48, 48, -84, 84, -120, 120, -156, 156] },
    { r: 10.5, y: 5.2, angles: [-40, 40, -70, 70, -100, 100, -130, 130] },
  ],
} as const;

/** The most views the space has room for. */
export const MAX_PANELS = 1 + PANELS.rings.reduce((n, ring) => n + ring.angles.length, 0);

/** Where the first `n` views go (at most MAX_PANELS): the first straight ahead, the rest round the rings. */
export function panelSpots(n: number): PanelSpot[] {
  const round = PANELS.rings.flatMap((ring) =>
    ring.angles.map((deg): PanelSpot => {
      const a = (deg * Math.PI) / 180;
      return { at: { x: ring.r * Math.sin(a), y: ring.y, z: -ring.r * Math.cos(a) }, yaw: -a, width: PANELS.width };
    }),
  );
  return [{ at: PANELS.ahead.at, yaw: 0, width: PANELS.ahead.width }, ...round].slice(0, Math.max(0, n));
}

/** How far from a view you can read it up close: from anywhere on the platform. */
export const reachOf = (spot: PanelSpot): number => Math.hypot(spot.at.x, spot.at.z) + PLATFORM.radius + 1;

/**
 * The astrometrics table in a project's holodeck (its training hall's frame, hallLayout.ts): on the floor between the
 * control ring and the wall on the entrance's side, opposite the PADD rack; and where you stand when you come back
 * through it, between it and the middle, looking into the hall.
 */
export const HALL_TABLE_ANGLE = (3 * Math.PI) / 4;
export function hallTable(): { at: Point; back: { at: Point; lookAt: Point } } {
  const at = around(7, HALL_TABLE_ANGLE);
  const back = around(5.2, HALL_TABLE_ANGLE);
  return { at: { x: at.x, y: 0, z: at.z }, back: { at: { x: back.x, y: 0, z: back.z }, lookAt: { x: 0, y: 1.6, z: 0 } } };
}
