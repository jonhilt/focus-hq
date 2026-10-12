import * as THREE from 'three';
import { OVERLAY_LAYER } from './frame';

// Gets the whole ship ready to draw before the captain walks into any of it. Only the part of the ship the camera's in
// is drawn (regions.ts), so without this the first step into a holodeck or a briefing room compiles its shaders and
// sends its baked lighting to the GPU all in that frame: a hitch on a strong GPU, and a stall of a second or so on a
// laptop's. Shaders compile in the background where the browser can (KHR_parallel_shader_compile), and textures go a
// few at a time, a frame apart. Canvases (screens, signs) are left to be sent as they're first seen: they're drawn
// again as they come into view (screenRedraw.ts), and every station's would come to hundreds of MB.

/** How long (ms) a frame spends sending textures before leaving the rest for the next. */
const BUDGET = 6;

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Every texture a material in `root` uses, ready to send: its own maps and a shader's uniforms. */
export function texturesIn(root: THREE.Object3D): Set<THREE.Texture> {
  const found = new Set<THREE.Texture>();
  const add = (value: unknown) => {
    if (value instanceof THREE.Texture && !(value as THREE.Texture & { isRenderTargetTexture?: boolean }).isRenderTargetTexture && !(value instanceof THREE.DepthTexture)) found.add(value);
  };
  root.traverse((o) => {
    const material = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!material) return;
    for (const m of Array.isArray(material) ? material : [material]) {
      for (const value of Object.values(m)) add(value);
      const uniforms = (m as THREE.ShaderMaterial).uniforms as Record<string, THREE.IUniform> | undefined;
      if (uniforms) for (const u of Object.values(uniforms)) add(u.value);
    }
  });
  return found;
}

/** Whether a texture is an image that has its pixels: one still loading is sent once it's there, as it would have been. */
function ready(texture: THREE.Texture): boolean {
  const image = texture.image as { complete?: boolean } | null | undefined;
  return texture.version > 0 && !!image && image.complete !== false && !(image instanceof HTMLCanvasElement);
}

/**
 * Compiles every material in `scene`, drawn or not, as a `Frame` draws them (into a target, so in linear colours), then
 * sends the images they use to the GPU. Anything already done is skipped, so it's cheap to run again when the ship
 * changes (a new holodeck).
 */
export async function warmUp(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): Promise<void> {
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const was = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  // the overlay (holograms, speech bubbles) is drawn with the camera on its own layer, which no light is on
  const overlay = camera.clone();
  overlay.layers.set(OVERLAY_LAYER);
  const over: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (o.layers.mask === overlay.layers.mask) over.push(o);
  });
  const compiled = Promise.all([renderer.compileAsync(scene, camera), ...over.map((o) => renderer.compileAsync(o, overlay, scene))]);
  renderer.setRenderTarget(was);
  await compiled;
  target.dispose();
  let start = performance.now();
  for (const texture of texturesIn(scene)) {
    if (!ready(texture)) continue;
    if (performance.now() - start > BUDGET) {
      await frame();
      start = performance.now();
    }
    renderer.initTexture(texture);
  }
}

/**
 * How many MB of pictures a frame sends ahead of a doorway, past the first (which always goes): on a laptop's integrated
 * GPU each MB of canvas held the frame up about 7 ms.
 */
const AHEAD_MB = 2;
/** How long (ms) the textures found in what's ahead are trusted before it's looked through again (a crew member arrived). */
const RELOOK = 1000;

/**
 * Sends what's about to come into view through a doorway (World.ahead) to the GPU a few MB a frame as you near it,
 * canvases and all, so it isn't all sent in the frame the doors open: entering a briefing room for the first time held
 * a laptop's frame up for 290 ms while 22 screens and signs went at once.
 */
export class TextureFeed {
  private found = new Map<THREE.Object3D, { textures: THREE.Texture[]; at: number }>();

  constructor(private readonly renderer: THREE.WebGLRenderer) {}

  update(ahead: THREE.Object3D[], now: number): void {
    const found = new Map<THREE.Object3D, { textures: THREE.Texture[]; at: number }>();
    let bytes = 0;
    for (const root of ahead) {
      let these = this.found.get(root);
      if (!these || now - these.at > RELOOK) these = { textures: [...texturesIn(root)], at: now };
      found.set(root, these);
      for (const texture of these.textures) {
        if (bytes > AHEAD_MB * 1e6 || !this.unsent(texture)) continue;
        this.renderer.initTexture(texture);
        const { width = 0, height = 0 } = texture.image as { width?: number; height?: number };
        bytes += width * height * 4;
      }
    }
    this.found = found;
  }

  /** Whether a texture has pixels the GPU hasn't been sent: never sent, or changed since. */
  private unsent(texture: THREE.Texture): boolean {
    const image = texture.image as { complete?: boolean } | null | undefined;
    if (texture.version === 0 || !image || image.complete === false) return false;
    return (this.renderer.properties.get(texture) as { __version?: number }).__version !== texture.version;
  }
}
