import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clearOfHall, insideHall, keepOut } from './footprint';
import { ENTRANCE_X } from './hallLayout';
import { DOOR_H, DOOR_W, HALL } from './layout';
import { toonMaterial } from './materials';

// A themed holodeck's training hall (hall.ts) has its walls and ceiling lined with an invisible "skin", and a landscape
// is built around the hall (in its frame, overlapping whatever else stands there). Each frame:
//   1. the office renders as usual, real walls included;
//   2. the skin stamps this room's stencil value wherever it is visible and pushes the depth there to the far plane;
//   3. the landscape renders only where the stencil matches, so it shows through this room's walls and nowhere else;
//   4. the skin writes its own depth back, so outlines and transparent office things sort against the wall as before;
//   5. a faint grid is drawn on the skin, brighter as you get close, so you can still tell where the wall is.

/** Render order: office (0) → stamp (10) → clear (11) → landscape (12) | landscape glass (-20) → restore (-10) → office glass (0). */
const ORDER = { stamp: 10, clear: 11, landscape: 12, glass: -20, restore: -10 };

const OUTLINE = new THREE.Color().setRGB(0.1, 0.1, 0.12); // the outlines' colour (linear), as outline.ts's
const noRaycast = () => {};

/** The skin's geometry's name: the gap scan (gaps.ts) knows it hides whatever is behind it. */
export const SKIN = 'holodeck skin';

/**
 * A training hall's skin: in front of its walls' inner faces by HALL_SKIN_INSET, clear of their trims, ribs and
 * readouts but behind its entrance's frame (blender/training_hall.py: SKIN), and under the lights on its ceiling.
 */
const HALL_SKIN_INSET = 0.1;
const HALL_SKIN_TOP = HALL.height - 0.04;
const HALL_SKIN_R = HALL.radius - HALL_SKIN_INSET;
const HALL_SKIN_X = ENTRANCE_X + HALL_SKIN_INSET;
/** How far round a hall's round wall its skin reaches, from straight ahead either way, to the entrance wall's skin. */
const HALL_SKIN_SPAN = Math.acos(HALL_SKIN_X / HALL_SKIN_R);

/** The skin: in front of the hall's round wall, its entrance wall either side of and over the doorway, and its ceiling, all facing in. */
function skinGeometry(): THREE.BufferGeometry {
  const top = HALL_SKIN_TOP;
  const halfW = HALL_SKIN_R * Math.sin(HALL_SKIN_SPAN);
  const side = halfW - DOOR_W / 2;
  // the round wall, round from straight ahead (+X) both ways to the entrance wall (three's cylinders start at +Z and
  // turn towards +X), facing in: a cylinder's open side faces out, so it's mirrored across the hall, which turns it
  // inside out and leaves it where it was
  const wall = new THREE.CylinderGeometry(HALL_SKIN_R, HALL_SKIN_R, top, 128, 1, true, Math.PI / 2 - HALL_SKIN_SPAN, HALL_SKIN_SPAN * 2).translate(0, top / 2, 0);
  wall.scale(1, 1, -1);
  const plane = (w: number, h: number) => new THREE.PlaneGeometry(w, h).rotateY(Math.PI / 2);
  const ceiling = new THREE.CircleGeometry(HALL.radius, 96).rotateX(Math.PI / 2).translate(0, top, 0);
  const geo = mergeGeometries([
    wall.toNonIndexed(),
    plane(side, top).translate(HALL_SKIN_X, top / 2, -(DOOR_W / 2 + side / 2)).toNonIndexed(),
    plane(side, top).translate(HALL_SKIN_X, top / 2, DOOR_W / 2 + side / 2).toNonIndexed(),
    plane(DOOR_W, top - DOOR_H).translate(HALL_SKIN_X, (DOOR_H + top) / 2, 0).toNonIndexed(),
    ceiling.toNonIndexed(),
  ]);
  geo.name = SKIN;
  return geo;
}

/** Makes a material draw only where the skin stamped `ref`. */
function masked<T extends THREE.Material>(mat: T, ref: number): T {
  mat.stencilWrite = true;
  mat.stencilRef = ref;
  mat.stencilFunc = THREE.EqualStencilFunc;
  mat.stencilFail = mat.stencilZFail = mat.stencilZPass = THREE.KeepStencilOp;
  // drawn only through its room's skin, so it can't fight with the office around it (see zfight.ts)
  mat.userData.landscape = true;
  return mat;
}

const plainVertex = /* glsl */ `
  varying vec3 vPos;
  varying vec3 vNormal;
  void main() {
    vPos = position;
    vNormal = normal;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

/** Anti-aliased grid lines, 1 on a line and 0 between them. */
const gridGlsl = /* glsl */ `
  float grid(vec2 p, float size) {
    vec2 q = p / size;
    vec2 g = abs(fract(q - 0.5) - 0.5) / max(fwidth(q), vec2(1e-4));
    return 1.0 - min(min(g.x, g.y), 1.0);
  }
  vec2 surfaceUv(vec3 p, vec3 n) {
    vec3 a = abs(n);
    return a.x > 0.5 ? p.zy : (a.z > 0.5 ? p.xy : p.xz);
  }`;

/**
 * A training hall's walls' grid: round its round wall, as many whole squares round it as come nearest to `size`, so
 * the grid meets itself behind the entrance; flat on the entrance wall and ceiling.
 */
const roundGridGlsl = /* glsl */ `
  uniform float round;
  uniform float entrance;
  vec2 wallUv(vec3 p, vec3 n, float size) {
    if (round <= 0.0 || abs(n.y) > 0.5 || p.x < entrance + 0.005) return surfaceUv(p, n);
    float squares = floor(6.2831853 * round / size + 0.5);
    return vec2(atan(p.z, -p.x) / 6.2831853 * squares * size, p.y);
  }`;

function portalMaterials(ref: number, tint: THREE.ColorRepresentation) {
  const stamp = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  stamp.stencilWrite = true;
  stamp.stencilRef = ref;
  stamp.stencilFunc = THREE.AlwaysStencilFunc;
  stamp.stencilZPass = THREE.ReplaceStencilOp;

  const clear = masked(
    new THREE.ShaderMaterial({
      vertexShader: plainVertex,
      fragmentShader: 'void main() { gl_FragDepth = 1.0; gl_FragColor = vec4(0.0); }',
      colorWrite: false,
      depthFunc: THREE.AlwaysDepth,
    }),
    ref,
  );

  const restore = masked(new THREE.MeshBasicMaterial({ colorWrite: false, depthFunc: THREE.AlwaysDepth, transparent: true }), ref);
  restore.depthWrite = true;

  const holo = masked(
    new THREE.ShaderMaterial({
      uniforms: {
        eye: { value: new THREE.Vector3() },
        time: { value: 0 },
        tint: { value: new THREE.Color(tint) },
        height: { value: HALL_SKIN_TOP },
        round: { value: HALL_SKIN_R },
        entrance: { value: HALL_SKIN_X },
      },
      vertexShader: plainVertex,
      fragmentShader: /* glsl */ `
        uniform vec3 eye;
        uniform float time;
        uniform vec3 tint;
        uniform float height;
        varying vec3 vPos;
        varying vec3 vNormal;
        ${gridGlsl}
        ${roundGridGlsl}
        void main() {
          float d = distance(vPos, eye);
          float wall = 1.0 - step(0.5, abs(vNormal.y));
          float near = 1.0 - smoothstep(0.7, 2.6, d);
          float lines = grid(wallUv(vPos, vNormal, 0.5), 0.5) * mix(0.05 * exp(-d * 0.08), 0.65, near * wall);
          float seam = wall * (1.0 - smoothstep(0.0, 0.05, vPos.y)) * 0.55;
          float sweep = wall * (1.0 - smoothstep(0.0, 0.035, abs(vPos.y / height - fract(time * 0.07)))) * 0.06;
          gl_FragColor = vec4(tint, clamp(lines + seam + sweep, 0.0, 0.8));
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    }),
    ref,
  );
  return { stamp, clear, restore, holo };
}

/** An empty holodeck's walls, ceiling and floor: dark, with the yellow grid. Opaque, no stencil needed. */
export function holodeckMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      base: { value: new THREE.Color('#1d2030') },
      line: { value: new THREE.Color('#ffc94d') },
      round: { value: HALL_SKIN_R },
      entrance: { value: HALL_SKIN_X },
    },
    vertexShader: plainVertex,
    fragmentShader: /* glsl */ `
      uniform vec3 base;
      uniform vec3 line;
      varying vec3 vPos;
      varying vec3 vNormal;
      ${gridGlsl}
      ${roundGridGlsl}
      void main() {
        float g = grid(wallUv(vPos, vNormal, 1.0), 1.0);
        gl_FragColor = vec4(mix(base, line, g * 0.85), 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

/** An empty holodeck's walls and ceiling: the skin, drawn opaque with the yellow grid, over the hall's own. */
export function holodeckSkin(): THREE.Mesh {
  const mesh = new THREE.Mesh(skinGeometry(), holodeckMaterial());
  mesh.raycast = noRaycast;
  return mesh;
}

/** Seeded random numbers, so a room's landscape is the same every time it's built. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

type Animate = (obj: THREE.Object3D, t: number) => void;

/**
 * Toolkit handed to a theme to build its landscape. Coordinates are the hall's: the middle of its floor is the origin,
 * +X runs from the entrance to the far wall, and the hall is a circle `reach` round (keep scenery out of it: `clear`).
 * Static things are merged into a few meshes per material when the landscape is finished, any that stand inside the
 * hall moved out beyond its wall first.
 */
export class Kit {
  readonly random: () => number;
  /** Direction towards the office's sun light, in room-local coordinates (so painted suns match the shading). */
  readonly sunDir: THREE.Vector3;
  private readonly mats = new Map<string, THREE.Material>();
  readonly statics: THREE.Object3D[] = [];
  readonly animated: { obj: THREE.Object3D; fn?: Animate; merge: boolean }[] = [];
  readonly owned = new Set<{ dispose(): void }>();
  /** How far the walls reach from the middle of the floor: what to keep moving things beyond. */
  readonly reach = HALL.radius;

  constructor(
    readonly ref: number,
    seed: number,
    sunDir: THREE.Vector3,
  ) {
    this.random = mulberry32(seed);
    this.sunDir = sunDir.clone().normalize();
  }

  /** Whether a ground point is clear of the walls, by `margin`. */
  clear(p: THREE.Vector3, margin = 1.2): boolean {
    return clearOfHall(p, margin);
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.random();
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.random() * items.length)];
  }

  /** A random spot on the ground between two distances from the room's centre, optionally within an arc (radians, 0 = +X). */
  around(minR: number, maxR: number, arc?: [number, number]): THREE.Vector3 {
    const a = arc ? this.range(arc[0], arc[1]) : this.range(0, Math.PI * 2);
    const r = Math.sqrt(this.range(minR * minR, maxR * maxR));
    return new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
  }

  private own<T extends { dispose(): void }>(thing: T): T {
    this.owned.add(thing);
    return thing;
  }

  /** Toon material, cached per colour (+ options). */
  toon(color: THREE.ColorRepresentation, opts: { map?: THREE.Texture; side?: THREE.Side } = {}): THREE.MeshToonMaterial {
    const key = `toon${String(color)}|${opts.map?.uuid ?? ''}|${opts.side ?? ''}`;
    let mat = this.mats.get(key) as THREE.MeshToonMaterial | undefined;
    if (!mat) {
      mat = this.own(masked(toonMaterial({ color, map: opts.map ?? null, side: opts.side ?? THREE.FrontSide }), this.ref));
      this.mats.set(key, mat);
    }
    return mat;
  }

  /** Unlit material (skies, ground, glowing things), cached per colour (+ options). Unlit things get no outline unless asked. */
  basic(
    color: THREE.ColorRepresentation,
    opts: { map?: THREE.Texture; side?: THREE.Side; opacity?: number; additive?: boolean; vertexColors?: boolean; underlay?: boolean; outline?: boolean } = {},
  ): THREE.MeshBasicMaterial {
    const key = `basic${String(color)}|${opts.map?.uuid ?? ''}|${opts.side ?? ''}|${opts.opacity ?? ''}|${opts.additive ?? ''}|${opts.vertexColors ?? ''}|${opts.underlay ?? ''}|${opts.outline ?? ''}`;
    let mat = this.mats.get(key) as THREE.MeshBasicMaterial | undefined;
    if (!mat) {
      mat = this.own(
        masked(
          new THREE.MeshBasicMaterial({
            color,
            map: opts.map ?? null,
            side: opts.side ?? THREE.FrontSide,
            transparent: opts.opacity !== undefined,
            opacity: opts.opacity ?? 1,
            blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
            depthWrite: opts.opacity === undefined,
            vertexColors: opts.vertexColors ?? false,
          }),
          this.ref,
        ),
      );
      mat.userData.hull = !!opts.outline;
      if (opts.underlay) {
        // pushed back in depth, so decals laid flat on it (paths, water, craters) win
        mat.polygonOffset = true;
        mat.polygonOffsetFactor = 2;
        mat.polygonOffsetUnits = 2;
      }
      this.mats.set(key, mat);
    }
    return mat;
  }

  /** Repeating texture owned by this landscape. */
  texture(tex: THREE.Texture, repeatX: number, repeatY: number): THREE.Texture {
    const t = this.own(tex.clone());
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeatX, repeatY);
    t.needsUpdate = true;
    return t;
  }

  mesh(geometry: THREE.BufferGeometry, material: THREE.Material | THREE.ColorRepresentation, at?: [number, number, number]): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material instanceof THREE.Material ? material : this.toon(material));
    if (at) mesh.position.set(...at);
    return mesh;
  }

  /** Box with its bottom at y. */
  box(w: number, h: number, d: number, color: THREE.Material | THREE.ColorRepresentation, x = 0, y = 0, z = 0): THREE.Mesh {
    return this.mesh(new THREE.BoxGeometry(w, h, d), color, [x, y + h / 2, z]);
  }

  /** Cylinder with its bottom at y. */
  cyl(rTop: number, rBottom: number, h: number, color: THREE.Material | THREE.ColorRepresentation, x = 0, y = 0, z = 0, segments = 12): THREE.Mesh {
    return this.mesh(new THREE.CylinderGeometry(rTop, rBottom, h, segments), color, [x, y + h / 2, z]);
  }

  /** Cone with its base at y. */
  cone(r: number, h: number, color: THREE.Material | THREE.ColorRepresentation, x = 0, y = 0, z = 0, segments = 12): THREE.Mesh {
    return this.mesh(new THREE.ConeGeometry(r, h, segments), color, [x, y + h / 2, z]);
  }

  ball(r: number, color: THREE.Material | THREE.ColorRepresentation, x = 0, y = 0, z = 0, segments = 12): THREE.Mesh {
    return this.mesh(new THREE.SphereGeometry(r, segments, Math.max(6, Math.round(segments * 0.7))), color, [x, y, z]);
  }

  /** Adds something that never moves; it gets merged with everything else of the same material. */
  add<T extends THREE.Object3D>(obj: T): T {
    this.statics.push(obj);
    return obj;
  }

  /**
   * Adds something that moves; `fn` runs every frame while the room is in view. With `merge`, its children are
   * merged per material (they move together, as one).
   */
  animate<T extends THREE.Object3D>(obj: T, fn: (obj: T, t: number) => void, merge = false): T {
    this.animated.push({ obj, fn: fn as Animate, merge });
    return obj;
  }

  /** Adds something that stays its own object instead of being merged (the sky dome, which must draw first; points). */
  keep<T extends THREE.Object3D>(obj: T): T {
    this.animated.push({ obj, merge: false });
    return obj;
  }

  /** Sky dome with a vertical gradient (through `mid`, if given, so complementary colours don't meet in grey). */
  sky(top: string, horizon: string, below: string = horizon, sharpness = 0.6, mid?: string): void {
    const midColor = mid ? new THREE.Color(mid) : new THREE.Color(horizon).lerp(new THREE.Color(top), 0.5);
    const mat = this.own(
      masked(
        new THREE.ShaderMaterial({
          uniforms: {
            top: { value: new THREE.Color(top) },
            mid: { value: midColor },
            horizon: { value: new THREE.Color(horizon) },
            below: { value: new THREE.Color(below) },
            sharpness: { value: sharpness },
          },
          vertexShader: /* glsl */ `
            varying vec3 vDir;
            void main() {
              vDir = normalize(position);
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }`,
          fragmentShader: /* glsl */ `
            uniform vec3 top;
            uniform vec3 mid;
            uniform vec3 horizon;
            uniform vec3 below;
            uniform float sharpness;
            varying vec3 vDir;
            void main() {
              float h = normalize(vDir).y;
              float k = pow(max(h, 0.0), sharpness) * 2.0;
              vec3 up = k < 1.0 ? mix(horizon, mid, k) : mix(mid, top, k - 1.0);
              vec3 c = h > 0.0 ? up : mix(horizon, below, smoothstep(0.0, 0.04, -h));
              gl_FragColor = vec4(c, 1.0);
              #include <colorspace_fragment>
            }`,
          side: THREE.BackSide,
          depthWrite: false,
        }),
        this.ref,
      ),
    );
    mat.userData.hull = false;
    // drawn first among the landscape, behind everything
    const dome = new THREE.Mesh(new THREE.SphereGeometry(190, 32, 16), mat);
    dome.renderOrder = -1;
    this.keep(dome);
  }

  /** Flat, unlit ground out to the horizon. */
  ground(color: string, texture?: THREE.Texture, tileMetres = 3): void {
    const map = texture ? this.texture(texture, 380 / tileMetres, 380 / tileMetres) : undefined;
    const mat = this.basic(color, { map, underlay: true });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(190, 48).rotateX(-Math.PI / 2), mat);
    disc.position.y = -0.02;
    this.add(disc);
  }

  /** A flat painted disc in the sky, facing the room. */
  disc(direction: THREE.Vector3, distance: number, radius: number, color: string, glow?: string): void {
    const at = direction.clone().normalize().multiplyScalar(distance);
    const face = (r: number, c: string, back: number) => {
      const m = new THREE.Mesh(new THREE.CircleGeometry(r, 40), this.basic(c));
      m.position.copy(at).multiplyScalar(1 + back);
      m.lookAt(0, 1.6, 0);
      this.add(m);
    };
    if (glow) face(radius * 1.7, glow, 0.01);
    face(radius, color, 0);
  }

  /** Cartoon clouds: clusters of squashed balls, drifting slowly round the room. */
  clouds(count: number, color = '#ffffff', shade = '#e3f1fb'): void {
    const layer = new THREE.Group();
    // unlit, so they stay white against the sky, but still outlined
    const [lit, dim] = [color, shade].map((c) => this.basic(c, { outline: true }));
    for (let i = 0; i < count; i++) {
      const c = new THREE.Group();
      const puffs = 3 + Math.floor(this.random() * 4);
      for (let p = 0; p < puffs; p++) {
        const r = this.range(3, 6.5);
        c.add(this.ball(r, p % 3 === 0 ? dim : lit, (p - puffs / 2) * 4.2, this.range(-0.5, 1.5), this.range(-2, 2)));
      }
      c.scale.set(1, 0.55, 1);
      const at = this.around(70, 150);
      c.position.set(at.x, this.range(28, 55), at.z);
      c.rotation.y = this.range(0, Math.PI);
      layer.add(c);
    }
    this.animate(layer, (o, t) => (o.rotation.y = t * 0.004), true);
  }

  /** Stars on the upper half of the sky. */
  stars(count: number, color = '#ffffff', size = 2): void {
    const pos: number[] = [];
    for (let i = 0; i < count; i++) {
      const a = this.range(0, Math.PI * 2);
      const y = Math.pow(this.random(), 0.7);
      const r = Math.sqrt(1 - y * y);
      pos.push(Math.cos(a) * r * 180, y * 180 + 4, Math.sin(a) * r * 180);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const mat = this.own(masked(new THREE.PointsMaterial({ color, size, sizeAttenuation: false }), this.ref));
    this.keep(new THREE.Points(geo, mat));
  }

  /** The hull material that outlines landscape meshes (outline.ts can't: it takes landscape pixels for sky). */
  hullMaterial(): THREE.ShaderMaterial {
    let mat = this.mats.get('hull') as THREE.ShaderMaterial | undefined;
    if (!mat) {
      mat = this.own(
        masked(
          new THREE.ShaderMaterial({
            uniforms: { color: { value: OUTLINE }, thickness: { value: 0.004 } },
            // pushed out along the normal and drawn inside out, as three's OutlineEffect does
            vertexShader: /* glsl */ `
              uniform float thickness;
              void main() {
                vec4 pos = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                vec4 pos2 = projectionMatrix * modelViewMatrix * vec4(position + normal, 1.0);
                gl_Position = pos + normalize(pos2 - pos) * thickness * pos.w;
              }`,
            fragmentShader: /* glsl */ `
              uniform vec3 color;
              void main() {
                gl_FragColor = vec4(color, 1.0);
                #include <colorspace_fragment>
              }`,
            side: THREE.BackSide,
          }),
          this.ref,
        ),
      );
      this.mats.set('hull', mat);
    }
    return mat;
  }
}

/** A theme's landscape around one room, plus the skin that shows it. */
export class Scenery {
  readonly group = new THREE.Group();
  /** Landscape on the hallway side of the room. Hidden while you're outside, where it could sit between you and the doorway. */
  private readonly behind = new THREE.Group();
  private readonly animated: { obj: THREE.Object3D; fn?: Animate }[];
  private readonly holo: THREE.ShaderMaterial;
  private readonly disposables = new Set<{ dispose(): void }>();

  constructor(kit: Kit, holoTint: THREE.ColorRepresentation) {
    const skin = skinGeometry();
    const mats = portalMaterials(kit.ref, holoTint);
    this.holo = mats.holo;
    for (const d of [skin, mats.stamp, mats.clear, mats.restore, mats.holo, ...kit.owned]) this.disposables.add(d);

    const skinMesh = (mat: THREE.Material, order: number) => {
      const m = new THREE.Mesh(skin, mat);
      m.renderOrder = order;
      return m;
    };
    this.group.add(skinMesh(mats.stamp, ORDER.stamp), skinMesh(mats.clear, ORDER.clear));
    const late = new THREE.Group(); // a Group's renderOrder orders everything in it
    late.renderOrder = ORDER.restore;
    late.add(skinMesh(mats.restore, 0), skinMesh(mats.holo, 1));
    this.group.add(late);

    const front = new THREE.Group();
    const glass = new THREE.Group();
    keepOut(kit.statics);
    this.bake(kit, front, glass);
    for (const [g, order] of [[front, ORDER.landscape], [this.behind, ORDER.landscape], [glass, ORDER.glass]] as const) {
      g.traverse((o) => (o.renderOrder = o.renderOrder === -1 ? -1 : order));
      g.renderOrder = order;
      this.group.add(g);
    }
    this.animated = kit.animated;
    this.group.traverse((o) => (o.raycast = noRaycast));
  }

  /** Merges static meshes per material (and side of the room), adds outline hulls, and files everything into groups. */
  private bake(kit: Kit, front: THREE.Group, glass: THREE.Group): void {
    const box = new THREE.Box3();
    const sideOf = (obj: THREE.Object3D) => {
      box.setFromObject(obj);
      return box.max.x < ENTRANCE_X - 0.2 && box.min.y < HALL.height ? 'behind' : 'front';
    };
    for (const { mat, geo, key } of this.merge(kit.statics, sideOf)) {
      const mesh = new THREE.Mesh(geo, mat);
      this.outline(kit, mesh);
      (mat.transparent ? glass : key === 'behind' ? this.behind : front).add(mesh);
    }
    for (const { obj, merge } of kit.animated) {
      if (merge) {
        const parts = [...obj.children];
        obj.clear();
        for (const { mat, geo } of this.merge(parts)) obj.add(new THREE.Mesh(geo, mat));
      }
      const meshes: THREE.Mesh[] = [];
      obj.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) this.disposables.add(mesh.geometry);
        if (mesh.isMesh) meshes.push(mesh);
      });
      for (const mesh of meshes) this.outline(kit, mesh);
      const transparent = meshes.some((m) => (m.material as THREE.Material).transparent);
      (transparent ? glass : front).add(obj);
    }
  }

  /** Merges every mesh under parentless `objects` into one geometry per material (and per `keyOf` group). */
  private merge(objects: THREE.Object3D[], keyOf: (obj: THREE.Object3D) => string = () => ''): { mat: THREE.Material; geo: THREE.BufferGeometry; key: string }[] {
    const buckets = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[]; key: string }>();
    for (const obj of objects) {
      obj.updateMatrixWorld(true);
      const key = keyOf(obj);
      obj.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mat = mesh.material as THREE.Material;
        const id = `${mat.uuid}|${key}`;
        let bucket = buckets.get(id);
        if (!bucket) buckets.set(id, (bucket = { mat, geos: [], key }));
        // (not geometry.clone(): that first builds a default-sized SphereGeometry etc. only to overwrite it)
        const geo = new THREE.BufferGeometry().copy(mesh.geometry).applyMatrix4(mesh.matrixWorld);
        geo.clearGroups();
        bucket.geos.push(geo);
        mesh.geometry.dispose();
      });
    }
    const out: { mat: THREE.Material; geo: THREE.BufferGeometry; key: string }[] = [];
    for (const { mat, geos, key } of buckets.values()) {
      const indexed = geos.every((g) => g.index);
      const names = Object.keys(geos[0].attributes).filter((n) => ['position', 'normal', 'uv', 'color'].includes(n) && geos.every((g) => g.attributes[n]));
      const parts = geos.map((g) => {
        const part = indexed || !g.index ? g : g.toNonIndexed();
        for (const n of Object.keys(part.attributes)) if (!names.includes(n)) part.deleteAttribute(n);
        return part;
      });
      const geo = mergeGeometries(parts);
      for (const g of new Set([...geos, ...parts])) g.dispose();
      if (!geo) continue;
      this.disposables.add(geo);
      out.push({ mat, geo, key });
    }
    return out;
  }

  private outline(kit: Kit, mesh: THREE.Mesh): void {
    const mat = mesh.material as THREE.Material;
    if (mat.userData.hull === false || mat.transparent || !mesh.geometry.attributes.normal) return;
    mesh.add(new THREE.Mesh(mesh.geometry, kit.hullMaterial()));
  }

  /** Call every frame with the camera in room-local coordinates. */
  update(t: number, eye: THREE.Vector3): void {
    const inside = insideHall(eye);
    // From further away than this, a doorway is too thin a slit to be worth drawing a landscape through.
    this.group.visible = inside || Math.hypot(eye.x, eye.z) < 34;
    if (!this.group.visible) return;
    this.behind.visible = inside;
    this.holo.uniforms.eye.value.copy(eye);
    this.holo.uniforms.time.value = t;
    for (const { obj, fn } of this.animated) fn?.(obj, t);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
