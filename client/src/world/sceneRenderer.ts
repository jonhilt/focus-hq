import * as THREE from 'three';
import type { OutlineEffect } from 'three/examples/jsm/effects/OutlineEffect.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { N8AOPass } from 'n8ao';
import { Outlines, sceneTarget, stencilToSky } from './outline';

/** Ambient occlusion, in metres and N8AO's units: contact shading a hand's width round where surfaces meet. */
const AO = { radius: 0.6, falloff: 0.6, intensity: 2.5 };

/**
 * Draws each frame to the screen: the scene, darkened where surfaces meet (N8AO's screen-space ambient occlusion), so
 * a wall's fittings, a console on the floor or a door in its frame look like they touch rather than float (`?ao=0`
 * leaves it out); then its outlines (outline.ts), and SMAA to smooth the edges.
 *
 * The scene is drawn into a texture to read its depth, and multisampling a texture costs far more than multisampling
 * the screen does (at a pixel ratio of 2 it tripled the frame time on an Apple M4), hence SMAA rather than MSAA.
 */
export class SceneRenderer {
  private readonly drawn: THREE.WebGLRenderTarget;
  private readonly ao?: N8AOPass;
  /** The occluded scene, in display colours. */
  private readonly occluded?: THREE.WebGLRenderTarget;
  /** The outlined scene, in display colours, for SMAA. */
  private readonly outlined: THREE.WebGLRenderTarget;
  private readonly outlines: Outlines;
  private readonly smaa = new SMAAPass();
  private readonly size = new THREE.Vector2();

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    /** Draws the scene with its outlines as hulls (`?outline=hull`, to compare), or null for outline.ts's lines. */
    private readonly hulls: OutlineEffect | null,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    occlusion: boolean,
  ) {
    renderer.getDrawingBufferSize(this.size);
    const { x: w, y: h } = this.size;
    this.drawn = sceneTarget(w, h);
    this.outlined = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false });
    this.outlines = new Outlines(!hulls);
    this.smaa.setSize(w, h);
    this.smaa.renderToScreen = true;
    if (!occlusion) return;
    const ao = new N8AOPass(scene, camera, w, h);
    // the scene is drawn here rather than by the pass
    ao.configuration.autoRenderBeauty = false;
    ao.beautyRenderTarget.dispose();
    ao.beautyRenderTarget = this.drawn;
    ao.configuration.aoRadius = AO.radius;
    ao.configuration.distanceFalloff = AO.falloff;
    ao.configuration.intensity = AO.intensity;
    // half resolution, scaled back up along depth edges: most of the cost gone, and the shading is soft anyway
    ao.configuration.halfRes = true;
    ao.configuration.depthAwareUpsampling = true;
    // it turns linear colours to display ones, as the renderer would on the screen (and SMAA finds edges in)
    ao.configuration.gammaCorrection = true;
    this.ao = ao;
    this.occluded = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false });
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    const { renderer, drawn } = this;
    renderer.getDrawingBufferSize(this.size);
    const { x: w, y: h } = this.size;
    if (drawn.width !== w || drawn.height !== h) {
      drawn.setSize(w, h);
      this.ao?.setSize(w, h);
      this.occluded?.setSize(w, h);
      this.outlined.setSize(w, h);
      this.smaa.setSize(w, h);
    }
    renderer.setRenderTarget(drawn);
    if (this.hulls) this.hulls.render(scene, camera);
    else renderer.render(scene, camera);
    stencilToSky(renderer);
    if (this.ao && this.occluded) this.ao.render(renderer, this.occluded, null);
    const color = this.occluded ? { texture: this.occluded.texture, display: true } : undefined;
    this.outlines.render(renderer, { target: drawn, camera, color }, this.outlined, true);
    // to the screen (renderToScreen), so it never writes its first target
    this.smaa.render(renderer, this.outlined, this.outlined, 0, false);
  }
}
