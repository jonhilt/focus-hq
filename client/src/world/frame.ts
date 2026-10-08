import * as THREE from 'three';
import { Outlines, sceneTarget, stencilToSky } from './outline';

/**
 * The layer for what's drawn over the finished picture rather than in it: speech bubbles. They still hide behind
 * whatever stands in front of them, but have no depth of their own, so the outlines, which read the depth, would
 * otherwise draw what's behind a bubble straight across it.
 */
export const OVERLAY_LAYER = 1;

/**
 * How far past its clip rectangle a frame is still drawn, in pixels at full size, so the outlines at its edges read
 * what's really there, not what was left from an earlier frame.
 */
const CLIP_MARGIN = 32;

/**
 * Draws the scene into a target, as the screen shows it (SceneRenderer) and as a doorway shows its far side
 * (PortalView), so the two match as you step through: the scene; the overlay against its depth; the outlines
 * (outline.ts); and the overlay over the top. Contact shading isn't drawn here: the decks have it baked in
 * (blender/bake.py), and what's built in code casts contact shadows (contactShadow.ts).
 */
export class Frame {
  /** The scene: linear colours, its depth and a stencil. */
  private readonly drawn: THREE.WebGLRenderTarget;
  /** The overlay, sharing the scene's depth to hide behind what's in front of it. */
  private readonly overlay: THREE.WebGLRenderTarget;
  private readonly outlines = new Outlines();
  private readonly clearColor = new THREE.Color();
  /** Where on the screen it's drawn (0 to 1, as onScreen in doorway.ts gives), or everywhere (null). */
  private rect: THREE.Vector4 | null = null;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    /** Whether it comes out in display colours, for the screen, or linear, for a material to show. */
    private readonly display: boolean,
    size: THREE.Vector2,
  ) {
    const { x: w, y: h } = size;
    this.drawn = sceneTarget(w, h);
    this.overlay = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, stencilBuffer: true, depthTexture: this.drawn.depthTexture });
  }

  setSize(w: number, h: number): void {
    if (this.drawn.width === w && this.drawn.height === h) return;
    this.drawn.setSize(w, h);
    this.overlay.setSize(w, h);
  }

  /** Draws only within `rect` from now on, where only that much will be seen (a doorway's opening), or everywhere. */
  clip(rect: THREE.Vector4 | null): void {
    this.rect = rect;
  }

  render(scene: THREE.Scene, camera: THREE.Camera, output: THREE.WebGLRenderTarget): void {
    const { renderer, drawn } = this;
    this.scissor(output);
    renderer.setRenderTarget(drawn);
    renderer.render(scene, camera);
    this.drawOverlay(scene, camera);
    renderer.setRenderTarget(drawn);
    stencilToSky(renderer);
    this.outlines.render(renderer, { target: drawn, camera, overlay: this.overlay.texture }, output, this.display);
  }

  /** Sets every target the frame draws into to draw only within its rectangle. */
  private scissor(output: THREE.WebGLRenderTarget): void {
    const { rect, drawn } = this;
    for (const t of [drawn, this.overlay, output]) {
      t.scissorTest = !!rect;
      if (!rect) continue;
      const x = Math.max(0, Math.floor(rect.x * t.width - CLIP_MARGIN));
      const y = Math.max(0, Math.floor(rect.y * t.height - CLIP_MARGIN));
      t.scissor.set(x, y, Math.min(t.width, Math.ceil((rect.x + rect.z) * t.width + CLIP_MARGIN)) - x, Math.min(t.height, Math.ceil((rect.y + rect.w) * t.height + CLIP_MARGIN)) - y);
    }
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
