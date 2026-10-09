import * as THREE from 'three';
import { canvasTexture, makeCanvas } from './canvas';

// Screens drawn as holograms, after the displays over the holodeck pods in Lower Decks: no frame or stand, just light
// hanging in the air. The drawing keeps its own colours on navy glass, a little see-through where it's dark, inside a
// bright rounded outline with a soft glow round it, cyan or whatever colour says how its subject stands. Aim at one you
// can use and it turns solid, so it's easy to read while you use it. It doesn't write depth, so the outlines
// (outline.ts) don't ring it; put its mesh on OVERLAY_LAYER (frame.ts) so it's drawn over them.

/** The glow round a hologram unless it's given a colour of its own. */
export const HOLO_CYAN = '#8aedff';

/** A hologram's material and how solid it is: 0 see-through, 1 solid (eased towards `aimed` by `update`). */
export class Hologram {
  readonly material: THREE.MeshBasicMaterial;
  private readonly solid = { value: 0 };
  /** The colour of its outline and glow. */
  readonly tint = new THREE.Color(HOLO_CYAN);
  aimed = false;

  /** `aspect` is the screen's width over its height, so its outline keeps the same thickness all round. */
  constructor(map: THREE.Texture, aspect: number) {
    this.material = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false });
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.holoSolid = this.solid;
      shader.uniforms.holoAspect = { value: aspect };
      shader.uniforms.holoTint = { value: this.tint };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vHoloUv;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvHoloUv = uv;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAGMENT_HEAD}`)
        .replace('#include <map_fragment>', MAP)
        .replace('#include <opaque_fragment>', FRAGMENT);
    };
    this.material.customProgramCacheKey = () => 'hologram';
  }

  /** Eases towards solid while it's aimed at, and back to see-through after. */
  update(dt: number): void {
    const to = this.aimed ? 1 : 0;
    this.solid.value += (to - this.solid.value) * Math.min(1, dt * 8);
  }

  dispose(): void {
    this.material.dispose();
  }
}

const FRAGMENT_HEAD = /* glsl */ `
varying vec2 vHoloUv;
uniform float holoSolid;
uniform float holoAspect;
uniform vec3 holoTint;
const vec3 HOLO_NAVY = vec3(0.004, 0.025, 0.06);
// the drawing is inset to leave room round it for the outline and its glow: in screen heights
const float HOLO_PAD = 0.045;
// where we are on the screen, from its middle, in screen heights
vec2 holoP() { return (vHoloUv - 0.5) * vec2(holoAspect, 1.0); }
vec2 holoHalf() { return vec2(holoAspect, 1.0) * 0.5 - HOLO_PAD; }
// how far outside the drawing's rounded rectangle we are (negative inside)
float holoEdge() {
  float r = 0.035;
  vec2 q = abs(holoP()) - holoHalf() + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
`;

// the drawing, inset within the outline
const MAP = /* glsl */ `
#ifdef USE_MAP
  vec2 holoUv = holoP() / holoHalf() * 0.5 + 0.5;
  vec4 sampledDiffuseColor = texture2D(map, clamp(holoUv, 0.0, 1.0));
  diffuseColor *= sampledDiffuseColor;
#endif
`;

const FRAGMENT = /* glsl */ `{
  // how lit the drawing is here: its text and panels stay solid, its black background turns to navy glass
  float lit = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));
  vec3 c = mix(HOLO_NAVY, outgoingLight, smoothstep(0.0, 0.08, lit));
  float a = mix(0.9, 1.0, smoothstep(0.02, 0.3, lit));
  // aimed at, it's solid
  a = mix(a, 1.0, holoSolid);
  float sd = holoEdge();
  float inside = 1.0 - smoothstep(-0.002, 0.002, sd);
  // a bright line round it, and a soft glow outside that
  float line = 1.0 - smoothstep(0.0, 0.006, abs(sd + 0.004));
  float glow = exp(-max(sd, 0.0) / 0.02) * (1.0 - inside);
  c = mix(c, mix(holoTint, vec3(1.0), 0.6), line);
  c = mix(c, holoTint, glow);
  a = max(a * inside, max(line, glow * 0.7));
  gl_FragColor = vec4(c, clamp(a * opacity, 0.0, 1.0));
}`;

/** Bobs `obj` gently round `baseY`, out of step with its neighbours by `phase`. */
export function hover(obj: THREE.Object3D, baseY: number, t: number, phase = 0): void {
  obj.position.y = baseY + Math.sin(t * 0.9 + phase) * 0.025;
}

/** A soft round fall-off, white in the middle to nothing at the edges, made the first time it's needed. */
let falloff: THREE.Texture | null = null;
function fadeTexture(): THREE.Texture {
  if (falloff) return falloff;
  const { canvas, ctx } = makeCanvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255, 255, 255, 1)');
  g.addColorStop(0.5, 'rgba(255, 255, 255, 0.45)');
  g.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return (falloff = canvasTexture(canvas));
}

/** How high a floor glow lies: over the floor's carpets and the contact shadows (contactShadow.ts: 0.015). */
const GLOW_Y = 0.02;
const GLOW_DEEP = new THREE.Color('#0a6cff');

/**
 * A hologram's light on the floor under it, so it reads as hanging over that spot rather than pasted on the scene:
 * a soft pool in its colour, brightest where it's lowest as it bobs (`hover`). Lie it under the hologram, from
 * `flat` (a rectangle) or `arc` (a strip bent round, under a curved one).
 */
export class FloorGlow {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshBasicMaterial;

  private constructor(geometry: THREE.BufferGeometry, color: THREE.Color) {
    // deeper than the hologram's own colour, or it washes out to white on a pale floor
    const deep = new THREE.Color(color).lerp(GLOW_DEEP, 0.5);
    this.material = new THREE.MeshBasicMaterial({ map: fadeTexture(), color: deep, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.position.y = GLOW_Y;
  }

  /** `width` along X and `depth` along Z, centred on the mesh's position. */
  static flat(width: number, depth: number, color: THREE.Color): FloorGlow {
    const geometry = new THREE.PlaneGeometry(width, depth);
    geometry.rotateX(-Math.PI / 2);
    return new FloorGlow(geometry, color);
  }

  /** Round the origin from angle `a0` to `a1` (as curvedPanel in hallLayout.ts), between radii `r0` and `r1`. */
  static arc(r0: number, r1: number, a0: number, a1: number, color: THREE.Color, segments = 40): FloorGlow {
    const geometry = new THREE.PlaneGeometry(1, 1, segments, 1);
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const a = a0 + (pos.getX(i) + 0.5) * (a1 - a0);
      const r = r0 + (pos.getY(i) + 0.5) * (r1 - r0);
      pos.setXYZ(i, r * Math.cos(a), 0, r * Math.sin(a));
    }
    return new FloorGlow(geometry, color);
  }

  /** In step with `hover(…, t, phase)`: brightest at the bottom of its bob. */
  update(t: number, phase = 0): void {
    this.material.opacity = 0.55 - 0.08 * Math.sin(t * 0.9 + phase);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
