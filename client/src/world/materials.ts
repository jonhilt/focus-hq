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

/**
 * A toon material shaded by ambient occlusion baked in Blender (blender/bake.py), from `aoMap` on the mesh's second
 * UVs: over all its light, as a shadow is, not only the ambient light a standard material's occlusion dims.
 */
export function occludedToon(color: THREE.ColorRepresentation, aoMap: THREE.Texture, map: THREE.Texture | null = null): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial({ color, gradientMap, map, aoMap });
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <aomap_fragment>',
      '#include <aomap_fragment>\n#ifdef USE_AOMAP\n\treflectedLight.directDiffuse *= ambientOcclusion;\n#endif',
    );
  };
  mat.customProgramCacheKey = () => 'occluded';
  return mat;
}

/** An uncached toon material, for callers that change its render state (e.g. stencil masking). */
export function toonMaterial(params: THREE.MeshToonMaterialParameters = {}): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ gradientMap, ...params });
}

/** Unlit material for screens and printed surfaces. */
export function flat(map: THREE.Texture, opts: { transparent?: boolean } = {}): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ map, transparent: opts.transparent ?? false, toneMapped: false });
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
