import * as THREE from 'three';

/** Three flat shading bands: the cartoon look. */
const gradientMap = (() => {
  const data = new Uint8Array([90, 170, 255]);
  const tex = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
})();

const toonCache = new Map<string, THREE.MeshToonMaterial>();

export function toon(color: THREE.ColorRepresentation, opts: { map?: THREE.Texture; emissive?: THREE.ColorRepresentation } = {}): THREE.MeshToonMaterial {
  const key = opts.map || opts.emissive ? '' : String(color);
  if (key) {
    const cached = toonCache.get(key);
    if (cached) return cached;
  }
  const mat = new THREE.MeshToonMaterial({ color, gradientMap, map: opts.map ?? null });
  if (opts.emissive) mat.emissive = new THREE.Color(opts.emissive);
  if (key) toonCache.set(key, mat);
  return mat;
}

/** An uncached toon material, for callers that change its render state (e.g. stencil masking). */
export function toonMaterial(params: THREE.MeshToonMaterialParameters = {}): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ gradientMap, ...params });
}

/** Unlit material for screens and printed surfaces; excluded from the outline pass. */
export function flat(map: THREE.Texture, opts: { transparent?: boolean } = {}): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({ map, transparent: opts.transparent ?? false, toneMapped: false });
  noOutline(mat);
  return mat;
}

export function noOutline(mat: THREE.Material): THREE.Material {
  mat.userData.outlineParameters = { visible: false };
  return mat;
}

const boxCache = new Map<string, THREE.BoxGeometry>();
export function boxGeo(w: number, h: number, d: number): THREE.BoxGeometry {
  const key = `${w.toFixed(3)}:${h.toFixed(3)}:${d.toFixed(3)}`;
  let geo = boxCache.get(key);
  if (!geo) boxCache.set(key, (geo = new THREE.BoxGeometry(w, h, d)));
  return geo;
}

/** A box mesh with its bottom at y. */
export function box(w: number, h: number, d: number, color: THREE.ColorRepresentation | THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(boxGeo(w, h, d), color instanceof THREE.Material ? color : toon(color));
  mesh.position.set(x, y + h / 2, z);
  return mesh;
}

export function lighten(hex: string, amount: number): string {
  const c = new THREE.Color(hex);
  c.lerp(new THREE.Color('#ffffff'), amount);
  return `#${c.getHexString()}`;
}

export function darken(hex: string, amount: number): string {
  const c = new THREE.Color(hex);
  c.lerp(new THREE.Color('#000000'), amount);
  return `#${c.getHexString()}`;
}
