import * as THREE from 'three';
import { noOutline } from './materials';

// Space outside the viewports, worked out per pixel from the eye's ray through the glass, so every window looks
// out on the same sky from where it actually is and the view shifts as you walk past. The ship cruises towards -Z:
// near stars sit on cylinders around the ship's long axis and slide aft, slower the further out they are, while
// the distant stars, a nebula and a planet hang still at infinity. Side windows see stars drift past; the window at
// the end of the corridor sees them stream out of the dead ahead.

const vertexShader = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragmentShader = /* glsl */ `
uniform float uTime;
varying vec3 vWorld;

#define TAU 6.2831853
#define AXIS_Y 1.6
#define SPEED 7.0
// cells along the axis before the drifting layers repeat; keeps the scroll offset small enough for float precision
#define PERIOD 2048.0

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
float noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash33(i).x, n100 = hash33(i + vec3(1, 0, 0)).x, n010 = hash33(i + vec3(0, 1, 0)).x, n110 = hash33(i + vec3(1, 1, 0)).x;
  float n001 = hash33(i + vec3(0, 0, 1)).x, n101 = hash33(i + vec3(1, 0, 1)).x, n011 = hash33(i + vec3(0, 1, 1)).x, n111 = hash33(i + vec3(1, 1, 1)).x;
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y), mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}

vec3 starColor(float h) {
  return h < 0.15 ? vec3(1.0, 0.82, 0.62) : h < 0.3 ? vec3(0.7, 0.8, 1.0) : vec3(1.0);
}

/** A star shape of world radius size, never thinner than a pixel; fainter rather than smaller once it is. */
float star(float dist, float size, float pixel) {
  float r = max(size, pixel);
  return smoothstep(r, r * 0.2, dist) * min(1.0, size * size / (r * r) * 4.0);
}

/** Stars on a cylinder of radius R around the ship's axis, drifting aft. */
vec3 drifting(vec3 ro, vec3 rd, float R, float cell) {
  vec2 o = ro.xy - vec2(0.0, AXIS_Y);
  float a = dot(rd.xy, rd.xy);
  if (a < 1e-5) return vec3(0.0);
  float b = dot(o, rd.xy);
  float t = (-b + sqrt(b * b - a * (dot(o, o) - R * R))) / a;
  vec3 hit = ro + rd * t;
  float around = floor(TAU * R / cell);
  float u = (atan(hit.y - AXIS_Y, hit.x) / TAU + 0.5) * around;
  float v = (hit.z - mod(uTime * SPEED, cell * PERIOD)) / cell;
  vec2 id = vec2(mod(floor(u), around), mod(floor(v), PERIOD));
  float h = hash12(id + R);
  if (h > 0.5) return vec3(0.0);
  vec2 d = (fract(vec2(u, v)) - (0.25 + 0.5 * hash22(id + R * 1.7))) * cell;
  d.y = max(0.0, abs(d.y) - SPEED * 0.02); // a touch of motion blur along the direction of travel
  float pixel = length(fwidth(hit)) * 0.8;
  return starColor(hash12(id - R)) * star(length(d), cell * (0.01 + 0.02 * h), pixel);
}

/** Stars at infinity, scattered over the sky. */
vec3 fixedStars(vec3 rd, float scale, float chance) {
  vec3 p = rd * scale;
  vec3 id = floor(p);
  vec3 h = hash33(id);
  if (h.x > chance) return vec3(0.0);
  float dist = length(p - id - 0.2 - 0.6 * hash33(id + 17.0));
  return starColor(h.y) * (0.4 + 0.6 * h.z) * star(dist, 0.06, length(fwidth(p)) * 0.8);
}

/** A toon-shaded planet hanging off the starboard bow. */
vec4 planet(vec3 rd) {
  vec3 dir = normalize(vec3(1.0, 0.02, -0.35));
  float radius = 0.085;
  vec3 side = normalize(cross(dir, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(side, dir);
  vec2 q = vec2(dot(rd, side), dot(rd, up)) / radius;
  float r2 = dot(q, q);
  if (dot(rd, dir) < 0.0 || r2 > 1.0) return vec4(0.0);
  vec3 n = vec3(q, sqrt(1.0 - r2));
  float light = dot(n, normalize(vec3(-0.6, 0.5, 0.6)));
  float band = sin(q.y * 9.0 + noise(vec3(q * 3.0, 1.0)) * 2.0) * 0.5 + 0.5;
  vec3 base = mix(vec3(0.85, 0.45, 0.35), vec3(1.0, 0.65, 0.45), step(0.5, band));
  vec3 col = base * (light > 0.35 ? 1.0 : light > -0.1 ? 0.62 : 0.18);
  col += vec3(1.0, 0.75, 0.6) * smoothstep(0.82, 1.0, sqrt(r2)) * step(0.0, light) * 0.35; // atmosphere on the lit limb
  return vec4(col, smoothstep(1.0, 0.97, sqrt(r2)));
}

void main() {
  vec3 rd = normalize(vWorld - cameraPosition);
  vec3 col = mix(vec3(0.012, 0.012, 0.05), vec3(0.04, 0.03, 0.1), rd.y * 0.5 + 0.5);
  float cloud = noise(rd * 2.2) * 0.55 + noise(rd * 5.0) * 0.3 + noise(rd * 11.0) * 0.15;
  col += mix(vec3(0.5, 0.2, 0.55), vec3(0.25, 0.3, 0.75), noise(rd * 1.3 + 4.0)) * smoothstep(0.5, 0.85, cloud) * 0.35;
  col += fixedStars(rd, 70.0, 0.3) + fixedStars(rd, 160.0, 0.4) * 0.7;
  vec4 p = planet(rd);
  col = mix(col, p.rgb, p.a);
  col += drifting(vWorld, rd, 160.0, 18.0) + drifting(vWorld, rd, 80.0, 11.0) + drifting(vWorld, rd, 42.0, 7.0) + drifting(vWorld, rd, 24.0, 5.0);
  // a faint diagonal sheen so it reads as glass
  col += vec3(0.6, 0.7, 1.0) * 0.035 * smoothstep(0.75, 1.0, sin((vWorld.x + vWorld.z) * 1.4 + vWorld.y * 2.0) * 0.5 + 0.5);
  // display colours, like the flat() screens: back to linear for three to turn into display colours again, so they
  // come out the same drawn into a target first, as through a doorway (portal.ts)
  gl_FragColor = sRGBTransferEOTF(vec4(col, 1.0));
  #include <colorspace_fragment>
}
`;

const material = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, vertexShader, fragmentShader });
noOutline(material);

/** The glass of every viewport: one shared material, so space moves on in step outside all of them. */
export const viewportGlass: THREE.Material = material;

/** Moves the ship on through space to time `t` (seconds). */
export function cruise(t: number): void {
  material.uniforms.uTime.value = t;
}
