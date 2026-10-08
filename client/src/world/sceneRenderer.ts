import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { CopyShader } from 'three/examples/jsm/shaders/CopyShader.js';
import { Frame } from './frame';

/**
 * Draws each frame to the screen: the scene as frame.ts draws it (`?ao=0` leaves out the ambient occlusion), then
 * SMAA to smooth the edges, below a pixel ratio of SMOOTH_BELOW: above it, pixels are too small for the steps along
 * an edge to show, and SMAA's three full-screen passes are better spent elsewhere.
 *
 * The scene is drawn into a texture to read its depth, and multisampling a texture costs far more than multisampling
 * the screen does (at a pixel ratio of 2 it tripled the frame time on an Apple M4), hence SMAA rather than MSAA.
 */
/** The pixel ratio from which edges are left as they are (resolution.ts can change it as the frame goes). */
const SMOOTH_BELOW = 1.75;

export class SceneRenderer {
  private readonly frame: Frame;
  /** The frame, in display colours, for SMAA. */
  private readonly framed: THREE.WebGLRenderTarget;
  private readonly smaa = new SMAAPass();
  private readonly copy = new FullScreenQuad(new THREE.ShaderMaterial(CopyShader));
  private readonly size = new THREE.Vector2();

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    occlusion: boolean,
  ) {
    renderer.getDrawingBufferSize(this.size);
    this.frame = new Frame(renderer, scene, camera, occlusion, true, this.size);
    this.framed = new THREE.WebGLRenderTarget(this.size.x, this.size.y, { depthBuffer: false });
    this.smaa.setSize(this.size.x, this.size.y);
    this.smaa.renderToScreen = true;
  }

  /** Whether the ambient occlusion is drawn (Frame.occlusion). */
  set occlusion(on: boolean) {
    this.frame.occlusion = on;
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
    if (renderer.getPixelRatio() >= SMOOTH_BELOW) {
      (this.copy.material as THREE.ShaderMaterial).uniforms.tDiffuse.value = framed.texture;
      renderer.setRenderTarget(null);
      this.copy.render(renderer);
      return;
    }
    // to the screen (renderToScreen), so it never writes its first target
    this.smaa.render(renderer, framed, framed, 0, false);
  }
}
