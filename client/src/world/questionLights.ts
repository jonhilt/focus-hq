import * as THREE from 'three';
import { canvasTexture, makeCanvas, UI_FONT, wrap } from './canvas';
import { OVERLAY_LAYER } from './frame';
import { type Lit, placeLights, QUESTION_LIGHT, type Settled } from './studio';
import { LCARS_FONT } from './starship';

// Open questions hanging in the air as warm lights (the studio's gaps, studio.ts), each bobbing and breathing on its own.
// Its words are on a tag over it that comes up as you walk over, so from across the hall you see how many are open, and
// up close what they ask. When one's settled it says how: answered, it turns green and rises away; dropped, it dims
// and sinks. Everything is on OVERLAY_LAYER, as the holograms are.

/** How long a light takes to shimmer in (s), and to rise or sink away once its question's settled. */
const FADE = 0.8;
const SETTLE = 2.6;
/** How a settled light goes: its colour, and how far it drifts (m) as it fades. */
const SETTLES: Record<Settled, { color: string; drift: number }> = { up: { color: '#99ee77', drift: 1.2 }, down: { color: '#6a6488', drift: -0.7 } };
/** How near (m) you have to be to read a tag: it's clear from `near`, and gone from `far`. */
const READ = { near: 5.5, far: 8 };
/** The orb's glow and its bright heart (m across), and the tag's width. */
const ORB = 0.8;
const CORE = 0.22;
const TAG = 1.5;

/** A soft round glow, white at its heart, tinted by the sprite's colour. Made once, kept. */
let glowMap: THREE.Texture | null = null;
function glowTexture(): THREE.Texture {
  if (glowMap) return glowMap;
  const { canvas, ctx } = makeCanvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return (glowMap = canvasTexture(canvas));
}

/** The light's heart, shared by them all. Made once, kept. */
let core: THREE.SphereGeometry | null = null;
function coreGeometry(): THREE.SphereGeometry {
  return (core ??= new THREE.SphereGeometry(CORE / 2, 16, 12));
}

/** One question's light: its glow, and the tag with its words. */
class Light {
  readonly group = new THREE.Group();
  private readonly orb: THREE.Sprite;
  /** Its heart, solid, so it reads against a bright sky as well as the hall's walls. */
  private readonly core: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly tag: THREE.Sprite;
  private readonly tagTexture: THREE.CanvasTexture;
  private readonly color = new THREE.Color(QUESTION_LIGHT);
  /** 0 gone, 1 there: rises as it shimmers in. */
  private presence = 0;
  /** How it was settled and how far through going it is (0 → 1), once it has been. */
  private settled: { way: Settled; p: number } | null = null;
  private readonly phase = Math.random() * Math.PI * 2;

  constructor(
    question: Lit,
    readonly slot: number,
    readonly home: THREE.Vector3,
  ) {
    this.orb = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: this.color, depthWrite: false, transparent: true, toneMapped: false }));
    this.orb.scale.setScalar(ORB);
    this.orb.layers.set(OVERLAY_LAYER);
    this.orb.renderOrder = 10;
    this.core = new THREE.Mesh(coreGeometry(), new THREE.MeshBasicMaterial({ color: '#fff4d6', depthWrite: false, transparent: true, toneMapped: false }));
    this.core.layers.set(OVERLAY_LAYER);
    this.core.renderOrder = 11;
    const { canvas, ctx } = makeCanvas(768, 230);
    this.tagTexture = canvasTexture(canvas);
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tagTexture, depthWrite: false, transparent: true, toneMapped: false }));
    this.tag.scale.set(TAG, (TAG * 230) / 768, 1);
    this.tag.position.y = 0.5;
    this.tag.layers.set(OVERLAY_LAYER);
    this.tag.renderOrder = 10;
    // an LCARS readout: a cap in the light's colour, what it is, and its question under it
    ctx.fillStyle = QUESTION_LIGHT;
    ctx.beginPath();
    ctx.roundRect(4, 4, 34, 222, [17, 0, 0, 17]);
    ctx.fill();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.beginPath();
    ctx.roundRect(44, 4, 720, 222, [0, 22, 22, 0]);
    ctx.fill();
    ctx.textBaseline = 'top';
    ctx.fillStyle = QUESTION_LIGHT;
    ctx.font = `600 34px ${LCARS_FONT}`;
    ctx.fillText(question.label.toUpperCase(), 64, 18);
    ctx.fillStyle = '#f4ecdc';
    ctx.font = `500 36px ${UI_FONT}`;
    wrap(ctx, question.text, 680, 3).forEach((line, i) => ctx.fillText(line, 64, 64 + i * 46));
    this.tagTexture.needsUpdate = true;
    this.group.add(this.orb, this.core, this.tag);
    this.group.position.copy(home);
  }

  settle(way: Settled): void {
    this.settled ??= { way, p: 0 };
  }

  /** Moves it on to `t` (`dt` since the last frame), `eye` metres from you; false once it's gone. */
  update(t: number, dt: number, eye: number): boolean {
    const p = t + this.phase;
    this.presence = Math.min(1, this.presence + dt / FADE);
    let fade = this.presence < 1 ? this.presence * (0.6 + 0.4 * Math.sin(t * 40 + this.phase)) : 1;
    let drift = 0;
    this.color.set(QUESTION_LIGHT);
    if (this.settled) {
      const s = (this.settled.p = Math.min(1, this.settled.p + dt / SETTLE));
      if (s >= 1) return false;
      const look = SETTLES[this.settled.way];
      this.color.lerp(new THREE.Color(look.color), Math.min(1, s * 3));
      drift = look.drift * s * s;
      fade *= 1 - s * s;
    }
    this.group.position.set(this.home.x, this.home.y + drift + Math.sin(p * 0.9) * 0.05, this.home.z);
    // breathing a little while it waits for an answer
    const breathe = this.settled ? 1 : 0.85 + 0.15 * Math.sin(p * 2.2);
    this.orb.material.color.copy(this.color).multiplyScalar(breathe);
    this.orb.material.opacity = fade;
    this.orb.scale.setScalar(ORB * (0.6 + 0.4 * this.presence) * (0.9 + 0.1 * breathe));
    this.core.material.color.set('#fff4d6').lerp(this.color, this.settled ? 0.7 : 0.25);
    this.core.material.opacity = fade;
    this.tag.material.opacity = fade * THREE.MathUtils.clamp((READ.far - eye) / (READ.far - READ.near), 0, 1);
    this.tag.visible = this.tag.material.opacity > 0.01;
    return true;
  }

  dispose(): void {
    this.orb.material.dispose();
    this.core.material.dispose();
    this.tag.material.dispose();
    this.tagTexture.dispose();
  }
}

/**
 * A set of question lights, each at one of `spots` (in its `group`'s frame): `show` the questions as they change, and
 * `update` it every frame (it does nothing while there are none).
 */
export class QuestionLights {
  readonly group = new THREE.Group();
  private readonly lights = new Map<string, Light>();
  /** Which spot each lit question has (studio.ts: placeLights). */
  private slots = new Map<string, number>();
  private lastT = 0;
  private readonly at = new THREE.Vector3();

  constructor(private readonly spots: readonly THREE.Vector3[]) {}

  /** The questions now: a light for each new open one, and the settled ones going. */
  show(questions: readonly Lit[]): void {
    const leaving = new Set([...this.lights].filter(([id]) => !this.slots.has(id)).map(([, light]) => light.slot));
    const { slots, settled } = placeLights(questions, this.slots, this.spots.length, leaving);
    for (const { id, way } of settled) this.lights.get(id)?.settle(way);
    for (const [id, slot] of slots) {
      if (this.slots.has(id)) continue;
      // one reopened while it was still going goes at once
      const old = this.lights.get(id);
      if (old) this.drop(id, old);
      const light = new Light(questions.find((q) => q.id === id)!, slot, this.spots[slot]);
      this.lights.set(id, light);
      this.group.add(light.group);
    }
    this.slots = slots;
  }

  /** Moves them on to `t`, their tags readable from `eye` (world) as you near them. */
  update(t: number, eye: THREE.Vector3): void {
    const dt = Math.min(0.1, t - this.lastT);
    this.lastT = t;
    if (!this.lights.size) return;
    for (const [id, light] of this.lights) {
      const dist = eye.distanceTo(light.group.getWorldPosition(this.at));
      if (!light.update(t, dt, dist)) this.drop(id, light);
    }
  }

  private drop(id: string, light: Light): void {
    this.group.remove(light.group);
    light.dispose();
    if (this.lights.get(id) === light) this.lights.delete(id);
  }

  dispose(): void {
    for (const light of this.lights.values()) light.dispose();
    this.lights.clear();
  }
}
