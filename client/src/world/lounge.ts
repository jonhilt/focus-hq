import * as THREE from 'three';
import type { Builder } from './builder';
import { canvasTexture, makeCanvas } from './canvas';
import { LOUNGE, LOUNGE_DOOR_X, OFFICE, OVER_DOOR, WALL_H, WALL_T } from './layout';
import { box, flat, toon } from './materials';
import { ceilingLight, chair, cyl, plant } from './props';
import { LCARS, LCARS_FONT, lcarsConsole, lcarsFrame, lcarsSign, viewport } from './starship';

const TABLE = { x: 0.6, z: 21.3, length: 5.2, width: 1.5 };
/** Seats round the table: [x, z, facing], facing being the chair's rotation (0 faces +X). */
const SEATS: [number, number, number][] = [
  ...[-1.3, TABLE.x, 2.5].map((x): [number, number, number] => [x, TABLE.z + TABLE.width / 2 + 0.45, Math.PI / 2]),
  ...[-1.3, TABLE.x, 2.5].map((x): [number, number, number] => [x, TABLE.z - TABLE.width / 2 - 0.45, -Math.PI / 2]),
  [TABLE.x - TABLE.length / 2 - 0.5, TABLE.z, 0],
  [TABLE.x + TABLE.length / 2 + 0.5, TABLE.z, Math.PI],
];

/** The observation lounge: a long table under the viewports and a star chart on the wall. Scenery, built in world coordinates. */
export class Lounge {
  private screen = makeCanvas(1280, 768);
  private screenTex = canvasTexture(this.screen.canvas);

  constructor(b: Builder) {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.56), flat(lcarsSign('Observation lounge', { color: LCARS.lilac, code: '04-00' })));
    sign.position.set(LOUNGE_DOOR_X, 2.88, OFFICE.z1 - OVER_DOOR);
    sign.rotation.y = Math.PI;
    b.add(sign);

    // viewports along the outer hull
    for (const x of [-3.7, 0, 3.7]) {
      const w = viewport(3.0, 1.8); // 3 wide so the thick surrounds clear each other at 3.7 apart
      w.position.set(x, 1.85, LOUNGE.z1 - WALL_T / 2 - 0.005);
      w.rotation.y = Math.PI;
      b.add(w);
    }

    // the table: a dark stadium on two pedestals
    const table = new THREE.Group();
    table.position.set(TABLE.x, 0, TABLE.z);
    const top = '#2b2d42';
    const straight = TABLE.length - TABLE.width;
    table.add(box(straight, 0.07, TABLE.width, top, 0, 0.72, 0));
    for (const s of [-1, 1]) {
      const end = cyl(TABLE.width / 2, TABLE.width / 2, 0.07, top, 28);
      end.position.set((s * straight) / 2, 0.755, 0);
      table.add(end);
      table.add(box(0.5, 0.72, 0.5, '#495057', (s * straight) / 3, 0, 0));
    }
    table.add(box(straight * 0.8, 0.01, 0.12, LCARS.lilac, 0, 0.79, 0)); // a lit strip down the middle
    b.add(table);
    b.collide(TABLE.x - TABLE.length / 2, TABLE.x + TABLE.length / 2, TABLE.z - TABLE.width / 2, TABLE.z + TABLE.width / 2);

    for (const [x, z, facing] of SEATS) {
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      g.rotation.y = facing;
      g.add(chair('#7b2d43'));
      b.add(g);
    }

    // a star chart on the west wall, where everyone at the table can see it
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 2.4), flat(this.screenTex));
    screen.position.set(LOUNGE.x0 + 0.16, 1.75, TABLE.z);
    screen.rotation.y = Math.PI / 2;
    b.add(screen);
    b.add(box(0.08, 2.6, 4.2, '#212529', LOUNGE.x0 + 0.1, 0.45, TABLE.z));

    const panel = lcarsConsole(1.6, 1.0, 7);
    panel.position.set(LOUNGE.x1 - 0.13, 1.9, TABLE.z);
    panel.rotation.y = -Math.PI / 2;
    b.add(panel);
    for (const [x, z] of [[LOUNGE.x1 - 0.6, LOUNGE.z1 - 0.6], [LOUNGE.x1 - 0.6, LOUNGE.z0 + 0.6]]) {
      const p = plant(1.1, '#3d405b');
      p.position.set(x, 0, z);
      b.add(p);
      b.collideObject(p.children[0]);
    }
    for (const x of [-2.5, 3.2]) {
      const light = ceilingLight(1.6, 0.9);
      light.position.set(x, WALL_H - 0.03, TABLE.z);
      b.add(light);
    }
    const carpetStripe = new THREE.Mesh(new THREE.PlaneGeometry(TABLE.length + 2.4, TABLE.width + 2.6), toon('#4a4e74').clone());
    carpetStripe.material.userData.outlineParameters = { visible: false };
    carpetStripe.rotation.x = -Math.PI / 2;
    carpetStripe.position.set(TABLE.x, 0.008, TABLE.z);
    b.add(carpetStripe);

    drawStarChart(this.screen);
    this.screenTex.needsUpdate = true;
  }

  dispose(): void {
    this.screenTex.dispose();
  }
}

/** Long-range sensors: a scatter of stars (the same every time) and the course the ship has laid in across them. */
function drawStarChart({ canvas, ctx }: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }): void {
  const area = lcarsFrame(ctx, canvas.width, canvas.height, { title: 'Long-range sensors', color: LCARS.lilac, seed: 1864 });
  let seed = 1864;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 140; i++) {
    ctx.fillStyle = rand() > 0.85 ? LCARS.gold : '#e8e2f0';
    ctx.globalAlpha = 0.4 + rand() * 0.6;
    ctx.beginPath();
    ctx.arc(area.x + rand() * area.w, area.y + 40 + rand() * (area.h - 40), 1 + rand() * 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const course: [number, number][] = [[0.06, 0.82], [0.3, 0.6], [0.52, 0.66], [0.74, 0.38], [0.92, 0.22]];
  const at = ([u, v]: [number, number]): [number, number] => [area.x + u * area.w, area.y + 40 + v * (area.h - 40)];
  ctx.strokeStyle = LCARS.orange;
  ctx.lineWidth = 4;
  ctx.setLineDash([16, 12]);
  ctx.beginPath();
  for (const [i, point] of course.entries()) ctx[i ? 'lineTo' : 'moveTo'](...at(point));
  ctx.stroke();
  ctx.setLineDash([]);
  for (const point of course) {
    const [x, y] = at(point);
    ctx.fillStyle = LCARS.orange;
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = LCARS.peach;
  ctx.font = `600 40px ${LCARS_FONT}`;
  ctx.fillText('COURSE LAID IN', area.x, area.y);
}
