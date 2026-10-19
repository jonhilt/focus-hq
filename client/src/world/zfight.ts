// Finds z-fighting in a scene graph: faces from different meshes that lie in (almost) the same plane, face the same
// way and overlap, so the depth test flips between them as the camera turns. `pnpm run zfight` (tools/zfight.ts)
// imports this into the running office; it isn't part of the client bundle. The gap scan (gaps.ts) shares its
// triangle handling.
import * as THREE from 'three';
import { WALL_H } from './layout';
import { isMesh } from './isMesh';

/** Closest two faces may sit before they count as fighting; also the minimum gap a fix should leave. */
export const MIN_GAP = 0.002;
// overlaps smaller than about 1 mm square are edges meeting, not surfaces fighting
const MIN_AREA = 1e-6;
// normals within about half a degree count as parallel; the gap check over the overlap does the rest
const MIN_DOT = 0.99995;
const NORMAL_STEP = 0.05;
const PLANE_STEP = 0.01;

export interface FightingPair {
  a: string;
  b: string;
  /** Area-weighted centre of the overlap, in world space. */
  at: [number, number, number];
  /** Total overlapping area, m². */
  area: number;
}

/** Materials whose depth is already sorted out some other way. */
export function exempt(mat: THREE.Material): boolean {
  return mat.polygonOffset || !mat.depthTest || mat.userData.landscape === true;
}

/** A mesh's path from the root, unnamed nodes shown as `Type[index]`, then its shape and colour to find it in the code. */
export function meshPath(mesh: THREE.Mesh, root: THREE.Object3D): string {
  const parts: string[] = [];
  for (let o: THREE.Object3D | null = mesh; o && o !== root; o = o.parent) {
    parts.unshift(o.name || `${o.type}[${o.parent ? o.parent.children.indexOf(o) : 0}]`);
  }
  const params = Object.values((mesh.geometry as { parameters?: Record<string, unknown> }).parameters ?? {})
    .filter((v): v is number => typeof v === 'number')
    .map((v) => Math.round(v * 1000) / 1000);
  const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const colour = (mat as { color?: THREE.Color } | undefined)?.color?.getHexString();
  const shape = [mesh.geometry.type + (params.length ? ` ${params.join('×')}` : ''), colour && `#${colour}`].filter(Boolean);
  return `${parts.join(' > ')} (${shape.join(', ')})`;
}

/**
 * Single-sided faces the camera is always behind, so the GPU culls them: it stays between the floor and the ceiling,
 * so it never sees an underside at floor level or a top at ceiling height.
 */
function culled(n: THREE.Vector3, p: THREE.Vector3, side: THREE.Side): boolean {
  if (side !== THREE.FrontSide || Math.abs(n.y) < MIN_DOT) return false;
  return n.y < 0 ? p.y < MIN_GAP : p.y > WALL_H - MIN_GAP;
}

/** Two faces in one plane with the same untextured material draw the same pixels whichever wins. */
function lookAlike(a: THREE.Material, b: THREE.Material): boolean {
  return a === b && !(a as { map?: THREE.Texture | null }).map;
}

export interface Tri {
  mesh: number;
  mat: THREE.Material;
  /** Normal flipped so its largest component is positive, with `d` flipped to match. */
  n: THREE.Vector3;
  d: number;
  /** Whether the face really points along `n` (rather than against it). */
  along: boolean;
  doubleSided: boolean;
  v: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
  box: THREE.Box3;
}

export function visible(obj: THREE.Object3D): boolean {
  for (let o: THREE.Object3D | null = obj; o; o = o.parent) if (!o.visible) return false;
  return true;
}

function materialAt(mesh: THREE.Mesh, triStart: number): THREE.Material | null {
  if (!Array.isArray(mesh.material)) return mesh.material;
  const group = mesh.geometry.groups.find((g) => triStart >= g.start && triStart < g.start + g.count);
  return group ? (mesh.material[group.materialIndex ?? 0] ?? null) : null;
}

/** Whether `n` already has its largest component positive. */
function canonical(n: THREE.Vector3): boolean {
  const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
  const big = ax >= ay - 1e-6 && ax >= az - 1e-6 ? n.x : ay >= az - 1e-6 ? n.y : n.z;
  return big > 0;
}

export function trianglesOf(mesh: THREE.Mesh, index: number, out: Tri[]): void {
  const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!pos) return;
  const idx = mesh.geometry.index;
  const count = idx ? idx.count : pos.count;
  const range = mesh.geometry.drawRange;
  const start = Math.max(0, range.start);
  const end = Math.min(count, range.start + range.count);
  const vertex = (i: number) =>
    new THREE.Vector3().fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(mesh.matrixWorld);
  for (let i = start; i + 2 < end; i += 3) {
    const mat = materialAt(mesh, i);
    if (!mat || !mat.visible || exempt(mat)) continue;
    const v: Tri['v'] = [vertex(i), vertex(i + 1), vertex(i + 2)];
    const n = new THREE.Vector3().subVectors(v[1], v[0]).cross(new THREE.Vector3().subVectors(v[2], v[0]));
    const len = n.length();
    if (len < 1e-9) continue;
    n.divideScalar(len);
    if (culled(n, v[0], mat.side)) continue;
    const flipped = !canonical(n);
    if (flipped) n.negate();
    // a back-side material shows the face from behind
    const along = flipped === (mat.side === THREE.BackSide);
    out.push({
      mesh: index,
      mat,
      n,
      d: n.dot(v[0]),
      along,
      doubleSided: mat.side === THREE.DoubleSide,
      v,
      box: new THREE.Box3().setFromPoints(v).expandByScalar(MIN_GAP),
    });
  }
}

export const key = (nx: number, ny: number, nz: number, d: number) => `${nx},${ny},${nz},${d}`;
export const cells = (value: number, tolerance: number, step: number) => {
  const lo = Math.floor((value - tolerance) / step);
  const hi = Math.floor((value + tolerance) / step);
  return lo === hi ? [lo] : [lo, hi];
};

/** A point's coordinates in the plane spanned by `u` and `w`. */
export function project(p: THREE.Vector3, u: THREE.Vector3, w: THREE.Vector3): [number, number] {
  return [p.dot(u), p.dot(w)];
}

export function signedArea(poly: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

/** Sutherland–Hodgman: the part of `subject` inside the convex, counter-clockwise `clip`. */
export function clip(subject: [number, number][], clipPoly: [number, number][]): [number, number][] {
  let out = subject;
  for (let i = 0; i < clipPoly.length && out.length; i++) {
    const [ax, ay] = clipPoly[i];
    const [bx, by] = clipPoly[(i + 1) % clipPoly.length];
    const side = ([x, y]: [number, number]) => (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j];
      const q = input[(j + 1) % input.length];
      const sp = side(p), sq = side(q);
      if (sp >= 0) out.push(p);
      if (sp >= 0 !== sq >= 0) {
        const t = sp / (sp - sq);
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
  }
  return out;
}

export function basis(n: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const helper = Math.abs(n.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(n, helper).normalize();
  return [u, new THREE.Vector3().crossVectors(n, u)];
}

export function ccw(t: Tri, u: THREE.Vector3, w: THREE.Vector3): [number, number][] {
  const poly = t.v.map((p) => project(p, u, w));
  return signedArea(poly) < 0 ? poly.reverse() : poly;
}

/** Where `a` and `b` overlap within MIN_GAP of each other: the overlap's area and centre, or null. */
function overlap(a: Tri, b: Tri): { area: number; centre: THREE.Vector3 } | null {
  const [u, w] = basis(a.n);
  const poly = clip(ccw(a, u, w), ccw(b, u, w));
  if (poly.length < 3) return null;
  const area = Math.abs(signedArea(poly));
  if (area < MIN_AREA) return null;
  const centre = new THREE.Vector3();
  for (const [x, y] of poly) {
    const p = u.clone().multiplyScalar(x).addScaledVector(w, y).addScaledVector(a.n, a.d);
    if (Math.abs(b.n.dot(p) - b.d) >= MIN_GAP) return null;
    centre.add(p);
  }
  return { area, centre: centre.divideScalar(poly.length) };
}

/**
 * Whether `cover`, a face pointing the other way, lies flat against `p` on `face`'s plane: two solids pressed
 * together, so nothing on that spot can be seen from either side.
 */
function sealed(p: THREE.Vector3, face: Tri, cover: Tri): boolean {
  if (cover.along === face.along || cover.mat.transparent || Math.abs(cover.n.dot(p) - cover.d) >= MIN_GAP) return false;
  const [u, w] = basis(face.n);
  const [x, y] = project(p, u, w);
  const tri = ccw(cover, u, w);
  return tri.every(([ax, ay], i) => {
    const [bx, by] = tri[(i + 1) % 3];
    return (bx - ax) * (y - ay) - (by - ay) * (x - ax) >= -1e-9;
  });
}

/** Every pair of meshes under `root` with faces close enough to fight, largest overlap first. Faces of one mesh aren't compared. */
export function findZFighting(root: THREE.Object3D): FightingPair[] {
  root.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  const tris: Tri[] = [];
  root.traverse((obj) => {
    if (!isMesh(obj) || !visible(obj)) return;
    meshes.push(obj);
    trianglesOf(obj, meshes.length - 1, tris);
  });

  const buckets = new Map<string, number[]>();
  tris.forEach((t, i) => {
    const k = key(Math.floor(t.n.x / NORMAL_STEP), Math.floor(t.n.y / NORMAL_STEP), Math.floor(t.n.z / NORMAL_STEP), Math.floor(t.d / PLANE_STEP));
    let bucket = buckets.get(k);
    if (!bucket) buckets.set(k, (bucket = []));
    bucket.push(i);
  });

  const pairs = new Map<string, { a: number; b: number; area: number; sum: THREE.Vector3 }>();
  const normalTolerance = Math.sqrt(2 * (1 - MIN_DOT));
  const neighbours = (t: Tri) => {
    const out: number[] = [];
    for (const nx of cells(t.n.x, normalTolerance, NORMAL_STEP))
      for (const ny of cells(t.n.y, normalTolerance, NORMAL_STEP))
        for (const nz of cells(t.n.z, normalTolerance, NORMAL_STEP))
          for (const d of cells(t.d, MIN_GAP, PLANE_STEP)) out.push(...(buckets.get(key(nx, ny, nz, d)) ?? []));
    return out;
  };
  tris.forEach((a, i) => {
    const near = neighbours(a);
    for (const j of near) {
      if (j <= i) continue;
      const b = tris[j];
      if (b.mesh === a.mesh || !a.box.intersectsBox(b.box) || a.n.dot(b.n) < MIN_DOT || lookAlike(a.mat, b.mat)) continue;
      if (a.along !== b.along && !a.doubleSided && !b.doubleSided) continue;
      const hit = overlap(a, b);
      if (!hit) continue;
      if (near.some((k) => tris[k].mesh !== a.mesh && tris[k].mesh !== b.mesh && sealed(hit.centre, a, tris[k]))) continue;
      const [lo, hi] = a.mesh < b.mesh ? [a.mesh, b.mesh] : [b.mesh, a.mesh];
      const k = `${lo}|${hi}`;
      let pair = pairs.get(k);
      if (!pair) pairs.set(k, (pair = { a: lo, b: hi, area: 0, sum: new THREE.Vector3() }));
      pair.area += hit.area;
      pair.sum.addScaledVector(hit.centre, hit.area);
    }
  });

  return [...pairs.values()]
    .sort((x, y) => y.area - x.area)
    .map((p) => {
      const at = p.sum.divideScalar(p.area);
      return {
        a: meshPath(meshes[p.a], root),
        b: meshPath(meshes[p.b], root),
        at: [at.x, at.y, at.z].map((c) => Math.round(c * 1000) / 1000) as [number, number, number],
        area: p.area,
      };
    });
}
