import * as THREE from 'three';

// The warp core's glow in main engineering (blender/engineering_deck.py): its column, where pulses of light climb from
// the lower level up through the ceiling, and the intermix chamber about the gallery's eye level, which throbs in time.
// Both are shared materials, so every 'warp-core' surface on the deck pulses together.

/** Which part of the core a surface is. */
export type CorePart = 'column' | 'chamber';

const vertexShader = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragmentShader = (part: CorePart) => /* glsl */ `
uniform float uTime;
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  // brightest where the cylinder faces you, deep blue towards its edges, so it reads round without any lighting
  float facing = abs(dot(normalize(vNormal), normalize(cameraPosition - vWorld)));
  vec3 col = mix(vec3(0.10, 0.36, 0.66), vec3(0.56, 0.89, 1.0), smoothstep(0.1, 0.85, facing));
  ${part === 'column'
    ? `// rings of light climbing the column, a dark seam between each pair of segments
  float s = fract(vWorld.y * 0.9 - uTime * 0.8);
  col += vec3(0.75, 0.95, 1.0) * exp(-pow((s - 0.5) * 5.0, 2.0)) * (0.35 + 0.65 * facing);
  col *= 1.0 - 0.45 * step(0.92, fract(vWorld.y * 3.0));`
    : `// the chamber throbs with each pulse that leaves it
  float throb = 0.5 + 0.5 * sin(uTime * 0.8 * 6.2831853);
  col = mix(col, vec3(0.92, 0.99, 1.0), (0.45 + 0.35 * throb) * smoothstep(0.2, 0.9, facing));`}
  // display colours, like the flat() screens: back to linear, so they come out the same through a doorway
  gl_FragColor = sRGBTransferEOTF(vec4(col, 1.0));
  #include <colorspace_fragment>
}
`;

const time = { value: 0 };
const materials: Record<CorePart, THREE.ShaderMaterial> = {
  column: new THREE.ShaderMaterial({ uniforms: { uTime: time }, vertexShader, fragmentShader: fragmentShader('column') }),
  chamber: new THREE.ShaderMaterial({ uniforms: { uTime: time }, vertexShader, fragmentShader: fragmentShader('chamber') }),
};

/** What a part of the warp core is drawn with. */
export function warpCore(part: CorePart): THREE.Material {
  return materials[part];
}

/** Runs the warp core on to time `t` (seconds). */
export function pulse(t: number): void {
  time.value = t;
}
