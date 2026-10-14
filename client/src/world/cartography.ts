import * as THREE from 'three';
import { interactive } from './builder';
import { canvasTexture, makeCanvas } from './canvas';
import { type GoalStar, spiral } from './galaxy';
import { lighten } from './materials';

/** The sphere (blender/cartography_deck.py): its centre over the platform, at eye height, and its skin's radius. */
export const SPHERE = { centre: new THREE.Vector3(0, 1.6, 0), radius: 12 };
/** How close to the skin you can fly. */
const FLIGHT_MARGIN = 1.2;
/** How far off you can aim at a star and use it: across the sphere. */
const STAR_REACH = 2 * SPHERE.radius;
const SKY_STARS = 1800;

/**
 * Where the vestibule comes through the skin, behind the gantry, round the collar the deck hides the hole's edge with:
 * the grid and the sky leave it out, or they'd cross the vestibule's mouth.
 */
function inVestibule(p: THREE.Vector3): boolean {
  return Math.abs(p.x) < 3 && p.y > -3 && p.y < 2.6 && p.z > 9;
}

/**
 * What stellar cartography shows on the inside of its sphere: a faint grid and a sky of distant stars, and every goal
 * on the ship as a star on a spiral arm round you, oldest out at the end of it and newest dead ahead of the console
 * (galaxy.ts), each in its project's colour, a live goal's pulsing. Aim at one to read it and press E for its chart.
 */
export class StellarCartography {
  readonly group = new THREE.Group();
  private readonly goals = new THREE.Group();
  private key = '';
  private live: { halo: THREE.Sprite; size: number; phase: number }[] = [];
  private readonly halo = haloTexture();

  /** `centre` is the sphere's middle in the world. */
  constructor(readonly centre: THREE.Vector3) {
    this.group.position.copy(centre);
    this.group.add(sky(), grid(), this.goals);
  }

  /** Where you can fly: inside the sphere, short of its skin. */
  get flight(): { centre: THREE.Vector3; radius: number } {
    return { centre: this.centre.clone(), radius: SPHERE.radius - FLIGHT_MARGIN };
  }

  /** Whether `p` is inside the sphere. */
  holds(p: THREE.Vector3): boolean {
    return p.distanceTo(this.centre) < SPHERE.radius;
  }

  /** Lays the goals out again when they've changed: which there are, their names, and which are still going. */
  sync(stars: GoalStar[], projectName: (id: string) => string): void {
    const key = JSON.stringify(stars.map((s) => [s.id, s.title, s.color, s.slices, s.closedAt ?? 0]));
    if (key === this.key) return;
    this.key = key;
    for (const child of this.goals.children) child.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    this.goals.clear();
    this.live = [];
    const points = spiral(stars.length).map((p) => new THREE.Vector3(p.x, p.y, p.z));
    if (points.length > 1) this.goals.add(arm(points));
    stars.forEach((star, i) => this.goals.add(this.star(star, points[i], projectName(star.projectId))));
  }

  /** Pulses the live goals' stars. */
  update(t: number): void {
    for (const { halo, size, phase } of this.live) halo.scale.setScalar(size * (1 + 0.25 * Math.sin(t * 2.4 + phase)));
  }

  private star(star: GoalStar, at: THREE.Vector3, project: string): THREE.Object3D {
    const live = star.closedAt === undefined;
    const g = new THREE.Group();
    g.position.copy(at);
    const r = 0.12 + Math.min(star.slices, 8) * 0.018;
    const core = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), new THREE.MeshBasicMaterial({ color: lighten(star.color, live ? 0.45 : 0.15) }));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.halo, color: star.color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: live ? 1 : 0.55,
    }));
    const size = r * (live ? 6 : 4);
    halo.scale.setScalar(size);
    if (live) this.live.push({ halo, size, phase: at.x });
    // something bigger than the star to aim at, from across the sphere: drawn into neither the picture nor its depth
    const target = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    g.add(halo, core, target);
    const when = live ? `under way since ${day(star.openedAt)}` : `${day(star.openedAt)} to ${day(star.closedAt ?? star.openedAt)}`;
    const slices = `${star.slices} slice${star.slices === 1 ? '' : 's'}`;
    interactive(g, { kind: 'goal-star', projectId: star.projectId, id: star.id, live }, () => `${star.title} · ${project} · ${slices}, ${when}`, STAR_REACH);
    return g;
  }
}

function day(at: number): string {
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** The arm itself: a faint line through the goals in time order. */
function arm(points: THREE.Vector3[]): THREE.Line {
  const curve = new THREE.CatmullRomCurve3(points);
  const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(points.length * 8));
  return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: '#3a4f9a', transparent: true, opacity: 0.7 }));
}

/** Distant stars on the inside of the skin, the same every time. */
function sky(): THREE.Points {
  const positions = new Float32Array(SKY_STARS * 3);
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const r = SPHERE.radius - 0.15;
  for (let i = 0; i < SKY_STARS; i++) {
    // evenly over the sphere
    const y = 2 * random() - 1;
    const a = 2 * Math.PI * random();
    const s = Math.sqrt(1 - y * y);
    const at = new THREE.Vector3(r * s * Math.cos(a), r * y, r * s * Math.sin(a));
    positions.set(inVestibule(at) ? [0, -r, 0] : at.toArray(), i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return new THREE.Points(geometry, new THREE.PointsMaterial({ color: '#c8d4ff', size: 1.6, sizeAttenuation: false }));
}

/** Lines of latitude and longitude a little inside the skin, the equator (at eye height) brightest. */
function grid(): THREE.Group {
  const r = SPHERE.radius - 0.1;
  const g = new THREE.Group();
  // each ring as segments, bar those where the vestibule comes through
  const ring = (points: THREE.Vector3[], color: string, opacity: number) => {
    const segments = points.flatMap((p, i) => {
      const q = points[(i + 1) % points.length];
      return inVestibule(p) || inVestibule(q) ? [] : [p, q];
    });
    g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(segments), new THREE.LineBasicMaterial({ color, transparent: true, opacity })));
  };
  const segments = 96;
  for (let lat = -60; lat <= 60; lat += 30) {
    const y = r * Math.sin((lat * Math.PI) / 180);
    const c = r * Math.cos((lat * Math.PI) / 180);
    const points = Array.from({ length: segments }, (_, i) => new THREE.Vector3(c * Math.cos((2 * Math.PI * i) / segments), y, c * Math.sin((2 * Math.PI * i) / segments)));
    ring(points, lat === 0 ? '#ff9c3a' : '#24356e', lat === 0 ? 0.5 : 0.6);
  }
  for (let lon = 0; lon < 180; lon += 30) {
    const a = (lon * Math.PI) / 180;
    const points = Array.from({ length: segments }, (_, i) => {
      const b = (2 * Math.PI * i) / segments;
      return new THREE.Vector3(r * Math.cos(b) * Math.cos(a), r * Math.sin(b), r * Math.cos(b) * Math.sin(a));
    });
    ring(points, '#24356e', 0.6);
  }
  return g;
}

/** A soft round glow, white, for each star's halo to tint. */
function haloTexture(): THREE.Texture {
  const { canvas, ctx } = makeCanvas(64, 64);
  const glow = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  glow.addColorStop(0, 'rgba(255,255,255,1)');
  glow.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 64, 64);
  return canvasTexture(canvas);
}
