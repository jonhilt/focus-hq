// Finds gaps in a scene graph: faces from different meshes that face each other a little way apart, like the back of a
// panel hovering a centimetre off the wall it should be fixed to. Faces pressed together (closer than MIN_GAP) are
// attached; faces further apart than MAX_GAP are separate things. `pnpm run gaps` (tools/gaps.ts) imports this into
// the running office; it isn't part of the client bundle.
import * as THREE from 'three';
import { SKIN } from './scenery';
import { basis, ccw, cells, clip, key, meshPath, MIN_GAP, signedArea, trianglesOf, visible, type Tri } from './zfight';
import { isMesh } from './isMesh';

/** Furthest apart two facing faces may be and still count as one thing hovering off another. */
export const MAX_GAP = 0.05;
// facing less than about 50 cm² is something standing beside something else (an arm post by a cushion), not hovering
const MIN_AREA = 0.005;
// normals within about 2° count as parallel: a little looser than z-fighting, as a hovering face needn't be exact
const MIN_DOT = 0.9994;
const NORMAL_STEP = 0.05;

export interface Gap {
  a: string;
  b: string;
  /** Area-weighted centre of the overlap, in world space, halfway between the two faces. */
  at: [number, number, number];
  /** Total facing area, m². */
  area: number;
  /** Narrowest gap between the faces, m. */
  gap: number;
}

/** Whether the face shows on the side its normal `n` points to (or both sides). */
const facesAlong = (t: Tri) => (t.along || t.doubleSided) && !t.mat.transparent;
const facesAgainst = (t: Tri) => (!t.along || t.doubleSided) && !t.mat.transparent;

/** A mesh's triangles, in world space. */
function worldTriangles(mesh: THREE.Mesh): THREE.Triangle[] {
  const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!pos) return [];
  const idx = mesh.geometry.index;
  const count = idx ? idx.count : pos.count;
  const vertex = (i: number) => new THREE.Vector3().fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(mesh.matrixWorld);
  const out: THREE.Triangle[] = [];
  for (let i = 0; i + 2 < count; i += 3) out.push(new THREE.Triangle(vertex(i), vertex(i + 1), vertex(i + 2)));
  return out;
}

/** Whether `p` is inside the closed mesh `mesh`: a ray from it crosses the mesh's surface an odd number of times. */
function inside(p: THREE.Vector3, mesh: THREE.Mesh, box: THREE.Box3): boolean {
  if (!box.containsPoint(p)) return false;
  // an odd direction, so the ray doesn't run along an edge or a face of anything built square
  const ray = new THREE.Ray(p, new THREE.Vector3(0.5773, 0.5771, 0.5775).normalize());
  const hit = new THREE.Vector3();
  return worldTriangles(mesh).filter((t) => ray.intersectTriangle(t.a, t.b, t.c, false, hit)).length % 2 === 1;
}

/**
 * Every pair of meshes under `root` with faces looking at each other from MIN_GAP to MAX_GAP apart, the largest facing
 * area first. Faces of one mesh aren't compared.
 */
export function findGaps(root: THREE.Object3D): Gap[] {
  root.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  const tris: Tri[] = [];
  // a holodeck's skin shows its landscape over the walls behind it, so a gap behind the skin can't be seen
  const skins: THREE.Triangle[] = [];
  root.traverse((obj) => {
    if (!isMesh(obj)) return;
    const mesh = obj;
    // even while the landscape is hidden, for you're elsewhere and can't see the room
    if (mesh.geometry.name === SKIN) return void skins.push(...worldTriangles(mesh));
    if (!visible(mesh)) return;
    meshes.push(mesh);
    trianglesOf(mesh, meshes.length - 1, tris);
  });
  // the gap from `from` to `to` is hidden if either end is behind a skin, out of the room
  const behindSkin = (from: THREE.Vector3, to: THREE.Vector3) => {
    const along = to.clone().sub(from).normalize();
    const hit = new THREE.Vector3();
    const normal = new THREE.Vector3();
    return skins.some((t) => {
      // the skin across the line through the gap, near it
      const ray = new THREE.Ray(from.clone().addScaledVector(along, -MAX_GAP), along);
      if (!ray.intersectTriangle(t.a, t.b, t.c, false, hit) || hit.distanceTo(ray.origin) > 3 * MAX_GAP) return false;
      t.getNormal(normal);
      return normal.dot(from.clone().sub(hit)) < 0 || normal.dot(to.clone().sub(hit)) < 0;
    });
  };

  // planes bucketed MAX_GAP apart, so a face's partners are in its own bucket or the next one up
  const buckets = new Map<string, number[]>();
  tris.forEach((t, i) => {
    if (!facesAgainst(t)) return;
    const k = key(Math.floor(t.n.x / NORMAL_STEP), Math.floor(t.n.y / NORMAL_STEP), Math.floor(t.n.z / NORMAL_STEP), Math.floor(t.d / MAX_GAP));
    let bucket = buckets.get(k);
    if (!bucket) buckets.set(k, (bucket = []));
    bucket.push(i);
  });

  const boxes = meshes.map((m) => new THREE.Box3().setFromObject(m));
  const enclosing = (p: THREE.Vector3) => meshes.flatMap((m, i) => (inside(p, m, boxes[i]) ? [i] : []));
  const normalTolerance = Math.sqrt(2 * (1 - MIN_DOT));
  const pairs = new Map<string, { a: number; b: number; area: number; gap: number; sum: THREE.Vector3 }>();
  tris.forEach((a) => {
    if (!facesAlong(a)) return;
    // partners in front of `a`, facing back at it
    const lo = Math.floor((a.d + MIN_GAP) / MAX_GAP);
    const hi = Math.floor((a.d + MAX_GAP) / MAX_GAP);
    for (const nx of cells(a.n.x, normalTolerance, NORMAL_STEP))
      for (const ny of cells(a.n.y, normalTolerance, NORMAL_STEP))
        for (const nz of cells(a.n.z, normalTolerance, NORMAL_STEP))
          for (let d = lo; d <= hi; d++)
            for (const j of buckets.get(key(nx, ny, nz, d)) ?? []) {
              const b = tris[j];
              if (b.mesh === a.mesh || a.n.dot(b.n) < MIN_DOT) continue;
              const hit = facing(a, b);
              // a gap inside something else (the top of a chair's column tucked into its seat) can't be seen
              if (!hit || enclosing(hit.centre).some((m) => m !== a.mesh && m !== b.mesh)) continue;
              const from = hit.centre.clone().addScaledVector(a.n, -hit.gap / 2);
              if (behindSkin(from, from.clone().addScaledVector(a.n, hit.gap))) continue;
              const [m, n] = a.mesh < b.mesh ? [a.mesh, b.mesh] : [b.mesh, a.mesh];
              const k = `${m}|${n}`;
              let pair = pairs.get(k);
              if (!pair) pairs.set(k, (pair = { a: m, b: n, area: 0, gap: Infinity, sum: new THREE.Vector3() }));
              pair.area += hit.area;
              pair.gap = Math.min(pair.gap, hit.gap);
              pair.sum.addScaledVector(hit.centre, hit.area);
            }
  });

  return [...pairs.values()]
    .filter((p) => p.area >= MIN_AREA)
    .sort((x, y) => y.area - x.area)
    .map((p) => {
      const at = p.sum.divideScalar(p.area);
      return {
        a: meshPath(meshes[p.a], root),
        b: meshPath(meshes[p.b], root),
        at: [at.x, at.y, at.z].map((c) => Math.round(c * 1000) / 1000) as [number, number, number],
        area: p.area,
        gap: Math.round(p.gap * 10000) / 10000,
      };
    });
}

/** Where `b`, in front of `a`, overlaps it seen along `a`'s normal: the overlap's area, centre and narrowest gap. */
function facing(a: Tri, b: Tri): { area: number; centre: THREE.Vector3; gap: number } | null {
  const [u, w] = basis(a.n);
  const poly = clip(ccw(a, u, w), ccw(b, u, w));
  if (poly.length < 3) return null;
  const area = Math.abs(signedArea(poly));
  if (area < 1e-6) return null;
  const centre = new THREE.Vector3();
  let gap = Infinity;
  for (const [x, y] of poly) {
    const p = u.clone().multiplyScalar(x).addScaledVector(w, y).addScaledVector(a.n, a.d);
    // how far along the normal from `a`'s plane to `b`'s, at this corner of the overlap
    const ahead = (b.d - b.n.dot(p)) / b.n.dot(a.n);
    if (ahead < MIN_GAP || ahead > MAX_GAP) return null;
    gap = Math.min(gap, ahead);
    centre.add(p.addScaledVector(a.n, ahead / 2));
  }
  return { area, centre: centre.divideScalar(poly.length), gap };
}
