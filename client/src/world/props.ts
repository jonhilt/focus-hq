import * as THREE from 'three';
import { box, darken, lighten, toon } from './materials';

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

/** Chunky cartoon laptop; the returned screen mesh faces -X (towards whoever sits at it). */
export function laptop(screen: THREE.Material, shell = '#b8c0cc'): { group: THREE.Group; screen: THREE.Mesh; lid: THREE.Group } {
  const g = new THREE.Group();
  g.add(box(0.5, 0.035, 0.84, shell, 0, 0, 0));
  g.add(box(0.3, 0.006, 0.7, '#4a4f5a', -0.06, 0.035, 0)); // keyboard
  const lid = new THREE.Group();
  lid.position.set(0.24, 0.035, 0);
  lid.rotation.z = -0.22;
  g.add(lid);
  lid.add(box(0.03, 0.58, 0.84, shell, 0.015, 0, 0));
  lid.add(box(0.005, 0.58, 0.84, '#22252c', -0.003, 0, 0)); // bezel
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.5), screen);
  plane.rotation.y = -Math.PI / 2;
  plane.position.set(-0.007, 0.29, 0);
  lid.add(plane);
  return { group: g, screen: plane, lid };
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
  g.add(box(0.05, 2.0, width, darken(wood, 0.15), 0.18, 0, 0));
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

export { ball, capsule, cyl };
