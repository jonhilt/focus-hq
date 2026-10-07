import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

// The cartoon outlines, drawn after the scene from its depth rather than as an inflated, inside-out copy of each mesh
// (three's OutlineEffect, which `?outline=hull` brings back to compare). A pixel is on a line when it's the near side of
// a step in depth (a silhouette) or of a sharp fold between faces (a box's corner, where a wall meets the floor). So
// lines are the same width everywhere, don't break up at corners or fight the depth of whatever's beside them, and
// don't appear between two meshes that meet flush, however they were split up in Blender.

/** The lines' colour, linear: OutlineEffect's default, as the landscapes' own hulls still use (scenery.ts). */
const LINE = new THREE.Color().setRGB(0.1, 0.1, 0.12);
/** How wide the lines are, in CSS pixels. */
const LINE_WIDTH = 1.5;
/** Steps out of a surface (metres) smaller than this aren't edges: a screen on its console, a sign on its wall. */
const MIN_STEP = 0.03;
/** Faces meeting at more than this are an edge; gentler folds, like a 45° bevel or a cylinder's facets, aren't. */
const CREASE_DEGREES = 60;

const material = new THREE.ShaderMaterial({
  uniforms: {
    tColor: { value: null },
    tDepth: { value: null },
    projectionInverse: { value: new THREE.Matrix4() },
    texel: { value: new THREE.Vector2() },
    footprint: { value: 0 },
    depthPrecision: { value: 0 },
    lineLinear: { value: LINE.clone() },
    lineDisplay: { value: LINE.clone().convertLinearToSRGB() },
    inputDisplay: { value: false },
    outputDisplay: { value: false },
    lines: { value: true },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tColor;
    uniform sampler2D tDepth;
    uniform mat4 projectionInverse;
    uniform vec2 texel;
    uniform float footprint;
    uniform float depthPrecision;
    uniform vec3 lineLinear;
    uniform vec3 lineDisplay;
    uniform bool inputDisplay;
    uniform bool outputDisplay;
    uniform bool lines;
    varying vec2 vUv;
    const float CREASE = ${Math.cos(THREE.MathUtils.degToRad(CREASE_DEGREES)).toFixed(4)};

    float depthAt(vec2 uv) { return texture2D(tDepth, uv).x; }

    vec3 viewAt(vec2 uv, float depth) {
      vec4 p = projectionInverse * vec4(vec3(uv, depth) * 2.0 - 1.0, 1.0);
      return p.xyz / p.w;
    }

    vec3 viewAt(vec2 uv) { return viewAt(uv, depthAt(uv)); }

    // the difference across to the surface on one side of c, along o: of the two sides, the one that carries on most
    // nearly in a straight line two samples out, so a pixel at a step or a silhouette gets its own surface's slope
    // rather than one across it (the nearer in depth won't do: along a floor seen end on, depth changes faster than
    // across a step onto a mat lying on it)
    vec3 slope(vec2 uv, vec3 c, vec2 o) {
      vec3 a = viewAt(uv - o), aa = viewAt(uv - 2.0 * o);
      vec3 b = viewAt(uv + o), bb = viewAt(uv + 2.0 * o);
      return abs(2.0 * a.z - aa.z - c.z) < abs(2.0 * b.z - bb.z - c.z) ? c - a : b - c;
    }

    // the surface's normal from the depth around it, turned to face the camera
    vec3 normalAt(vec2 uv, vec3 c) {
      vec3 n = normalize(cross(slope(uv, c, vec2(texel.x, 0.0)), slope(uv, c, vec2(0.0, texel.y))));
      return dot(n, c) > 0.0 ? -n : n;
    }

    // how far behind this surface a neighbour lies, in steps: 0 on the surface (or in front), 1 at a full step back;
    // the sky's as far back as it gets
    float behind(vec2 uv, vec3 c, vec3 n, float step) {
      float d = depthAt(uv);
      if (d >= 1.0) return 1.0;
      return -dot(viewAt(uv, d) - c, n) / step;
    }

    // how much of an edge this pixel is: 0 none, 1 a full line, in between for steps and folds near the thresholds
    // (so they fade, rather than breaking into dashes where they waver either side)
    float edge(vec3 c, float step) {
      vec3 n = normalAt(vUv, c);
      vec2 offsets[4] = vec2[4](vec2(texel.x, 0.0), vec2(0.0, texel.y), vec2(-texel.x, 0.0), vec2(0.0, -texel.y));
      float strength = 0.0;
      for (int i = 0; i < 4; i++) {
        vec2 uv = vUv + offsets[i];
        // the near side of a silhouette: the neighbour's well behind this surface, and so is the one past it, so a
        // crack a pixel wide between two meshes doesn't count
        float back = min(behind(uv, c, n, step), behind(uv + offsets[i], c, n, step));
        strength = max(strength, smoothstep(0.5, 1.0, back));
        // the near side of a fold, looking one way across it (right and up) so the line is one width wide: the
        // neighbour's on the same surface, give or take the fold, but facing another way
        float d = depthAt(uv);
        if (i < 2 && d < 1.0) {
          vec3 p = viewAt(uv, d);
          float off = abs(dot(p - c, n)) / step;
          float facing = dot(normalAt(uv, p), n);
          strength = max(strength, smoothstep(CREASE + 0.08, CREASE - 0.08, facing) * (1.0 - smoothstep(0.5, 1.0, off)));
        }
      }
      return strength;
    }

    void main() {
      vec4 color = texture2D(tColor, vUv);
      if (!inputDisplay && outputDisplay) color = sRGBTransferOETF(color);
      float d = depthAt(vUv);
      if (lines && d < 1.0) {
        vec3 c = viewAt(vUv, d);
        float z = -c.z;
        // how far out of its surface a neighbour has to be to count: past the smallest real step, a couple of pixels'
        // worth at that distance, and the depth buffer's precision there
        float step = max(${MIN_STEP.toFixed(3)}, 2.0 * footprint * z) + depthPrecision * z * z;
        color.rgb = mix(color.rgb, outputDisplay ? lineDisplay : lineLinear, edge(c, step));
      }
      gl_FragColor = color;
    }`,
  depthTest: false,
  depthWrite: false,
});

/** What to outline: a scene drawn into a target with a depth texture, and the camera it was drawn from. */
export interface Drawn {
  target: THREE.WebGLRenderTarget;
  camera: THREE.Camera;
  /** Its colours, if not the target's own: in display colours (true) or linear (false). */
  color?: { texture: THREE.Texture; display: boolean };
}

export class Outlines {
  private readonly quad = new FullScreenQuad(material);

  /** `lines` false copies the colours across untouched, as when the scene was drawn with its own outlines. */
  constructor(private readonly lines = true) {}

  /** Draws `drawn` into `output` with its outlines, in display colours (`display`) or linear. */
  render(renderer: THREE.WebGLRenderer, drawn: Drawn, output: THREE.WebGLRenderTarget, display: boolean): void {
    const u = material.uniforms;
    const width = Math.max(1, Math.round(LINE_WIDTH * renderer.getPixelRatio()));
    const { target, camera } = drawn;
    u.tColor.value = drawn.color?.texture ?? target.texture;
    u.inputDisplay.value = drawn.color?.display ?? false;
    u.outputDisplay.value = display;
    u.tDepth.value = target.depthTexture;
    u.projectionInverse.value = camera.projectionMatrixInverse;
    u.texel.value.set(width / target.width, width / target.height);
    // how far apart (in view space, per metre away) neighbouring pixels are: the projection's vertical scale
    u.footprint.value = (2 * width) / (camera.projectionMatrix.elements[5] * target.height);
    // the depth buffer's resolution at a metre away, from its near plane (24 bits), which grows with distance squared
    const near = (camera as THREE.PerspectiveCamera).near ?? 0.05;
    u.depthPrecision.value = 4 / (near * 2 ** 24);
    u.lines.value = this.lines;
    renderer.setRenderTarget(output);
    this.quad.render(renderer);
  }
}

/** A target to draw the scene into for outlining: linear half floats, a stencil, and its depth to read. */
export function sceneTarget(width: number, height: number): THREE.WebGLRenderTarget {
  const depth = new THREE.DepthTexture(width, height, THREE.UnsignedInt248Type);
  depth.format = THREE.DepthStencilFormat;
  return new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, stencilBuffer: true, depthTexture: depth });
}

function skyMaterial(): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'void main() { gl_FragDepth = 1.0; gl_FragColor = vec4(0.0); }',
    colorWrite: false,
    depthFunc: THREE.AlwaysDepth,
  });
  // every room's landscape has a stencil value of its own (themes.ts), and a doorway's alcove another (portal.ts):
  // neither shows what's really there
  mat.stencilWrite = true;
  mat.stencilRef = 0;
  mat.stencilFunc = THREE.NotEqualStencilFunc;
  mat.stencilFail = mat.stencilZFail = mat.stencilZPass = THREE.KeepStencilOp;
  return mat;
}

const sky = new FullScreenQuad(skyMaterial());

/**
 * Pushes the depth of the scene just drawn (into the current target) to the far plane wherever a stencil value says
 * it shows something other than what's there: a holodeck's walls are still in the depth where its landscape shows
 * through them (scenery.ts writes them back), and a doorway's alcove where the far room is drawn over it. Outlines and
 * ambient occlusion would draw those walls' and alcoves' corners over the picture; as sky, they leave it alone.
 */
export function stencilToSky(renderer: THREE.WebGLRenderer): void {
  const autoClear = renderer.autoClear;
  renderer.autoClear = false;
  sky.render(renderer);
  renderer.autoClear = autoClear;
}
