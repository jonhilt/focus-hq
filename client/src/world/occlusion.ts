import * as THREE from 'three';
import type { OutlineEffect } from 'three/examples/jsm/effects/OutlineEffect.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { N8AOPass } from 'n8ao';

/** Ambient occlusion, in metres and N8AO's units: contact shading a hand's width round where surfaces meet. */
const AO = { radius: 0.6, falloff: 0.6, intensity: 2.5 };

function throughWallsMaterial(): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'void main() { gl_FragDepth = 1.0; gl_FragColor = vec4(0.0); }',
    colorWrite: false,
    depthFunc: THREE.AlwaysDepth,
  });
  // every room's landscape has a stencil value of its own (themes.ts), and nothing else uses one
  mat.stencilWrite = true;
  mat.stencilRef = 0;
  mat.stencilFunc = THREE.NotEqualStencilFunc;
  mat.stencilFail = mat.stencilZFail = mat.stencilZPass = THREE.KeepStencilOp;
  return mat;
}

/**
 * Draws the scene (outlines and all) to the screen, darkened where surfaces meet (N8AO's screen-space ambient
 * occlusion), so a wall's fittings, a console on the floor or a door in its frame look like they touch rather than
 * float. Without it (`?ao=0`) the scene goes straight to the screen, as it used to.
 *
 * On its way to the occlusion the scene is drawn into a texture, and multisampling a texture costs far more than
 * multisampling the screen does: at a pixel ratio of 2 it tripled the frame time (Apple M4, Metal). So it's only
 * multisampled at a pixel ratio of 1, where it's cheap and the outlines, thinner than a pixel, would break up without
 * it; on finer screens it's drawn plain and SMAA smooths its edges on the way to the screen.
 */
export class SceneRenderer {
  private readonly ao?: N8AOPass;
  /** The occluded scene in display colours, for SMAA, on a fine screen. */
  private readonly smoothing?: { occluded: THREE.WebGLRenderTarget; smaa: SMAAPass };
  private readonly size = new THREE.Vector2();
  /** Pushes the depth to the far plane wherever a holodeck's skin stamped its stencil. */
  private readonly throughWalls = new FullScreenQuad(throughWallsMaterial());

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly effect: OutlineEffect,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    occlusion: boolean,
  ) {
    if (!occlusion) return;
    renderer.getDrawingBufferSize(this.size);
    const multisample = renderer.getPixelRatio() < 1.5;
    const ao = new N8AOPass(scene, camera, this.size.x, this.size.y);
    // the scene is drawn here, through the outline effect, rather than by the pass, into a target with a stencil for
    // holodeck landscapes, half floats for linear colours, and its depth to read
    ao.configuration.autoRenderBeauty = false;
    ao.beautyRenderTarget.dispose();
    const depth = new THREE.DepthTexture(this.size.x, this.size.y, THREE.UnsignedInt248Type);
    depth.format = THREE.DepthStencilFormat;
    ao.beautyRenderTarget = new THREE.WebGLRenderTarget(this.size.x, this.size.y, {
      type: THREE.HalfFloatType,
      samples: multisample ? 4 : 0,
      stencilBuffer: true,
      depthTexture: depth,
    });
    ao.configuration.aoRadius = AO.radius;
    ao.configuration.distanceFalloff = AO.falloff;
    ao.configuration.intensity = AO.intensity;
    // half resolution, scaled back up along depth edges: most of the cost gone, and the shading is soft anyway
    ao.configuration.halfRes = true;
    ao.configuration.depthAwareUpsampling = true;
    // it turns linear colours to display ones, as the renderer would on the screen (and SMAA finds edges in)
    ao.configuration.gammaCorrection = true;
    ao.renderToScreen = multisample;
    this.ao = ao;
    if (multisample) return;
    const smaa = new SMAAPass();
    smaa.renderToScreen = true;
    smaa.setSize(this.size.x, this.size.y);
    this.smoothing = { occluded: new THREE.WebGLRenderTarget(this.size.x, this.size.y, { depthBuffer: false }), smaa };
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    if (!this.ao) {
      this.effect.render(scene, camera);
      return;
    }
    this.renderer.getDrawingBufferSize(this.size);
    const target = this.ao.beautyRenderTarget;
    if (target.width !== this.size.x || target.height !== this.size.y) {
      this.ao.setSize(this.size.x, this.size.y);
      this.smoothing?.occluded.setSize(this.size.x, this.size.y);
      this.smoothing?.smaa.setSize(this.size.x, this.size.y);
    }
    this.renderer.setRenderTarget(target);
    this.effect.render(scene, camera);
    // a holodeck's walls are still in the depth where its landscape shows through them (scenery.ts writes them back),
    // which would shade the sky round the wall's corners: there, the depth goes to the far plane, as the sky's is
    const autoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;
    this.throughWalls.render(this.renderer);
    this.renderer.autoClear = autoClear;
    if (!this.smoothing) {
      this.ao.render(this.renderer, null, null);
      this.renderer.setRenderTarget(null);
      return;
    }
    const { occluded, smaa } = this.smoothing;
    this.ao.render(this.renderer, occluded, null);
    // to the screen (renderToScreen), so it never writes its first target
    smaa.render(this.renderer, occluded, occluded, 0, false);
  }
}
