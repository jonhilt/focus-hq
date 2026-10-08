import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * How big a patch of floor (metres, in the root's frame) one merged mesh covers. Merging a whole deck's worth of a
 * material into one mesh would leave nothing to cull, and every pick would test all its triangles; a few metres
 * across, a merged mesh is still mostly behind you or out of reach when it isn't on the screen.
 */
export const MERGE_CELL = 6;

let merging = true;

/** Whether mergeStatic merges at all (`?merge=0` says not to): the gap and z-fighting scans name meshes as built. */
export function setMerging(on: boolean): void {
  merging = on;
}

const BLACK = new THREE.Color(0, 0, 0);

/**
 * What a toon material is but for its colour, if its colour is all that sets it apart from others like it: meshes in
 * such materials merge into one, each one's colour moved into its vertices, and share a twin material that takes its
 * colour from them. A desk's or a crew member's parts are a dozen colours of the same toon material. Null otherwise.
 */
function tintOf(mat: THREE.Material): string | null {
  if (!(mat instanceof THREE.MeshToonMaterial)) return null;
  if (mat.map || mat.alphaMap || mat.emissiveMap || mat.lightMap || mat.normalMap || mat.bumpMap || mat.displacementMap || mat.vertexColors) return null;
  if (!mat.emissive.equals(BLACK) || mat.transparent || mat.opacity !== 1 || mat.alphaTest || mat.stencilWrite || mat.polygonOffset) return null;
  if (mat.wireframe || !mat.depthWrite || !mat.depthTest || !mat.visible) return null;
  return ['tint', mat.side, mat.gradientMap?.uuid, mat.aoMap?.uuid, mat.aoMapIntensity, mat.aoMap?.channel, mat.customProgramCacheKey()].join('|');
}

/** The twin material for each tint (tintOf): the same, white, coloured by its vertices. */
const twins = new Map<string, THREE.MeshToonMaterial>();

function twinOf(mat: THREE.MeshToonMaterial, tint: string): THREE.MeshToonMaterial {
  let twin = twins.get(tint);
  if (twin) return twin;
  twin = mat.clone();
  twin.color.set(0xffffff);
  twin.vertexColors = true;
  // (a clone doesn't keep these: an occluded toon's shader changes, materials.ts)
  twin.onBeforeCompile = (shader, renderer) => mat.onBeforeCompile(shader, renderer);
  twin.customProgramCacheKey = () => mat.customProgramCacheKey();
  twins.set(tint, twin);
  return twin;
}

/** The attributes a tinted mesh is drawn with: where, which way it faces, and the UVs its occlusion map reads. */
function tintAttributes(mat: THREE.MeshToonMaterial): string[] {
  const channel = mat.aoMap ? mat.aoMap.channel : -1;
  return ['position', 'normal', ...(channel < 0 ? [] : [channel === 0 ? 'uv' : `uv${channel}`])];
}

/** What makes meshes mergeable into one: the same material (or tint), attributes and patch of floor. */
function mergeKey(mesh: THREE.Mesh, centre: THREE.Vector3): string {
  const g = mesh.geometry;
  const mat = mesh.material as THREE.Material;
  const cell = `${Math.floor(centre.x / MERGE_CELL)},${Math.floor(centre.z / MERGE_CELL)}`;
  const tint = tintOf(mat);
  if (tint) {
    const wanted = tintAttributes(mat as THREE.MeshToonMaterial);
    if (wanted.every((n) => g.attributes[n])) return `${tint}|${wanted.join(',')}|${mesh.renderOrder}|${cell}`;
  }
  const attributes = Object.keys(g.attributes).sort().join(',');
  return `${mat.uuid}|${attributes}|${g.index ? 'indexed' : 'flat'}|${mesh.renderOrder}|${cell}`;
}

/** A placed geometry with only `attributes`, an index (all of them have one, to merge) and `color` in its vertices. */
function tinted(g: THREE.BufferGeometry, attributes: string[], color: THREE.Color): THREE.BufferGeometry {
  for (const name of Object.keys(g.attributes)) if (!attributes.includes(name)) g.deleteAttribute(name);
  const n = g.attributes.position.count;
  if (!g.index) g.setIndex(Array.from({ length: n }, (_, i) => i));
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) color.toArray(colors, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.clearGroups();
  return g;
}

/** Puts a geometry into `matrix`'s frame, turning its triangles round if the matrix mirrors them inside out. */
function placed(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4): THREE.BufferGeometry {
  const g = geometry.clone().applyMatrix4(matrix);
  if (matrix.determinant() >= 0) return g;
  // three draws a mirrored mesh's triangles the other way round; merged, they're drawn as they're listed
  if (g.index) {
    const index = g.index;
    for (let i = 0; i < index.count; i += 3) {
      const b = index.getX(i + 1);
      index.setX(i + 1, index.getX(i + 2));
      index.setX(i + 2, b);
    }
    return g;
  }
  for (const attribute of Object.values(g.attributes) as THREE.BufferAttribute[]) {
    const n = attribute.itemSize;
    const a = attribute.array;
    for (let i = 0; i < attribute.count; i += 3) {
      for (let k = 0; k < n; k++) {
        const t = a[(i + 1) * n + k];
        a[(i + 1) * n + k] = a[(i + 2) * n + k];
        a[(i + 2) * n + k] = t;
      }
    }
  }
  return g;
}

/** Whether something's used (pressed E on, or rows of a board picked): it and everything in it stay as they are. */
const used = (o: THREE.Object3D) => !!o.userData.interaction || !!o.userData.interactionAt;

/**
 * Merges the static meshes under `root` that share a material (and attributes, and a patch of floor) into one mesh
 * each, added to `root` in its own frame, and takes the originals out: a deck built in Blender arrives as hundreds of
 * meshes, each its own draw call, in a few dozen materials. Leaves alone whatever's in `keep` (and everything in it),
 * whatever's used, and meshes that can't merge (several materials, skinned, instanced, hidden, alone in their group).
 * Returns how many meshes went in and how many came out.
 */
export function mergeStatic(root: THREE.Object3D, keep: Iterable<THREE.Object3D> = []): { from: number; to: number } {
  if (!merging) return { from: 0, to: 0 };
  const kept = new Set(keep);
  root.updateMatrixWorld(true);
  const toRoot = root.matrixWorld.clone().invert();
  const groups = new Map<string, THREE.Mesh[]>();
  const box = new THREE.Box3();
  const centre = new THREE.Vector3();

  const visit = (o: THREE.Object3D) => {
    if (kept.has(o) || used(o) || !o.visible) return;
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && !(mesh as THREE.SkinnedMesh).isSkinnedMesh && !(mesh as THREE.InstancedMesh).isInstancedMesh && !Array.isArray(mesh.material)) {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      box.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld).applyMatrix4(toRoot).getCenter(centre);
      const key = mergeKey(mesh, centre);
      const group = groups.get(key);
      if (group) group.push(mesh);
      else groups.set(key, [mesh]);
    }
    for (const child of o.children) visit(child);
  };
  for (const child of root.children) visit(child);

  let from = 0;
  let to = 0;
  const m = new THREE.Matrix4();
  for (const meshes of groups.values()) {
    if (meshes.length < 2) continue;
    const first = meshes[0];
    const tint = tintOf(first.material as THREE.Material);
    const toon = first.material as THREE.MeshToonMaterial;
    const attributes = tint && tintAttributes(toon);
    const tintable = !!attributes && attributes.every((n) => first.geometry.attributes[n]);
    const geometries = meshes.map((mesh) => {
      const g = placed(mesh.geometry, m.multiplyMatrices(toRoot, mesh.matrixWorld));
      return tintable ? tinted(g, attributes, (mesh.material as THREE.MeshToonMaterial).color) : g;
    });
    const merged = mergeGeometries(geometries);
    for (const g of geometries) g.dispose();
    if (!merged) continue;
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, tintable ? twinOf(toon, tint) : first.material);
    mesh.name = `merged ${meshes.length}: ${first.name}`;
    mesh.renderOrder = first.renderOrder;
    root.add(mesh);
    for (const original of meshes) original.removeFromParent();
    from += meshes.length;
    to += 1;
  }
  return { from, to };
}
