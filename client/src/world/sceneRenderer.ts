import * as THREE from 'three';
import type { OutlineEffect } from 'three/examples/jsm/effects/OutlineEffect.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { Frame } from './frame';

/**
 * Draws each frame to the screen: the scene as frame.ts draws it (`?ao=0` leaves out the ambient occlusion), then
 * SMAA to smooth the edges.
 *
 * The scene is drawn into a texture to read its depth, and multisampling a texture costs far more than multisampling
 * the screen does (at a pixel ratio of 2 it tripled the frame time on an Apple M4), hence SMAA rather than MSAA.
 */
export class SceneRenderer {
  private readonly frame: Frame;
  /** The frame, in display colours, for SMAA. */
  private readonly framed: THREE.WebGLRenderTarget;
  private readonly smaa = new SMAAPass();
  private readonly size = new THREE.Vector2();

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    hulls: OutlineEffect | null,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    occlusion: boolean,
  ) {
    renderer.getDrawingBufferSize(this.size);
    this.frame = new Frame(renderer, hulls, scene, camera, occlusion, true, this.size);
    this.framed = new THREE.WebGLRenderTarget(this.size.x, this.size.y, { depthBuffer: false });
    this.smaa.setSize(this.size.x, this.size.y);
    this.smaa.renderToScreen = true;
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    const { renderer, framed } = this;
    renderer.getDrawingBufferSize(this.size);
    const { x: w, y: h } = this.size;
    if (framed.width !== w || framed.height !== h) {
      framed.setSize(w, h);
      this.smaa.setSize(w, h);
    }
    this.frame.setSize(w, h);
    this.frame.render(scene, camera, framed);
    // to the screen (renderToScreen), so it never writes its first target
    this.smaa.render(renderer, framed, framed, 0, false);
  }
}
