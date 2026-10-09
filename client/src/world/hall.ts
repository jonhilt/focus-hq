import * as THREE from 'three';
import type { Project } from '../../../shared/types';
import type { Builder } from './builder';
import { around, CONTROL_RING, curvedPanel, ENTRANCE_X, facingIn, GAP } from './hallLayout';
import { DOOR_H, DOOR_W, HALL, WALL_T } from './layout';
import { box, flat, lighten, toon } from './materials';
import { HULL, LCARS, lcarsSign, readoutTexture } from './starship';

// The training hall: a holodeck that's bigger on the inside, after the hall of training pods the Cerritos crew drill
// in (Lower Decks, "I, Excretus"). Prototyped behind `?hall=1`. The holodeck's door on the deck is a Portal to the
// hall's entrance, so the hall stands out in the world (layout.ts: hallAt), round and tall, whatever the deck's
// slot can hold. Its frame is a room's: +X from the entrance to the far wall, where the board curves round the wall,
// with the team stations' pods round the wall either side of it and the desks in the control ring in the middle.
// Only its shell is built here; ProjectRoom fills it, from the hall's plan, as it fills today's room from its own.

const R = HALL.radius;
const H = HALL.height;
/**
 * Builds the hall's shell into `group` (the hall's frame, standing where hallAt puts it): floor, round wall, ceiling
 * and the flat wall with the entrance, and what the player can't walk through, in world space.
 */
export function buildHall(group: THREE.Group, project: Project, builder: Builder): void {
  const span = [-Math.PI + GAP, Math.PI - GAP] as const;
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
    const m = new THREE.Mesh(geo, mat);
    group.add(m);
    return m;
  };

  // the floor: carpet in the project's colour, the control ring brighter in the middle with an LCARS band round it
  const disc = (r: number, y: number, color: string) => {
    const m = add(new THREE.CircleGeometry(r, 96), toon(color));
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
  };
  disc(R + 0.1, 0.005, lighten(project.color, 0.6));
  disc(CONTROL_RING + 0.3, 0.01, LCARS.orange);
  disc(CONTROL_RING, 0.015, lighten(project.color, 0.4));

  // the round wall: a dark dado with a stripe over it, pale bulkhead up to a header band under the ceiling, a hair
  // in front of the wall so neither shares its plane, and too little to outline
  add(curvedPanel(R, ...span, 0, H, 96), toon(HULL.bulkhead));
  add(curvedPanel(R - 0.02, ...span, 0, 0.9, 96), toon(HULL.dado));
  add(curvedPanel(R - 0.02, ...span, 0.9, 0.98, 96), toon(HULL.stripe));
  add(curvedPanel(R - 0.02, ...span, H - 0.45, H, 96), toon(HULL.dado));
  // ribs up the wall between the pods and readouts
  for (const d of [-150, -120, -67.5, -33, 33, 67.5, 120, 150]) {
    const a = THREE.MathUtils.degToRad(d);
    const rib = box(0.32, H, 0.16, HULL.frame);
    rib.position.copy(around(R - 0.04, a, H / 2));
    rib.rotation.y = facingIn(a);
    group.add(rib);
  }
  // readouts on the wall round by the entrance
  for (const [i, d] of [-135, 135].entries()) {
    const a = THREE.MathUtils.degToRad(d);
    add(curvedPanel(R - 0.03, a - 0.16, a + 0.16, 1.25, 2.7, 8), flat(readoutTexture(768, 512, 11 + i)));
  }

  // the ceiling, with a ring of light round the middle
  const ceiling = add(new THREE.CircleGeometry(R + 0.1, 96), toon(HULL.ceiling));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = H;
  const glow = new THREE.MeshBasicMaterial({ color: '#fff6e0', toneMapped: false });
  for (const geo of [new THREE.RingGeometry(3.4, 4.0, 96), new THREE.CircleGeometry(1.0, 48)]) {
    const light = add(geo, glow);
    light.rotation.x = Math.PI / 2;
    light.position.y = H - 0.02;
  }

  // the flat wall with the entrance in it, and the entrance's frame
  const side = 2.4 - DOOR_W / 2;
  for (const s of [-1, 1]) group.add(box(WALL_T, H, side, HULL.bulkhead, ENTRANCE_X, 0, s * (DOOR_W / 2 + side / 2)));
  group.add(box(WALL_T, H - DOOR_H, DOOR_W, HULL.bulkhead, ENTRANCE_X, DOOR_H, 0));
  // its dado, stripe and header band, carried on from the round wall's, too little proud of it to outline
  const face = ENTRANCE_X + WALL_T / 2 + 0.01;
  for (const s of [-1, 1]) {
    const z = s * (DOOR_W / 2 + side / 2);
    group.add(box(0.02, 0.9, side, HULL.dado, face, 0, z), box(0.02, 0.08, side, HULL.stripe, face, 0.9, z));
  }
  group.add(box(0.02, 0.45, 4.8, HULL.dado, face, H - 0.45, 0));
  for (const s of [-1, 1]) group.add(box(WALL_T + 0.08, DOOR_H + 0.12, 0.14, HULL.frame, ENTRANCE_X, 0, s * (DOOR_W / 2 + 0.07)));
  group.add(box(WALL_T + 0.08, 0.12, DOOR_W + 0.28, HULL.frame, ENTRANCE_X, DOOR_H, 0));
  const sign = add(new THREE.PlaneGeometry(3.4, 0.62), flat(lcarsSign(project.name, { color: project.color, sub: 'Training hall' })));
  sign.rotation.y = Math.PI / 2;
  sign.position.set(ENTRANCE_X + WALL_T / 2 + 0.02, DOOR_H + 0.6, 0);

  // what the player can't walk through: a chain of small boxes round the wall, the entrance wall either side of the
  // doorway, and the back of the alcove behind it
  group.updateWorldMatrix(true, false);
  const world = (p: THREE.Vector3) => p.applyMatrix4(group.matrixWorld);
  const steps = Math.ceil(((span[1] - span[0]) * R) / 0.4);
  for (let i = 0; i <= steps; i++) {
    const p = world(around(R + 0.15, span[0] + ((span[1] - span[0]) * i) / steps));
    builder.collide(p.x - 0.3, p.x + 0.3, p.z - 0.3, p.z + 0.3);
  }
  const block = (x0: number, x1: number, z0: number, z1: number) => {
    const a = world(new THREE.Vector3(x0, 0, z0));
    const b = world(new THREE.Vector3(x1, 0, z1));
    builder.collide(a.x, b.x, a.z, b.z);
  };
  for (const s of [-1, 1]) block(ENTRANCE_X - WALL_T / 2 - HALL.alcove - 0.2, ENTRANCE_X + WALL_T / 2, s * (DOOR_W / 2), s * (DOOR_W / 2 + side + 0.3));
  block(ENTRANCE_X - WALL_T / 2 - HALL.alcove - 0.2, ENTRANCE_X - WALL_T / 2 - HALL.alcove, -DOOR_W / 2, DOOR_W / 2);
}
