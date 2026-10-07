import * as THREE from 'three';
import type { OutlineEffect } from 'three/examples/jsm/effects/OutlineEffect.js';
import { N8AOPass } from 'n8ao';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { Outlines, sceneTarget, stencilToSky } from './outline';

/**
 * The layer for what's drawn over the finished picture rather than in it: speech bubbles. They still hide behind
 * whatever stands in front of them, but have no depth of their own, so the ambient occlusion and outlines, which read
 * the depth, would otherwise draw what's behind a bubble straight across it.
 */
export const OVERLAY_LAYER = 1;

/** Ambient occlusion, in metres and N8AO's units: contact shading a hand's width round where surfaces meet. */
const AO = { radius: 0.6, falloff: 0.6, intensity: 2.5 };

/** Rewrites depth from one camera's projection into another's (from the same place), for N8AO. */
const reproject = new FullScreenQuad(
  new THREE.ShaderMaterial({
    uniforms: { tDepth: { value: null }, fromInverse: { value: new THREE.Matrix4() }, to: { value: new THREE.Matrix4() } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDepth;
      uniform mat4 fromInverse;
      uniform mat4 to;
      varying vec2 vUv;
      void main() {
        float d = texture2D(tDepth, vUv).x;
        if (d >= 1.0) {
          gl_FragDepth = 1.0;
        } else {
          vec4 p = fromInverse * vec4(vec3(vUv, d) * 2.0 - 1.0, 1.0);
          vec4 q = to * (p / p.w);
          gl_FragDepth = clamp(q.z / q.w * 0.5 + 0.5, 0.0, 1.0);
        }
        gl_FragColor = vec4(0.0);
      }`,
    colorWrite: false,
    depthFunc: THREE.AlwaysDepth,
  }),
);

/**
 * Draws the scene into a target, as the screen shows it (SceneRenderer) and as a doorway shows its far side
 * (PortalView), so the two match as you step through: the scene; the overlay against its depth; ambient occlusion
 * (N8AO's, screen-space), so a wall's fittings, a console on the floor or a door in its frame look like they touch
 * rather than float; the outlines (outline.ts); and the overlay over the top.
 */
export class Frame {
  /** The scene: linear colours, its depth and a stencil. */
  private readonly drawn: THREE.WebGLRenderTarget;
  /** The overlay, sharing the scene's depth to hide behind what's in front of it. */
  private readonly overlay: THREE.WebGLRenderTarget;
  private readonly ao?: N8AOPass;
  /** The occluded scene, linear or in display colours as the frame's output is. */
  private readonly occluded?: THREE.WebGLRenderTarget;
  private readonly outlines: Outlines;
  private readonly clearColor = new THREE.Color();
  /**
   * The scene's depth as `camera` (the occlusion's) would have drawn it, when it's drawn from a camera with another
   * projection: a doorway's, whose near plane lies along the far doorway (portal.ts), which N8AO can't read depth from.
   */
  private reprojected?: THREE.WebGLRenderTarget;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    /** Draws the scene with its outlines as hulls (`?outline=hull`, to compare), or null for outline.ts's lines. */
    private readonly hulls: OutlineEffect | null,
    scene: THREE.Scene,
    /** The camera the scene's drawn from, or one in the same place with a plain projection (the occlusion's). */
    private readonly camera: THREE.PerspectiveCamera,
    occlusion: boolean,
    /** Whether it comes out in display colours, for the screen, or linear, for a material to show. */
    private readonly display: boolean,
    size: THREE.Vector2,
  ) {
    const { x: w, y: h } = size;
    this.drawn = sceneTarget(w, h);
    this.overlay = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, stencilBuffer: true, depthTexture: this.drawn.depthTexture });
    this.outlines = new Outlines(!hulls);
    if (!occlusion) return;
    const ao = new N8AOPass(scene, camera, w, h);
    // the scene is drawn here rather than by the pass
    ao.configuration.autoRenderBeauty = false;
    if (ao.beautyRenderTarget instanceof THREE.WebGLRenderTarget) ao.beautyRenderTarget.dispose();
    ao.beautyRenderTarget = this.drawn;
    // and nothing in it is drawn again for its transparency (nor is the scene searched for any, every frame)
    ao.autoDetectTransparency = false;
    ao.configuration.transparencyAware = false;
    ao.configuration.aoRadius = AO.radius;
    ao.configuration.distanceFalloff = AO.falloff;
    ao.configuration.intensity = AO.intensity;
    // half resolution, scaled back up along depth edges: most of the cost gone, and the shading is soft anyway
    ao.configuration.halfRes = true;
    ao.configuration.depthAwareUpsampling = true;
    ao.configuration.gammaCorrection = display;
    this.ao = ao;
    this.occluded = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false });
  }

  setSize(w: number, h: number): void {
    if (this.drawn.width === w && this.drawn.height === h) return;
    this.drawn.setSize(w, h);
    this.overlay.setSize(w, h);
    this.ao?.setSize(w, h);
    this.occluded?.setSize(w, h);
    this.reprojected?.setSize(w, h);
  }

  render(scene: THREE.Scene, camera: THREE.Camera, output: THREE.WebGLRenderTarget): void {
    const { renderer, drawn } = this;
    renderer.setRenderTarget(drawn);
    if (this.hulls) this.hulls.render(scene, camera);
    else renderer.render(scene, camera);
    this.drawOverlay(scene, camera);
    renderer.setRenderTarget(drawn);
    stencilToSky(renderer);
    if (this.ao && this.occluded) {
      this.ao.beautyRenderTarget = camera === this.camera ? drawn : this.reproject(camera);
      this.ao.render(renderer, this.occluded, null);
    }
    const color = this.occluded ? { texture: this.occluded.texture, display: this.display } : undefined;
    this.outlines.render(renderer, { target: drawn, camera, color, overlay: this.overlay.texture }, output, this.display);
  }

  /** The scene's colours, with its depth as the occlusion's camera would have drawn it. */
  private reproject(from: THREE.Camera): { texture: THREE.Texture; depthTexture: THREE.DepthTexture | null; setSize(): void } {
    const { renderer, drawn } = this;
    if (!this.reprojected) {
      const depth = new THREE.DepthTexture(drawn.width, drawn.height, THREE.UnsignedIntType);
      this.reprojected = new THREE.WebGLRenderTarget(drawn.width, drawn.height, { depthTexture: depth });
    }
    const u = (reproject.material as THREE.ShaderMaterial).uniforms;
    u.tDepth.value = drawn.depthTexture;
    u.fromInverse.value = from.projectionMatrixInverse;
    u.to.value = this.camera.projectionMatrix;
    renderer.setRenderTarget(this.reprojected);
    reproject.render(renderer);
    // sized with the frame, not by the pass
    return { texture: drawn.texture, depthTexture: this.reprojected.depthTexture, setSize: () => undefined };
  }

  private drawOverlay(scene: THREE.Scene, camera: THREE.Camera): void {
    const { renderer } = this;
    renderer.setRenderTarget(this.overlay);
    renderer.getClearColor(this.clearColor);
    const clearAlpha = renderer.getClearAlpha();
    // clear to nothing, but keep the scene's depth
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    const autoClear = renderer.autoClear;
    const background = scene.background;
    renderer.autoClear = false;
    scene.background = null;
    camera.layers.set(OVERLAY_LAYER);
    renderer.render(scene, camera);
    camera.layers.set(0);
    scene.background = background;
    renderer.autoClear = autoClear;
    renderer.setClearColor(this.clearColor, clearAlpha);
  }
}
