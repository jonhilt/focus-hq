import * as THREE from 'three';
import type { Project, RoomTheme } from '../../../shared/types';
import { ROOM_THEMES } from '../../../shared/types';
import { canvasTexture, makeCanvas, UI_FONT } from './canvas';
import { hashString, Kit, Scenery } from './scenery';
import { checkerTexture } from './textures';

export const THEME_INFO: Record<RoomTheme, { label: string; emoji: string; holo: string }> = {
  beach: { label: 'Tropical beach', emoji: '🏝️', holo: '#e8fdff' },
  forest: { label: 'Forest clearing', emoji: '🌲', holo: '#f0ffe0' },
  desert: { label: 'Desert canyon', emoji: '🌵', holo: '#fff4dc' },
  moon: { label: 'Moon base', emoji: '🌙', holo: '#a5dcff' },
  city: { label: 'Rooftop at dusk', emoji: '🌆', holo: '#ffb3ec' },
  library: { label: 'The great library', emoji: '📚', holo: '#ffe7a8' },
  office: { label: 'Plain holodeck grid', emoji: '🏢', holo: '#ffffff' },
};

const SCENIC = ROOM_THEMES.filter((t) => t !== 'office');

/** The project's theme; projects from before themes existed get a stable pick from their id. */
export function roomTheme(project: Project): RoomTheme {
  return project.theme ?? SCENIC[hashString(project.id) % SCENIC.length];
}

const BUILDERS: Record<Exclude<RoomTheme, 'office'>, (k: Kit) => void> = { beach, forest, desert, moon, city, library };

/** Builds the landscape around a room. `ref` must be unique per room (it's the stencil value). */
export function createScenery(theme: RoomTheme, ref: number, seed: string, sunDir: THREE.Vector3): Scenery | null {
  if (theme === 'office') return null;
  const kit = new Kit(ref, hashString(seed), sunDir);
  BUILDERS[theme](kit);
  return new Scenery(kit, THEME_INFO[theme].holo);
}

// ------------------------------------------------------------------------------------------------ textures

const texCache = new Map<string, THREE.Texture>();
function cachedTexture(key: string, make: () => THREE.Texture): THREE.Texture {
  let tex = texCache.get(key);
  if (!tex) texCache.set(key, (tex = make()));
  return tex;
}

/** Base colour with small dots, for sand, grass, regolith and concrete. */
function speckle(base: string, dots: string[], count = 260): THREE.Texture {
  return cachedTexture(`speckle${base}${dots.join()}`, () => {
    const { canvas, ctx } = makeCanvas(128, 128);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < count; i++) {
      ctx.fillStyle = dots[i % dots.length];
      const s = 1 + (i % 3);
      ctx.fillRect((i * 73.13) % 128, (i * 41.71 + (i % 7) * 17) % 128, s, s);
    }
    return canvasTexture(canvas);
  });
}

function earthTexture(): THREE.Texture {
  return cachedTexture('earth', () => {
    const { canvas, ctx } = makeCanvas(512, 256);
    ctx.fillStyle = '#2f7fd8';
    ctx.fillRect(0, 0, 512, 256);
    const blob = (x: number, y: number, r: number, color: string) => {
      ctx.fillStyle = color;
      for (let i = 0; i < 9; i++) {
        ctx.beginPath();
        ctx.arc(x + Math.cos(i * 2.4) * r * 0.7, y + Math.sin(i * 1.7) * r * 0.5, r * (0.45 + (i % 3) * 0.15), 0, Math.PI * 2);
        ctx.fill();
      }
    };
    for (const [x, y, r] of [[90, 90, 38], [130, 170, 30], [250, 80, 34], [280, 160, 42], [400, 100, 46], [440, 190, 22]]) blob(x, y, r, '#55b35b');
    for (const [x, y, r] of [[270, 140, 16], [410, 90, 18]]) blob(x, y, r, '#d9c27a');
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(0, 0, 512, 16);
    ctx.fillRect(0, 240, 512, 16);
    for (let i = 0; i < 14; i++) {
      ctx.beginPath();
      ctx.ellipse((i * 97) % 512, 40 + ((i * 53) % 180), 40, 7, 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
    return canvasTexture(canvas);
  });
}

/** 8×8 cells of facade with windows, some lit. */
function facadeTexture(facade: string, seed: number): THREE.Texture {
  return cachedTexture(`facade${facade}${seed}`, () => {
    const { canvas, ctx } = makeCanvas(256, 256);
    ctx.fillStyle = facade;
    ctx.fillRect(0, 0, 256, 256);
    let s = seed;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const r = rnd();
        ctx.fillStyle = r < 0.42 ? (r < 0.08 ? '#9fe7ff' : r < 0.25 ? '#ffd27a' : '#ffe9b0') : '#1b1830';
        ctx.fillRect(x * 32 + 7, y * 32 + 6, 18, 20);
      }
    }
    return canvasTexture(canvas);
  });
}

function bookshelfTexture(): THREE.Texture {
  return cachedTexture('bookshelf', () => {
    const { canvas, ctx } = makeCanvas(512, 512);
    ctx.fillStyle = '#3e2618';
    ctx.fillRect(0, 0, 512, 512);
    const colors = ['#9b2335', '#2f5d8a', '#3f7d4a', '#c8963e', '#6b3e75', '#b5532f', '#1f4e5a', '#d9c7a1', '#8c2f39'];
    let n = 0;
    for (let shelf = 0; shelf < 4; shelf++) {
      const base = shelf * 128 + 112;
      let x = 4;
      while (x < 500) {
        const w = 10 + ((n * 7) % 17);
        const h = 70 + ((n * 13) % 34);
        if (n % 23 === 7) {
          x += 18; // a gap
        } else {
          ctx.fillStyle = colors[(n * 5) % colors.length];
          ctx.fillRect(x, base - h, w, h);
          ctx.fillStyle = 'rgba(255,215,120,0.55)';
          if (n % 3 === 0) ctx.fillRect(x, base - h + 10, w, 3);
          ctx.fillStyle = 'rgba(0,0,0,0.25)';
          ctx.fillRect(x + w - 2, base - h, 2, h);
          x += w + 1;
        }
        n++;
      }
      ctx.fillStyle = '#7a5136';
      ctx.fillRect(0, base, 512, 16);
      ctx.fillStyle = '#5c3b26';
      ctx.fillRect(0, base + 12, 512, 4);
    }
    return canvasTexture(canvas);
  });
}

function archWindowTexture(): THREE.Texture {
  return cachedTexture('arch', () => {
    const { canvas, ctx } = makeCanvas(512, 640);
    ctx.fillStyle = '#cdb894';
    ctx.fillRect(0, 0, 512, 640);
    const arch = () => {
      ctx.beginPath();
      ctx.moveTo(40, 640);
      ctx.lineTo(40, 256);
      ctx.arc(256, 256, 216, Math.PI, 0);
      ctx.lineTo(472, 640);
      ctx.closePath();
    };
    const g = ctx.createLinearGradient(0, 0, 0, 640);
    g.addColorStop(0, '#9fd3ff');
    g.addColorStop(1, '#fff4d6');
    ctx.fillStyle = g;
    arch();
    ctx.fill();
    ctx.save();
    arch();
    ctx.clip();
    ctx.strokeStyle = '#4a3324';
    ctx.lineWidth = 10;
    for (let x = 40; x <= 472; x += 72) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 640);
      ctx.stroke();
    }
    for (let y = 120; y < 640; y += 96) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(512, y);
      ctx.stroke();
    }
    ctx.restore();
    ctx.lineWidth = 16;
    ctx.strokeStyle = '#8c6a48';
    arch();
    ctx.stroke();
    return canvasTexture(canvas);
  });
}

function labelTexture(text: string, opts: { w: number; h: number; bg: string; fg: string; glow?: string; font?: number; ring?: string }): THREE.Texture {
  return cachedTexture(`label${text}${JSON.stringify(opts)}`, () => {
    const { canvas, ctx } = makeCanvas(opts.w, opts.h);
    ctx.fillStyle = opts.bg;
    ctx.fillRect(0, 0, opts.w, opts.h);
    if (opts.ring) {
      ctx.strokeStyle = opts.ring;
      ctx.lineWidth = opts.h * 0.06;
      ctx.beginPath();
      ctx.arc(opts.w / 2, opts.h / 2, opts.h * 0.4, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.font = `700 ${opts.font ?? opts.h * 0.5}px ${UI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (opts.glow) {
      ctx.shadowColor = opts.glow;
      ctx.shadowBlur = opts.h * 0.12;
    }
    ctx.fillStyle = opts.fg;
    ctx.fillText(text, opts.w / 2, opts.h / 2 + opts.h * 0.04);
    ctx.fillText(text, opts.w / 2, opts.h / 2 + opts.h * 0.04);
    return canvasTexture(canvas);
  });
}

// ------------------------------------------------------------------------------------------------ shared props

/** Keeps random placements a little apart. */
function spacer(minGap: number): (p: THREE.Vector3) => boolean {
  const taken: THREE.Vector3[] = [];
  return (p) => {
    if (taken.some((q) => q.distanceToSquared(p) < minGap * minGap)) return false;
    taken.push(p);
    return true;
  };
}

/** Is a ground point clear of the room (with a margin)? */
const clearOfRoom = (p: THREE.Vector3, margin = 1.2) => Math.abs(p.x) > 7 + margin || Math.abs(p.z) > 6 + margin;

function rock(k: Kit, r: number, color: string, x: number, z: number): THREE.Mesh {
  const m = k.mesh(new THREE.DodecahedronGeometry(r, 0), color, [x, r * 0.35, z]);
  m.scale.set(k.range(0.9, 1.4), k.range(0.5, 0.8), k.range(0.9, 1.3));
  m.rotation.set(k.range(0, 1), k.range(0, 6), k.range(0, 1));
  return m;
}

function mountain(k: Kit, x: number, z: number, r: number, h: number, color: string, snow?: string): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, -1, z);
  g.rotation.y = k.range(0, Math.PI);
  g.add(k.cone(r, h, color, 0, 0, 0, 7));
  // the cap is the top of the slope lifted clear of it: 150m out, a smaller lift loses the depth test to the rock
  if (snow) g.add(k.cone(r * 0.33, h * 0.33, snow, 0, h * 0.69, 0, 7));
  return g;
}

/** Wide, low mound: a squashed ball half sunk into the ground. */
function mound(k: Kit, x: number, z: number, r: number, h: number, color: string): THREE.Mesh {
  const m = k.ball(1, color, x, 0, z, 18);
  m.scale.set(r, h, r * k.range(0.7, 1.2));
  m.rotation.y = k.range(0, Math.PI);
  return m;
}

// ------------------------------------------------------------------------------------------------ beach

function palm(k: Kit, height: number, lean: number): THREE.Group {
  const g = new THREE.Group();
  const n = 7;
  const pts = Array.from({ length: n + 1 }, (_, i) => new THREE.Vector3(lean * (i / n) ** 2 * height, (i / n) * height, 0));
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    const dir = pts[i + 1].clone().sub(pts[i]);
    const r = 0.26 - 0.1 * (i / n);
    const seg = k.mesh(new THREE.CylinderGeometry(r * 0.85, r, dir.length() * 1.04, 8), i % 2 ? '#a8713f' : '#8f5d31');
    seg.position.copy(pts[i]).add(pts[i + 1]).multiplyScalar(0.5);
    seg.quaternion.setFromUnitVectors(up, dir.normalize());
    g.add(seg);
  }
  const top = pts[n];
  for (let i = 0; i < 8; i++) {
    const leaf = new THREE.Group();
    leaf.position.copy(top);
    leaf.rotation.y = (i / 8) * Math.PI * 2 + k.range(-0.2, 0.2);
    const color = i % 2 ? '#3dbb5c' : '#2e9c4b';
    const inner = k.ball(1, color, 0, 0, 0, 8);
    inner.scale.set(1.1, 0.1, 0.34);
    inner.position.set(0.95, 0.25, 0);
    inner.rotation.z = 0.25;
    const outer = k.ball(1, color, 0, 0, 0, 8);
    outer.scale.set(1.0, 0.09, 0.3);
    outer.position.set(2.6, -0.25, 0);
    outer.rotation.z = -0.5;
    leaf.add(inner, outer);
    g.add(leaf);
  }
  for (let i = 0; i < 3; i++) g.add(k.ball(0.17, '#6b4423', top.x + Math.cos(i * 2.1) * 0.25, top.y - 0.2, Math.sin(i * 2.1) * 0.25, 6));
  g.rotation.y = k.range(0, Math.PI * 2);
  return g;
}

function umbrella(k: Kit, a: string, b: string): THREE.Group {
  const g = new THREE.Group();
  g.add(k.cyl(0.04, 0.04, 2.3, '#f1f3f5', 0, 0, 0, 6));
  for (let i = 0; i < 8; i++) {
    const wedge = k.mesh(new THREE.ConeGeometry(1.5, 0.55, 2, 1, true, (i * Math.PI) / 4, Math.PI / 4), k.toon(i % 2 ? a : b, { side: THREE.DoubleSide }));
    wedge.position.y = 2.3 + 0.275;
    g.add(wedge);
  }
  g.rotation.z = 0.12;
  return g;
}

function beach(k: Kit): void {
  k.sky('#2f9cf0', '#c4ecff', '#9ad6ec', 0.55);
  k.disc(k.sunDir, 170, 9, '#fff4b8', '#fffbe0');
  k.clouds(12);
  k.ground('#f4d9a1', speckle('#f4d9a1', ['#e9c98a', '#fbe7be', '#dcb87a']), 2.5);

  // the sea, in front of the far wall
  const SHORE = 15;
  const sea = new THREE.PlaneGeometry(210, 420, 42, 1).rotateX(-Math.PI / 2).translate(SHORE + 105, 0.02, 0);
  const shallow = new THREE.Color('#5ad8de');
  const deep = new THREE.Color('#2399d6');
  const haze = new THREE.Color('#8fd0ee');
  const pos = sea.attributes.position;
  const colors: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const c = x < 45 ? shallow.clone().lerp(deep, (x - SHORE) / 30) : deep.clone().lerp(haze, Math.min(1, (x - 45) / 150));
    colors.push(c.r, c.g, c.b);
  }
  sea.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  k.add(k.mesh(sea, k.basic('#ffffff', { vertexColors: true })));
  k.add(k.mesh(new THREE.PlaneGeometry(4, 420).rotateX(-Math.PI / 2), k.basic('#e3c088'), [SHORE - 1.6, 0.01, 0])); // wet sand

  // lapping foam lines
  const foam = (offset: number, phase: number) => {
    const geo = new THREE.PlaneGeometry(0.5, 420, 1, 160).rotateX(-Math.PI / 2);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) + Math.sin(p.getZ(i) * 0.35) * 0.35 + Math.sin(p.getZ(i) * 0.11) * 0.6);
    const m = k.mesh(geo, k.basic('#ffffff'), [SHORE + offset, 0.04, 0]);
    k.animate(m, (o, t) => (o.position.x = SHORE + offset + Math.sin(t * 0.7 + phase) * 0.6));
  };
  foam(0, 0);
  foam(4, 1.8);

  // palms: a few close to the walls, more scattered inland
  const near: [number, number, number][] = [[10.5, 9, 6], [-3, 9.5, 7], [2, -10.5, 6.5], [11.5, -13, 7.5], [-11, -7, 7], [-12.5, 5, 6], [-17, -1, 8]];
  for (const [x, z, h] of near) {
    const p = palm(k, h, k.range(0.15, 0.35));
    p.position.set(x, 0, z);
    k.add(p);
  }
  const ok = spacer(5);
  for (let i = 0, placed = 0; i < 200 && placed < 22; i++) {
    const p = k.around(16, 75);
    if (p.x > 9 || !ok(p)) continue;
    const tree = palm(k, k.range(6, 9.5), k.range(0.1, 0.4));
    tree.position.copy(p);
    k.add(tree);
    placed++;
  }
  for (let i = 0; i < 14; i++) {
    const p = k.around(9, 40);
    if (p.x > 11 || !clearOfRoom(p)) continue;
    k.add(k.ball(k.range(0.4, 0.8), k.pick(['#56b15a', '#4aa34f']), p.x, 0.1, p.z, 10)).scale.y = 0.6;
  }

  // a spot on the sand: umbrella, towel, ball and a sandcastle
  const brolly = umbrella(k, '#ff5d5d', '#ffffff');
  brolly.position.set(10, 0, -7.5);
  k.add(brolly);
  k.add(k.box(0.9, 0.03, 1.9, '#4dabf7', 9.6, 0, -6));
  k.add(k.box(0.9, 0.035, 0.3, '#ffd43b', 9.6, 0, -6.4));
  const ballColors = ['#ff6b6b', '#ffffff', '#4dabf7', '#ffffff', '#ffd43b', '#ffffff'];
  ballColors.forEach((c, i) => k.add(k.mesh(new THREE.SphereGeometry(0.3, 4, 8, (i * Math.PI) / 3, Math.PI / 3), c, [11.2, 0.3, -4.6])));
  const castle = new THREE.Group();
  castle.position.set(9.2, 0, 3.2);
  castle.add(k.box(1.4, 0.45, 1.4, '#e7c182'));
  castle.add(k.box(0.7, 0.85, 0.7, '#e7c182'));
  for (const [x, z] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) {
    castle.add(k.cyl(0.2, 0.24, 0.75, '#ddb574', x, 0, z, 8));
    castle.add(k.cone(0.24, 0.3, '#e7c182', x, 0.75, z, 8));
  }
  castle.add(k.cyl(0.015, 0.015, 0.5, '#6b4423', 0, 0.85, 0, 4));
  castle.add(k.box(0.02, 0.16, 0.26, '#ff6b6b', 0, 1.18, 0.13));
  k.add(castle);

  for (let i = 0; i < 9; i++) k.add(rock(k, k.range(0.4, 1.3), k.pick(['#9aa5b1', '#8592a0']), SHORE + k.range(-1, 9), k.range(-40, 40)));

  // an island and a sailboat out at sea
  k.add(mound(k, 120, -45, 16, 3.5, '#f0d29a'));
  k.add(mound(k, 120, -45, 11, 5, '#4caf6a'));
  for (const dz of [-4, 3]) {
    const p = palm(k, 9, 0.3);
    p.position.set(118, 3, -45 + dz);
    p.scale.setScalar(1.2);
    k.add(p);
  }
  const boat = new THREE.Group();
  boat.add(k.box(4, 0.8, 1.4, '#ffffff', 0, -0.3, 0));
  boat.add(k.box(4.02, 0.2, 1.42, '#1971c2', 0, -0.1, 0));
  boat.add(k.cyl(0.06, 0.06, 5, '#8d6e63', 0.4, 0.5, 0, 6));
  const sail = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0, 4.4), new THREE.Vector2(2.4, 0)]);
  boat.add(k.mesh(new THREE.ShapeGeometry(sail), k.toon('#fffdf5', { side: THREE.DoubleSide }), [0.5, 0.9, 0]));
  const jib = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0, 3.6), new THREE.Vector2(-1.7, 0)]);
  boat.add(k.mesh(new THREE.ShapeGeometry(jib), k.toon('#ff6b6b', { side: THREE.DoubleSide }), [0.3, 0.9, 0]));
  boat.position.set(48, 0, 22);
  boat.rotation.y = 0.6;
  k.animate(boat, (o, t) => {
    o.position.y = Math.sin(t * 1.3) * 0.12;
    o.rotation.z = Math.sin(t * 0.9) * 0.05;
  }, true);
}

// ------------------------------------------------------------------------------------------------ forest

function pine(k: Kit, h: number): THREE.Group {
  const g = new THREE.Group();
  g.add(k.cyl(0.18 * h * 0.12, 0.25 * h * 0.12, h * 0.25, '#7a5233', 0, 0, 0, 6));
  const greens = ['#2e8b57', '#37a065', '#45b072'];
  for (let i = 0; i < 3; i++) g.add(k.cone(h * (0.3 - i * 0.065), h * 0.42, greens[i], 0, h * (0.18 + i * 0.22), 0, 8));
  return g;
}

function roundTree(k: Kit, h: number): THREE.Group {
  const g = new THREE.Group();
  g.add(k.cyl(0.15 * h * 0.1, 0.22 * h * 0.1, h * 0.5, '#8a5a3b', 0, 0, 0, 6));
  const c = k.pick(['#58b947', '#4aa83d', '#6cc24a']);
  g.add(k.ball(h * 0.3, c, 0, h * 0.68, 0));
  g.add(k.ball(h * 0.22, c, h * 0.2, h * 0.58, h * 0.08));
  g.add(k.ball(h * 0.2, c, -h * 0.16, h * 0.6, -h * 0.1));
  return g;
}

function forest(k: Kit): void {
  k.sky('#4aa8f0', '#d7f0ff', '#cfe8d0', 0.55);
  k.disc(k.sunDir, 170, 8, '#fff4b8', '#fffbe0');
  k.clouds(13);
  k.ground('#86c96a', speckle('#86c96a', ['#79bd5e', '#93d377', '#6fb556']), 2);

  // a dirt path wandering away from the far wall, and a pond
  const pathZ = (x: number) => Math.sin(x * 0.08) * 3;
  for (let x = 7.5; x < 60; x += 1.6) {
    const m = k.mesh(new THREE.CircleGeometry(1.3, 14).rotateX(-Math.PI / 2), k.basic('#d8b47a'), [x, 0.01, pathZ(x)]);
    m.scale.set(1.2, 1, 1);
    k.add(m);
  }
  const POND = new THREE.Vector3(15, 0, 15);
  const pond = k.mesh(new THREE.CircleGeometry(5, 32).rotateX(-Math.PI / 2), k.basic('#c7ab7c'), [POND.x, 0.01, POND.z]);
  pond.scale.set(1.35, 1, 1);
  k.add(pond);
  const water = k.mesh(new THREE.CircleGeometry(4.4, 32).rotateX(-Math.PI / 2), k.basic('#5bb8e8'), [POND.x, 0.02, POND.z]);
  water.scale.set(1.35, 1, 1);
  k.add(water);
  for (let i = 0; i < 5; i++) k.add(k.mesh(new THREE.CircleGeometry(0.5, 10).rotateX(-Math.PI / 2), k.basic('#4caf50'), [POND.x + k.range(-4, 4), 0.03, POND.z + k.range(-2.5, 2.5)]));

  const free = (p: THREE.Vector3, gap: number) =>
    clearOfRoom(p, 1.5) && !(p.x > 5 && Math.abs(p.z - pathZ(p.x)) < 3.2 + gap) && p.distanceTo(POND) > 7.5 + gap;
  const ok = spacer(3.4);
  for (let i = 0, placed = 0; i < 900 && placed < 130; i++) {
    const p = k.around(10, 95);
    if (!free(p, 0.5) || !ok(p)) continue;
    const h = k.range(5, 10) * (p.length() > 40 ? 1.3 : 1);
    const tree = k.random() < 0.55 ? pine(k, h) : roundTree(k, h * 0.8);
    tree.position.copy(p);
    tree.rotation.y = k.range(0, Math.PI * 2);
    k.add(tree);
    placed++;
  }
  for (let i = 0; i < 40; i++) {
    const p = k.around(8.5, 30);
    if (!free(p, -1)) continue;
    const c = k.pick(['#4caf50', '#5cbf55', '#43a047']);
    k.add(k.ball(k.range(0.4, 0.9), c, p.x, 0.15, p.z, 10)).scale.y = 0.7;
  }
  for (let i = 0; i < 110; i++) {
    const p = k.around(8, 28);
    if (!free(p, -2)) continue;
    k.add(k.ball(0.09, k.pick(['#ff8fab', '#ffd43b', '#ffffff', '#b197fc']), p.x, 0.12, p.z, 6));
  }
  for (const [x, z] of [[9.5, -8.5], [-3, -9], [12, 4.8]]) {
    k.add(k.cyl(0.05, 0.07, 0.22, '#fff3e0', x, 0, z, 6));
    k.add(k.mesh(new THREE.SphereGeometry(0.2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#e03131', [x, 0.2, z]));
  }
  const log = k.cyl(0.35, 0.35, 3.2, '#8a5a3b', 0, 0, 0, 10);
  log.rotation.z = Math.PI / 2;
  log.position.set(10.5, 0.35, -12);
  log.rotation.y = 0.5;
  k.add(log);
  for (let i = 0; i < 6; i++) {
    const p = k.around(9, 30);
    if (free(p, 0)) k.add(rock(k, k.range(0.4, 1.1), '#9aa5b1', p.x, p.z));
  }

  for (let i = 0; i < 9; i++) {
    const p = k.around(60, 105);
    k.add(mound(k, p.x, p.z, k.range(18, 32), k.range(5, 10), k.pick(['#79bf5e', '#6db455'])));
  }
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + k.range(-0.2, 0.2);
    const r = k.range(150, 172);
    k.add(mountain(k, Math.cos(a) * r, Math.sin(a) * r, k.range(25, 42), k.range(38, 66), '#8fa9c9', '#f4f8ff'));
  }
}

// ------------------------------------------------------------------------------------------------ desert

function saguaro(k: Kit, h: number): THREE.Group {
  const g = new THREE.Group();
  const green = '#4e9a4f';
  const trunk = k.mesh(new THREE.CapsuleGeometry(0.3, h, 4, 10), green, [0, h / 2 + 0.3, 0]);
  g.add(trunk);
  for (const side of [-1, 1]) {
    if (k.random() < 0.25) continue;
    const y = h * k.range(0.35, 0.55);
    const reach = k.range(0.6, 0.9);
    const arm = k.mesh(new THREE.CapsuleGeometry(0.22, reach, 4, 8), green, [side * (reach / 2 + 0.2), y, 0]);
    arm.rotation.z = Math.PI / 2;
    g.add(arm);
    const up = k.range(0.8, 1.6);
    g.add(k.mesh(new THREE.CapsuleGeometry(0.22, up, 4, 8), green, [side * (reach + 0.25), y + up / 2, 0]));
  }
  g.rotation.y = k.range(0, Math.PI);
  return g;
}

function mesa(k: Kit, r: number, h: number): THREE.Group {
  const g = new THREE.Group();
  const layers = ['#b5532f', '#cc6a3c', '#d98552', '#c4643a'];
  let y = -1;
  for (let i = 0; i < layers.length; i++) {
    const lh = (h + 1) / layers.length;
    const rr = r * (1 - i * 0.05);
    g.add(k.cyl(rr * 0.97, rr, lh, layers[i], 0, y, 0, 7));
    y += lh;
  }
  g.rotation.y = k.range(0, Math.PI);
  return g;
}

function desert(k: Kit): void {
  k.sky('#3a96e8', '#ffe6b8', '#f2c48f', 0.5, '#9fd2f7');
  k.disc(k.sunDir, 170, 11, '#fff1b8', '#ffe9a8');
  k.clouds(4, '#fff8ee', '#f6e2cc');
  k.ground('#efb27a', speckle('#efb27a', ['#e3a36b', '#f7c28e', '#d9955d']), 2.5);

  for (let i = 0; i < 12; i++) {
    const p = k.around(35, 110);
    k.add(mound(k, p.x, p.z, k.range(14, 28), k.range(3, 7), k.pick(['#e9a56a', '#eeb07a'])));
  }
  for (let i = 0; i < 12; i++) {
    const p = k.around(70, 165);
    const butte = k.random() < 0.3;
    const m = mesa(k, butte ? k.range(3.5, 6) : k.range(9, 22), butte ? k.range(20, 32) : k.range(13, 28));
    m.position.copy(p);
    k.add(m);
  }
  const ok = spacer(4);
  for (let i = 0, placed = 0; i < 300 && placed < 26; i++) {
    const p = k.around(9.5, 60);
    if (!clearOfRoom(p, 1.5) || !ok(p)) continue;
    const c = saguaro(k, k.range(2.2, 4.5));
    c.position.copy(p);
    k.add(c);
    placed++;
  }
  for (let i = 0; i < 12; i++) {
    const p = k.around(8.5, 35);
    if (!clearOfRoom(p, 1)) continue;
    for (let j = 0; j < 3; j++) {
      const pad = k.ball(0.32, '#5fae5a', p.x + j * 0.3 - 0.3, 0.35 + (j % 2) * 0.35, p.z, 10);
      pad.scale.set(1, 1.15, 0.35);
      k.add(pad);
    }
    k.add(k.ball(0.09, '#ff8fab', p.x, 1.05, p.z, 6));
  }
  for (let i = 0; i < 18; i++) {
    const p = k.around(9, 50);
    if (clearOfRoom(p, 1)) k.add(rock(k, k.range(0.4, 1.6), k.pick(['#c47a4e', '#b56a42']), p.x, p.z));
  }
  const weed = k.mesh(new THREE.IcosahedronGeometry(0.45, 1), '#b08850');
  k.animate(weed, (o, t) => {
    const z = ((t * 1.7) % 90) - 45;
    o.position.set(12 + Math.sin(t * 0.3) * 1.5, 0.45 + Math.abs(Math.sin(t * 3)) * 0.35, z);
    o.rotation.x = z / 0.45;
  });
}

// ------------------------------------------------------------------------------------------------ moon

function moon(k: Kit): void {
  k.sky('#020309', '#0d1230', '#0d1230', 0.4);
  k.stars(700);
  k.ground('#b7b9c2', speckle('#b7b9c2', ['#a6a9b3', '#c6c8d0', '#9a9ea8']), 2.5);

  const earthDir = new THREE.Vector3(0.75, 0.32, 0.5).normalize();
  k.disc(earthDir, 156, 14.5, '#6fb7ff');
  const earth = k.mesh(new THREE.SphereGeometry(12, 32, 20), k.basic('#ffffff', { map: earthTexture() }));
  earth.position.copy(earthDir).multiplyScalar(150);
  earth.rotation.z = 0.4;
  k.animate(earth, (o, t) => (o.rotation.y = t * 0.03));

  const ok = spacer(6);
  for (let i = 0, placed = 0; i < 300 && placed < 24; i++) {
    const p = k.around(10, 90);
    const r = k.range(1.2, p.length() > 30 ? 8 : 4);
    if (!clearOfRoom(p, r + 1) || !ok(p)) continue;
    k.add(k.mesh(new THREE.CircleGeometry(r, 24).rotateX(-Math.PI / 2), k.basic('#9b9ea8'), [p.x, 0.01, p.z]));
    const rim = k.mesh(new THREE.TorusGeometry(r, r * 0.16, 6, 28).rotateX(Math.PI / 2), '#aeb1bb', [p.x, 0, p.z]);
    rim.scale.y = 0.45;
    k.add(rim);
    placed++;
  }
  for (let i = 0; i < 26; i++) {
    const p = k.around(9, 70);
    if (clearOfRoom(p, 1)) k.add(rock(k, k.range(0.3, 1.4), k.pick(['#8e919b', '#a3a6b0']), p.x, p.z));
  }
  for (let i = 0; i < 13; i++) {
    const a = (i / 13) * Math.PI * 2 + k.range(-0.15, 0.15);
    const r = k.range(135, 170);
    k.add(mountain(k, Math.cos(a) * r, Math.sin(a) * r, k.range(25, 50), k.range(14, 34), k.pick(['#7c808c', '#878b97'])));
  }

  // a lander, a flag, a rocket on its pad and a rover doing laps
  const lander = new THREE.Group();
  lander.position.set(14, 0, -9);
  lander.rotation.y = 0.5;
  lander.add(k.box(2.2, 1.4, 2.2, '#f2c14e', 0, 1.1, 0));
  lander.add(k.box(1.5, 1.2, 1.5, '#d9dde4', 0, 2.5, 0));
  lander.add(k.mesh(new THREE.SphereGeometry(0.5, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#f1f3f5', [0.4, 3.7, 0.3]));
  lander.add(k.cyl(0.03, 0.03, 0.8, '#868e96', -0.5, 3.7, -0.4, 4));
  lander.add(k.box(0.5, 0.6, 0.04, '#495057', 0, 2.7, 0.77));
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const leg = k.cyl(0.06, 0.06, 1.6, '#adb5bd', x * 1.35, 0.1, z * 1.35, 6);
    leg.rotation.set(z * 0.35, 0, -x * 0.35);
    lander.add(leg);
    lander.add(k.cyl(0.3, 0.3, 0.08, '#adb5bd', x * 1.6, 0, z * 1.6, 10));
  }
  k.add(lander);

  const flag = new THREE.Group();
  flag.position.set(10, 0, 5.5);
  flag.add(k.cyl(0.035, 0.035, 2.6, '#dee2e6', 0, 0, 0, 6));
  const cloth = k.mesh(new THREE.PlaneGeometry(1.4, 0.8), k.basic('#ffffff', { map: labelTexture('FOCUS HQ', { w: 256, h: 146, bg: '#5bc0eb', fg: '#ffffff', font: 46 }), side: THREE.DoubleSide }), [0.72, 2.15, 0]);
  flag.add(cloth);
  flag.add(k.cyl(0.02, 0.02, 1.45, '#dee2e6', 0.72, 2.55, 0, 4)).rotation.z = Math.PI / 2;
  flag.rotation.y = -0.9;
  k.add(flag);

  const rocket = new THREE.Group();
  rocket.position.set(-26, 0, 16);
  rocket.add(k.box(6, 0.6, 6, '#6c717d'));
  rocket.add(k.cyl(1.2, 1.2, 9, '#f1f3f5', 0, 0.6, 0, 16));
  rocket.add(k.cyl(1.22, 1.22, 1, '#ff6b6b', 0, 6.5, 0, 16));
  rocket.add(k.cone(1.2, 3.2, '#ff6b6b', 0, 9.6, 0, 16));
  for (let i = 0; i < 3; i++) {
    const fin = k.box(0.15, 2.4, 1.4, '#ff6b6b', 0, 0.6, 0);
    fin.geometry.translate(0, 0, 1.4);
    fin.rotation.y = (i / 3) * Math.PI * 2;
    rocket.add(fin);
  }
  rocket.add(k.ball(0.45, '#74c0fc', 1.1, 7.6, 0, 12));
  k.add(rocket);

  const rover = new THREE.Group();
  rover.add(k.box(1.6, 0.5, 1.0, '#e9ecef', 0, 0.45, 0));
  rover.add(k.box(1.3, 0.05, 1.5, '#3b5bdb', 0, 1.0, 0));
  rover.add(k.cyl(0.02, 0.02, 0.6, '#868e96', -0.6, 0.95, 0.3, 4));
  for (const [x, z] of [[-0.6, -0.55], [0.6, -0.55], [-0.6, 0.55], [0.6, 0.55]]) {
    const wheel = k.cyl(0.25, 0.25, 0.18, '#343a40', 0, 0, 0, 12);
    wheel.geometry.rotateX(Math.PI / 2);
    wheel.position.set(x, 0.25, z);
    rover.add(wheel);
  }
  k.animate(rover, (o, t) => {
    const a = t * 0.08;
    o.position.set(Math.cos(a) * 15, 0, Math.sin(a) * 15);
    o.rotation.y = -a - Math.PI / 2;
  }, true);
}

// ------------------------------------------------------------------------------------------------ city

function building(k: Kit, x: number, z: number, w: number, d: number, top: number, mat: THREE.Material): THREE.Mesh {
  const BASE = -70;
  const h = top - BASE;
  const geo = new THREE.BoxGeometry(w, h, d);
  // windows are 3m wide and 3.5m tall, 8 to a texture tile; roofs take the plain facade from the tile's corner
  const uv = geo.attributes.uv;
  const faces = [[d, h], [d, h], [0, 0], [0, 0], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      const [fw, fh] = faces[f];
      if (fw === 0) uv.setXY(i, 0.005, 0.005);
      else uv.setXY(i, (uv.getX(i) * fw) / 24, (uv.getY(i) * fh) / 28);
    }
  }
  return k.mesh(geo, mat, [x, BASE + h / 2, z]);
}

function city(k: Kit): void {
  k.sky('#26154f', '#ff9472', '#3a2350', 0.45);
  k.stars(160, '#ffe9f5', 1.5);
  k.disc(new THREE.Vector3(1, 0.05, 0.3), 172, 13, '#ffd98a', '#ffb38a');
  const street = k.mesh(new THREE.CircleGeometry(190, 40).rotateX(-Math.PI / 2), k.basic('#2a2240'), [0, -70, 0]);
  k.add(street);

  // our roof: the room sits on it
  const ROOF = { x0: -16, x1: 24, z0: -16, z1: 16 };
  const roofW = ROOF.x1 - ROOF.x0;
  const roofD = ROOF.z1 - ROOF.z0;
  const cx = (ROOF.x0 + ROOF.x1) / 2;
  k.add(k.mesh(new THREE.PlaneGeometry(roofW, roofD).rotateX(-Math.PI / 2), k.basic('#8a8fa3', { map: k.texture(speckle('#8a8fa3', ['#7d8296', '#979cb0']), roofW / 3, roofD / 3), underlay: true }), [cx, -0.02, 0]));
  const facades = [facadeTexture('#2e2a4f', 7), facadeTexture('#283a5c', 19), facadeTexture('#3b2f4a', 31)].map((t) => k.texture(t, 1, 1));
  const facadeMats = facades.map((map) => k.basic('#ffffff', { map }));
  k.add(building(k, cx, 0, roofW, roofD, -0.4, facadeMats[0]));
  const parapet = '#6c7086';
  k.add(k.box(roofW + 0.4, 0.9, 0.4, parapet, cx, 0, ROOF.z0));
  k.add(k.box(roofW + 0.4, 0.9, 0.4, parapet, cx, 0, ROOF.z1));
  k.add(k.box(0.4, 0.9, roofD, parapet, ROOF.x0, 0, 0));
  k.add(k.box(0.4, 0.9, roofD, parapet, ROOF.x1, 0, 0));

  // rooftop clutter
  const pad = k.mesh(new THREE.CircleGeometry(4.2, 40).rotateX(-Math.PI / 2), k.basic('#ffffff', { map: labelTexture('H', { w: 256, h: 256, bg: '#4b5064', fg: '#ffd43b', ring: '#ffd43b', font: 150 }) }), [16, 0.01, -7]);
  pad.rotation.y = Math.PI / 2;
  k.add(pad);
  for (const [x, z] of [[10, 9], [13, 9], [-4, 10.5], [3, -10.5]]) {
    k.add(k.box(2, 1.2, 1.6, '#c9ccd6', x, 0, z));
    k.add(k.cyl(0.55, 0.55, 0.05, '#5c6070', x, 1.2, z, 16));
  }
  const tower = new THREE.Group();
  tower.position.set(-11.5, 0, -10.5);
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) tower.add(k.cyl(0.08, 0.08, 3, '#4a4e5a', x, 0, z, 6));
  tower.add(k.cyl(1.6, 1.6, 2.8, '#9c6b4a', 0, 3, 0, 16));
  tower.add(k.cone(1.75, 1.2, '#6d4c3b', 0, 5.8, 0, 16));
  k.add(tower);
  for (const [x, z] of [[-12, 6], [-12, 9.5], [19, 13]]) {
    k.add(k.box(1.6, 0.6, 1.6, '#a0693b', x, 0, z));
    k.add(k.ball(0.7, '#4caf6a', x, 1.1, z, 10));
  }
  k.add(k.cyl(0.08, 0.12, 9, '#9aa0b0', 20, 0, 12, 6));
  const beacon = k.mesh(new THREE.SphereGeometry(0.22, 10, 8), k.basic('#ff3b3b'), [20, 9.1, 12]);
  k.animate(beacon, (o, t) => (o.visible = Math.sin(t * 3) > 0.2));

  const sign = new THREE.Group();
  sign.position.set(9, 0, -13.5);
  sign.add(k.cyl(0.1, 0.1, 4.2, '#4a4e5a', -3, 0, 0, 6));
  sign.add(k.cyl(0.1, 0.1, 4.2, '#4a4e5a', 3, 0, 0, 6));
  sign.add(k.mesh(new THREE.PlaneGeometry(7, 2), k.basic('#ffffff', { map: labelTexture('FOCUS HQ', { w: 512, h: 146, bg: '#1a1030', fg: '#ff8ce6', glow: '#ff3bd4', font: 92 }) }), [0, 4.2, 0.12]));
  sign.add(k.box(7.2, 2.2, 0.2, '#2b2140', 0, 3.1, 0));
  sign.lookAt(0, 0, 0);
  k.add(sign);

  // the skyline, in three bands getting taller and further away
  const ok = spacer(0);
  const bands: [number, number, number, number, number][] = [
    [38, 75, -14, 22, 26],
    [75, 125, 0, 55, 34],
    [125, 168, -5, 40, 30],
  ];
  for (const [r0, r1, lo, hi, count] of bands) {
    for (let i = 0, placed = 0; i < count * 8 && placed < count; i++) {
      const p = k.around(r0, r1);
      const w = k.range(9, 20);
      const d = k.range(9, 20);
      if (!ok(p)) continue;
      const top = k.range(lo, hi);
      k.add(building(k, p.x, p.z, w, d, top, k.pick(facadeMats)));
      if (k.random() < 0.3) k.add(k.cone(0.4, k.range(5, 12), '#3a3354', p.x, top, p.z, 6));
      placed++;
    }
  }

  const blimp = new THREE.Group();
  const body = k.ball(1, '#dfe3ea', 0, 0, 0, 20);
  body.scale.set(9, 2.6, 2.6);
  blimp.add(body);
  blimp.add(k.box(2.4, 0.8, 1.1, '#5c6070', 0, -3, 0));
  for (const r of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const fin = k.box(2.2, 0.15, 2.2, '#ff6b6b', -8, 0, 0);
    fin.geometry.translate(0, 0, 1);
    fin.rotation.x = r;
    blimp.add(fin);
  }
  k.animate(blimp, (o, t) => {
    const a = t * 0.02 + 1;
    o.position.set(Math.cos(a) * 85, 42, Math.sin(a) * 85);
    o.rotation.y = -a - Math.PI / 2;
  }, true);
}

// ------------------------------------------------------------------------------------------------ library

function library(k: Kit): void {
  const H = { x0: -45, x1: 65, z0: -35, z1: 35, top: 28 };
  const L = H.x1 - H.x0;
  const W = H.z1 - H.z0;
  const cx = (H.x0 + H.x1) / 2;
  k.sky('#2b1d14', '#3b2a20');

  // floor, walls of books, ceiling with a skylight
  k.add(k.mesh(new THREE.PlaneGeometry(L, W).rotateX(-Math.PI / 2), k.basic('#ffffff', { map: k.texture(checkerTexture('#efe6d6', '#d8c9ae'), L / 4, W / 4), underlay: true }), [cx, -0.02, 0]));
  const runner = k.basic('#8c2f39');
  k.add(k.mesh(new THREE.PlaneGeometry(L - 6, 4.4).rotateX(-Math.PI / 2), k.basic('#d4a017'), [cx, 0.005, 0]));
  k.add(k.mesh(new THREE.PlaneGeometry(L - 6.4, 3.8).rotateX(-Math.PI / 2), runner, [cx, 0.01, 0]));
  const shelves = (len: number) => k.basic('#ffffff', { map: k.texture(bookshelfTexture(), len / 4, H.top / 4) });
  k.add(k.mesh(new THREE.PlaneGeometry(L, H.top), shelves(L), [cx, H.top / 2, H.z0]));
  k.add(k.mesh(new THREE.PlaneGeometry(L, H.top).rotateY(Math.PI), shelves(L), [cx, H.top / 2, H.z1]));
  k.add(k.mesh(new THREE.PlaneGeometry(W, H.top).rotateY(Math.PI / 2), shelves(W), [H.x0, H.top / 2, 0]));
  k.add(k.mesh(new THREE.PlaneGeometry(W, H.top).rotateY(-Math.PI / 2), k.basic('#cdb894'), [H.x1, H.top / 2, 0]));
  const win = k.mesh(new THREE.PlaneGeometry(20, 25).rotateY(-Math.PI / 2), k.basic('#ffffff', { map: archWindowTexture() }), [H.x1 - 0.05, 12.5, 0]);
  k.add(win);
  k.add(k.mesh(new THREE.PlaneGeometry(L, W).rotateX(Math.PI / 2), k.basic('#4a3022'), [cx, H.top, 0]));
  k.add(k.mesh(new THREE.PlaneGeometry(L - 10, 9).rotateX(Math.PI / 2), k.basic('#fff1cf'), [cx, H.top - 0.05, 0]));
  for (let x = H.x0 + 5; x < H.x1; x += 4) k.add(k.box(0.5, 0.5, 9.4, '#3a2418', x, H.top - 0.6, 0));
  for (let x = H.x0 + 5.5; x < H.x1; x += 11) k.add(k.box(1.2, 1.6, W, '#5a3a28', x, H.top - 1.6, 0));

  // pillars between the bookcases and two balcony levels
  const stone = '#d9c6a5';
  for (let x = H.x0 + 5.5; x < H.x1; x += 11) {
    for (const z of [H.z0 + 0.6, H.z1 - 0.6]) k.add(k.box(1.8, H.top, 1.2, stone, x, 0, z));
  }
  for (let z = H.z0 + 7; z < H.z1; z += 14) k.add(k.box(1.2, H.top, 1.8, stone, H.x0 + 0.6, 0, z));
  for (const y of [9.5, 19]) {
    for (const z of [H.z0 + 1.4, H.z1 - 1.4]) {
      const s = Math.sign(z);
      k.add(k.box(L, 0.45, 2.8, '#7a5136', cx, y - 0.45, z));
      k.add(k.box(L, 0.12, 0.12, '#5c3b26', cx, y + 1.0, z - s * 1.35));
      for (let x = H.x0 + 0.5; x < H.x1; x += 1.2) k.add(k.box(0.07, 1.0, 0.07, '#5c3b26', x, y, z - s * 1.35));
    }
    k.add(k.box(2.8, 0.45, W - 5.6, '#7a5136', H.x0 + 1.4, y - 0.45, 0));
    k.add(k.box(0.12, 0.12, W - 5.6, '#5c3b26', H.x0 + 2.75, y + 1.0, 0));
    for (let z = H.z0 + 3; z < H.z1 - 2.8; z += 1.2) k.add(k.box(0.07, 1.0, 0.07, '#5c3b26', H.x0 + 2.75, y, z));
  }

  // a colonnade down the hall
  for (let x = H.x0 + 10; x < H.x1 - 4; x += 12) {
    for (const z of [-17, 17]) {
      k.add(k.box(3, 0.8, 3, stone, x, 0, z));
      k.add(k.cyl(1.1, 1.2, H.top - 2.4, '#efe3cc', x, 0.8, z, 16));
      k.add(k.box(3, 0.8, 3, stone, x, H.top - 1.6, z));
    }
  }

  // reading tables with green lamps, ladders, a globe and chandeliers
  const ok = spacer(6);
  for (let i = 0, placed = 0; i < 200 && placed < 9; i++) {
    const p = k.around(10, 26);
    if (!clearOfRoom(p, 2) || Math.abs(p.z) > 14 || Math.abs(p.z) < 3.5 || !ok(p)) continue;
    const t = new THREE.Group();
    t.position.copy(p);
    t.rotation.y = k.pick([0, Math.PI / 2]);
    t.add(k.box(3, 0.08, 1.4, '#7a5136', 0, 0.78, 0));
    for (const [x, z] of [[-1.35, -0.55], [1.35, -0.55], [-1.35, 0.55], [1.35, 0.55]]) t.add(k.box(0.1, 0.78, 0.1, '#5c3b26', x, 0, z));
    for (const x of [-0.8, 0.8]) {
      t.add(k.cyl(0.1, 0.12, 0.05, '#d4a017', x, 0.86, 0, 10));
      t.add(k.cyl(0.02, 0.02, 0.35, '#d4a017', x, 0.86, 0, 4));
      t.add(k.mesh(new THREE.SphereGeometry(0.2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#2f7d4f', [x, 1.15, 0]));
      t.add(k.mesh(new THREE.SphereGeometry(0.07, 8, 6), k.basic('#fff3bf'), [x, 1.13, 0]));
    }
    for (let b = 0; b < 3; b++) t.add(k.box(0.35, 0.07, 0.25, k.pick(['#9b2335', '#2f5d8a', '#3f7d4a', '#c8963e']), 0.1, 0.86 + b * 0.07, 0.3));
    k.add(t);
    placed++;
  }
  for (const [x, z] of [[-20, H.z0 + 1.3], [22, H.z1 - 1.3], [40, H.z0 + 1.3]]) {
    const ladder = new THREE.Group();
    ladder.position.set(x, 0, z);
    for (const dx of [-0.35, 0.35]) ladder.add(k.box(0.08, 9.2, 0.08, '#8a5a3b', dx, 0, 0));
    for (let y = 0.4; y < 9; y += 0.45) ladder.add(k.box(0.7, 0.05, 0.06, '#8a5a3b', 0, y, 0));
    ladder.rotation.x = Math.sign(z) * 0.12;
    k.add(ladder);
  }
  const globe = new THREE.Group();
  globe.position.set(11, 0, 9.5);
  globe.add(k.cyl(0.25, 0.4, 0.9, '#7a5136', 0, 0, 0, 10));
  globe.add(k.ball(0.45, '#4dabf7', 0, 1.35, 0, 16));
  const ring = k.mesh(new THREE.TorusGeometry(0.55, 0.03, 6, 24), '#d4a017', [0, 1.35, 0]);
  ring.rotation.y = Math.PI / 2;
  globe.add(ring);
  k.add(globe);
  for (const [x, z] of [[-18, 0], [12, 0], [40, 0], [12, -26], [12, 26]]) {
    const c = new THREE.Group();
    c.position.set(x, 18, z);
    c.add(k.cyl(0.04, 0.04, H.top - 18, '#3a2418', 0, 1.2, 0, 4));
    c.add(k.mesh(new THREE.TorusGeometry(1.4, 0.08, 6, 24).rotateX(Math.PI / 2), '#d4a017', [0, 1.2, 0]));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      c.add(k.mesh(new THREE.SphereGeometry(0.14, 8, 6), k.basic('#fff3bf'), [Math.cos(a) * 1.4, 1.42, Math.sin(a) * 1.4]));
    }
    k.add(c);
  }

  // sunbeams from the great window, and a few books that have learned to fly
  for (const dz of [-6, 0, 6]) {
    const beam = new THREE.PlaneGeometry(4.5, 34).rotateY(Math.PI / 2).rotateZ(-0.85);
    k.add(k.mesh(beam, k.basic('#fff2c4', { opacity: 0.12, additive: true, side: THREE.DoubleSide }), [H.x1 - 12.7, 10.8, dz]));
  }
  for (let i = 0; i < 6; i++) {
    const book = new THREE.Group();
    const cover = k.pick(['#9b2335', '#2f5d8a', '#3f7d4a', '#6b3e75']);
    const left = k.box(0.5, 0.04, 0.36, cover, -0.26, 0, 0);
    left.rotation.z = 0.5;
    const right = k.box(0.5, 0.04, 0.36, cover, 0.26, 0, 0);
    right.rotation.z = -0.5;
    book.add(left, right, k.box(0.42, 0.06, 0.32, '#fffbf0', -0.22, 0.08, 0), k.box(0.42, 0.06, 0.32, '#fffbf0', 0.22, 0.08, 0));
    const r = 11 + i * 1.6;
    const h = 4.5 + (i % 3) * 1.8;
    const speed = 0.12 + i * 0.02;
    const phase = i * 1.3;
    k.animate(book, (o, t) => {
      const a = t * speed + phase;
      o.position.set(Math.cos(a) * r, h + Math.sin(t * 1.4 + phase) * 0.4, Math.sin(a) * r);
      o.rotation.y = -a;
      o.rotation.z = Math.sin(t * 6 + phase) * 0.15;
    }, true);
  }
}
