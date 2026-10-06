import * as THREE from 'three';
import { canvasTexture, makeCanvas } from './canvas';
import { box, darken, flat, lighten, toon } from './materials';
import { LCARS } from './starship';

const cyl = (rt: number, rb: number, h: number, color: string, segments = 16) =>
  new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, segments), toon(color));
const capsule = (r: number, len: number, color: string) => new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 12), toon(color));
const ball = (r: number, color: string, segments = 14) => new THREE.Mesh(new THREE.SphereGeometry(r, segments, Math.round(segments * 0.75)), toon(color));

export const DESK_TOP = 0.76;

/** A desk spanning `width` along z and `depth` along x, top at DESK_TOP. */
export function desk(width = 1.8, depth = 1.0, top = '#f5f0e6', legs = '#8d99ae'): THREE.Group {
  const g = new THREE.Group();
  g.add(box(depth, 0.06, width, top, 0, DESK_TOP - 0.06, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.06, DESK_TOP - 0.06, 0.06, legs, sx * (depth / 2 - 0.08), 0, sz * (width / 2 - 0.08)));
  // modesty panel on the far side
  g.add(box(0.03, 0.4, width - 0.2, darken(top, 0.08), depth / 2 - 0.1, 0.3, 0));
  return g;
}

/** Office chair facing +X. */
export function chair(color: string): THREE.Group {
  const g = new THREE.Group();
  const seat = cyl(0.26, 0.26, 0.08, color);
  seat.position.y = 0.46;
  g.add(seat);
  const back = box(0.08, 0.5, 0.46, color, -0.24, 0.5, 0);
  back.rotation.z = 0.12;
  g.add(back);
  const pole = cyl(0.03, 0.03, 0.36, '#555');
  pole.position.y = 0.24;
  g.add(pole);
  for (let i = 0; i < 5; i++) {
    const leg = box(0.32, 0.03, 0.05, '#555', 0, 0.04, 0);
    leg.geometry = leg.geometry.clone().translate(0.16, 0, 0);
    leg.rotation.y = (i / 5) * Math.PI * 2;
    g.add(leg);
  }
  return g;
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

export function sofa(color: string): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.9, 0.42, 2.2, color, 0, 0, 0));
  g.add(box(0.25, 0.5, 2.2, darken(color, 0.1), -0.33, 0.42, 0));
  for (const s of [-1, 1]) g.add(box(0.9, 0.3, 0.22, darken(color, 0.1), 0, 0.42, s * 1.0));
  for (const s of [-1, 1]) g.add(box(0.55, 0.12, 0.85, lighten(color, 0.15), 0.08, 0.42, s * 0.45));
  return g;
}

export function coffeeMachine(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.7, 0.9, 1.2, '#6d4c41', 0, 0, 0)); // counter
  g.add(box(0.45, 0.55, 0.4, '#e63946', 0, 0.9, -0.2));
  g.add(box(0.1, 0.12, 0.2, '#222', -0.2, 1.05, -0.2));
  const mug = cyl(0.05, 0.045, 0.1, '#fff');
  mug.position.set(-0.15, 0.95, -0.2);
  g.add(mug);
  for (let i = 0; i < 3; i++) {
    const m = cyl(0.05, 0.045, 0.1, ['#ffd166', '#06d6a0', '#118ab2'][i]);
    m.position.set(-0.05, 0.95, 0.15 + i * 0.13);
    g.add(m);
  }
  return g;
}

export function waterCooler(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.4, 0.95, 0.4, '#f1f1f1', 0, 0, 0));
  const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.45, 16), new THREE.MeshToonMaterial({ color: '#8ecae6', transparent: true, opacity: 0.75 }));
  bottle.position.y = 1.18;
  g.add(bottle);
  return g;
}

export function bookshelf(width = 1.6): THREE.Group {
  const g = new THREE.Group();
  const wood = '#a0693b';
  g.add(box(0.4, 2.0, 0.05, wood, 0, 0, -width / 2));
  g.add(box(0.4, 2.0, 0.05, wood, 0, 0, width / 2));
  g.add(box(0.05, 2.0, width - 0.05, darken(wood, 0.15), 0.18, 0, 0)); // between the sides, not flush with their tops
  const colors = ['#e63946', '#457b9d', '#f4a261', '#2a9d8f', '#8338ec', '#ffbe0b'];
  for (let s = 0; s < 4; s++) {
    const y = s * 0.5;
    g.add(box(0.4, 0.04, width, wood, 0, y, 0));
    let z = -width / 2 + 0.08;
    let i = s;
    while (z < width / 2 - 0.15) {
      const w = 0.06 + ((i * 7) % 5) * 0.012;
      const h = 0.3 + ((i * 3) % 4) * 0.03;
      g.add(box(0.28, h, w, colors[i % colors.length], -0.02, y + 0.04, z + w / 2));
      z += w + 0.01;
      i++;
    }
  }
  return g;
}

export function ceilingLight(w = 1.2, d = 0.6): THREE.Mesh {
  const mat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  mat.userData.outlineParameters = { visible: false };
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, d), mat);
  return mesh;
}

export function rug(color: string, w: number, d: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), toon(color).clone());
  mesh.material.userData.outlineParameters = { visible: false };
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.01;
  return mesh;
}

/** A stack of paper folders, one per open pull request. */
export function paperStack(count: number, colors: string[]): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const folder = box(0.32, 0.035, 0.24, colors[i % colors.length], 0, i * 0.04, 0);
    folder.rotation.y = (((i * 37) % 11) - 5) * 0.03;
    g.add(folder);
  }
  return g;
}

export function trophy(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.16, 0.06, 0.16, '#5d4037', 0, 0, 0));
  const stem = cyl(0.025, 0.04, 0.12, '#ffc107');
  stem.position.y = 0.12;
  g.add(stem);
  const cup = cyl(0.1, 0.05, 0.14, '#ffc107');
  cup.position.y = 0.25;
  g.add(cup);
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
