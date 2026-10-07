import * as THREE from 'three';
import { canvasTexture, makeCanvas } from './canvas';
import { box, flat, toon } from './materials';
import { LCARS } from './starship';

const cyl = (rt: number, rb: number, h: number, color: string, segments = 16) =>
  new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, segments), toon(color));
const capsule = (r: number, len: number, color: string) => new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 12), toon(color));
const ball = (r: number, color: string, segments = 14) => new THREE.Mesh(new THREE.SphereGeometry(r, segments, Math.round(segments * 0.75)), toon(color));

/** Office chair facing +X. */
export function chair(color: string): THREE.Group {
  const g = new THREE.Group();
  const seat = cyl(0.26, 0.26, 0.08, color);
  seat.position.y = 0.46;
  g.add(seat);
  // curved round the seat's edge, so it meets the seat all the way across, and leaning back from where it rises
  const back = new THREE.Group();
  back.position.set(-0.24, 0.46, 0);
  back.rotation.z = 0.12;
  const shell = new THREE.Mesh(seatBack(0.2, 0.28, 0.96, 0.54), toon(color));
  shell.position.x = 0.24;
  back.add(shell);
  g.add(back);
  // the pole stands on the floor, its legs spreading out from its foot and reaching a little below it, so they touch
  // the floor even when the chair's lifted clear of a carpet
  const pole = cyl(0.03, 0.03, 0.44, '#555');
  pole.position.y = 0.22;
  g.add(pole);
  for (let i = 0; i < 5; i++) {
    const leg = box(0.32, 0.035, 0.05, '#555', 0, -0.005, 0);
    leg.geometry = leg.geometry.clone().translate(0.16, 0, 0);
    leg.rotation.y = (i / 5) * Math.PI * 2;
    g.add(leg);
  }
  return g;
}

/** A curved chair back: an arc between radii r0 and r1 round the seat's centre, `spread` radians either side of -X, h tall. */
export function seatBack(r0: number, r1: number, spread: number, h: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, r1, Math.PI - spread, Math.PI + spread, false);
  shape.absarc(0, 0, r0, Math.PI + spread, Math.PI - spread, true);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 12 });
  // extruded along +Z; stand it up so it rises along +Y
  geo.rotateX(-Math.PI / 2);
  return geo;
}

export function plant(scale = 1, pot = '#e07a5f'): THREE.Group {
  const g = new THREE.Group();
  const p = cyl(0.22, 0.16, 0.4, pot);
  p.position.y = 0.2;
  g.add(p);
  const soil = cyl(0.2, 0.2, 0.02, '#5b3a29');
  soil.position.y = 0.4;
  g.add(soil);
  const greens = ['#3a9d5d', '#57c47a', '#2e8b57'];
  for (let i = 0; i < 5; i++) {
    const leaf = ball(0.2 + (i % 2) * 0.06, greens[i % 3]);
    const a = (i / 5) * Math.PI * 2;
    leaf.position.set(Math.cos(a) * 0.12, 0.62 + (i % 3) * 0.14, Math.sin(a) * 0.12);
    g.add(leaf);
  }
  const top = ball(0.2, greens[1]);
  top.position.y = 0.95;
  g.add(top);
  g.scale.setScalar(scale);
  return g;
}

export function ceilingLight(w = 1.2, d = 0.6): THREE.Mesh {
  const mat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  mat.userData.outlineParameters = { visible: false };
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, d), mat);
  return mesh;
}

/** A stack of paper folders, one per open pull request. */
export function paperStack(count: number, colors: string[]): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < count; i++) {
    // each folder lying on the one below
    const folder = box(0.32, 0.035, 0.24, colors[i % colors.length], 0, i * 0.035, 0);
    folder.rotation.y = (((i * 37) % 11) - 5) * 0.03;
    g.add(folder);
  }
  return g;
}

/** The PADD's face, drawn once and shared by every PADD. */
let paddScreen: THREE.MeshBasicMaterial | undefined;
function paddScreenMaterial(): THREE.MeshBasicMaterial {
  if (paddScreen) return paddScreen;
  const { canvas, ctx } = makeCanvas(200, 280);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 200, 280);
  // an LCARS elbow down the left, a header bar, and rows of readout
  ctx.fillStyle = LCARS.orange;
  ctx.beginPath();
  ctx.roundRect(8, 8, 120, 34, [17, 0, 0, 0]);
  ctx.fill();
  ctx.fillRect(8, 8, 34, 120);
  ctx.fillStyle = LCARS.lilac;
  ctx.fillRect(8, 134, 34, 64);
  ctx.fillStyle = LCARS.periwinkle;
  ctx.beginPath();
  ctx.roundRect(8, 204, 34, 68, [0, 0, 0, 17]);
  ctx.fill();
  ctx.fillStyle = LCARS.gold;
  ctx.beginPath();
  ctx.roundRect(136, 8, 56, 34, [0, 17, 17, 0]);
  ctx.fill();
  const rows = [LCARS.peach, LCARS.sky, LCARS.peach, LCARS.peach, LCARS.sky, LCARS.peach, LCARS.peach, LCARS.gold];
  rows.forEach((colour, i) => {
    ctx.fillStyle = colour;
    ctx.fillRect(54, 58 + i * 26, 70 + ((i * 47) % 70), 12);
  });
  paddScreen = flat(canvasTexture(canvas));
  return paddScreen;
}

/** A Starfleet PADD, upright with its screen facing -X; it spans PADD_WIDTH along z and is centred on its origin. */
export const PADD_WIDTH = 0.26;
export function padd(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'padd';
  // its own geometries rather than box()'s shared ones, so whoever holds it can dispose them
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.34, PADD_WIDTH), toon('#2b2d42')));
  // the cap stands clear of the body on every side, so their faces don't fight
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.03, PADD_WIDTH + 0.006), toon(LCARS.gold));
  cap.position.y = 0.16;
  g.add(cap);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.26), paddScreenMaterial());
  screen.rotation.y = -Math.PI / 2;
  screen.position.set(-0.0175, -0.01, 0);
  g.add(screen);
  return g;
}

export { ball, capsule, cyl };
