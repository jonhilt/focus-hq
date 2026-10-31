import * as THREE from 'three';
import type { BackgroundTask } from '../../../shared/types';
import { type Interaction, interactive } from './builder';
import { canvasTexture, makeCanvas, MONO_FONT } from './canvas';
import { OVERLAY_LAYER } from './frame';
import { Hologram } from './hologram';
import { probeCaption, probeSlots } from './probeSlots';
import { LCARS_FONT, LCARS_STATUS } from './starship';

// What a goal's lead has left running in the background floats beside their chair as little holographic probes, in
// the holograms' navy glass and glowing outline (hologram.ts): a command is a slowly turning terminal cube with '>_' on
// its faces, a monitor a small dish sweeping to and fro. Each glows in how its task stands (cyan and breathing while it
// runs, green done, red failed, grey stopped), with a label under it like a crew member's speech bubble; they shimmer
// in when a task starts and fade out when it's gone. Everything is on OVERLAY_LAYER, as the holograms are.

/** How a task's probe glows: cyan while it runs, then how it ended. */
const TONE: Record<BackgroundTask['status'], string> = { running: '#5fe3ff', done: LCARS_STATUS.done, failed: '#ff5a5a', stopped: '#8d8d99' };

/** How long a probe takes to shimmer in, or fade out (s). */
const FADE = 0.6;

/**
 * Where each probe floats (the seat's frame, where its occupant faces +X): round the chair at `radius` on the side
 * away from the captain (`side` ±Z), from beside their shoulder to behind them, alternately higher and lower so the
 * labels don't sit on each other. The '+N' takes the next place.
 */
const ARC = { radius: 1.05, from: 35, to: 125, low: 1.4, high: 1.7 };

function slotAt(i: number, side: number, out: THREE.Vector3): THREE.Vector3 {
  const a = THREE.MathUtils.degToRad(ARC.from + ((ARC.to - ARC.from) * i) / 3);
  return out.set(ARC.radius * Math.cos(a), i % 2 ? ARC.high : ARC.low, side * ARC.radius * Math.sin(a));
}

/** '>_' on a terminal's face, white so the hologram's own glass and outline show round it. Made once, kept. */
let terminalFace: THREE.Texture | null = null;
function terminalTexture(): THREE.Texture {
  if (terminalFace) return terminalFace;
  const { canvas, ctx } = makeCanvas(128, 128);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#e8fbff';
  ctx.font = `700 64px ${MONO_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('>_', 64, 68);
  return (terminalFace = canvasTexture(canvas));
}

/** A label floating under a probe, drawn on a canvas only when what it says changes. */
class Label {
  readonly sprite: THREE.Sprite;
  private readonly canvas = makeCanvas(512, 120);
  private readonly texture: THREE.CanvasTexture;
  private key = '';

  constructor(width: number) {
    this.texture = canvasTexture(this.canvas.canvas);
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture, depthWrite: false, transparent: true }));
    this.sprite.scale.set(width, (width * 120) / 512, 1);
    this.sprite.renderOrder = 10;
    this.sprite.layers.set(OVERLAY_LAYER);
  }

  /** An LCARS readout: a cap in `tone`, the `top` line (in mono, a command) and `bottom` under it. */
  draw(top: string, bottom: string, tone: string): void {
    const key = `${top}|${bottom}|${tone}`;
    if (key === this.key) return;
    this.key = key;
    const { canvas, ctx } = this.canvas;
    const { width: w, height: h } = canvas;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = tone;
    ctx.beginPath();
    ctx.roundRect(4, 4, 30, h - 8, [(h - 8) / 2, 0, 0, (h - 8) / 2]);
    ctx.fill();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.beginPath();
    ctx.roundRect(40, 4, w - 44, h - 8, [0, 20, 20, 0]);
    ctx.fill();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#e8fbff';
    ctx.font = `500 34px ${MONO_FONT}`;
    ctx.fillText(top, 56, 40, w - 70);
    ctx.fillStyle = tone;
    ctx.font = `600 32px ${LCARS_FONT}`;
    ctx.fillText(bottom.toUpperCase(), 56, 88, w - 70);
    this.texture.needsUpdate = true;
  }

  set opacity(o: number) {
    this.sprite.material.opacity = o;
  }

  dispose(): void {
    this.texture.dispose();
    this.sprite.material.dispose();
  }
}

/** One task's probe: its body (a cube or a dish), the light that tints it, and its label. */
class Probe {
  readonly group = new THREE.Group();
  /** What turns (the cube) or sweeps (the dish), and shrinks as it fades. */
  private readonly body = new THREE.Group();
  private readonly label = new Label(0.7);
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  /** The cube's glass and outline, or the dish's glass and the glow of its rim, feed and tip, in its tone. */
  private readonly look: { hologram: Hologram } | { glass: THREE.MeshBasicMaterial; glow: THREE.MeshBasicMaterial };
  private readonly tone = new THREE.Color();
  /** 0 gone, 1 there: rises as it shimmers in, falls once its task has gone. */
  private presence = 0;
  leaving = false;
  task: BackgroundTask;
  private readonly phase = Math.random() * Math.PI * 2;

  constructor(task: BackgroundTask, use: Interaction, label: () => string) {
    this.task = task;
    this.group.add(this.body);
    if (task.kind === 'shell') {
      const hologram = new Hologram(terminalTexture(), 1);
      this.look = { hologram };
      this.materials.push(hologram.material);
      const cube = this.mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), hologram.material);
      cube.rotation.x = 0.35;
      this.body.add(cube);
    } else {
      const glass = new THREE.MeshBasicMaterial({ color: '#0a2348', transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
      const glow = new THREE.MeshBasicMaterial({ color: TONE.running, transparent: true, depthWrite: false, toneMapped: false });
      this.look = { glass, glow };
      this.materials.push(glass, glow);
      // a shallow bowl opening along +X, its rim and a feed arm out to a glowing tip at its focus
      const cap = 0.75;
      const r = 0.15;
      const dish = this.mesh(new THREE.SphereGeometry(r, 20, 6, 0, Math.PI * 2, Math.PI - cap, cap), glass);
      dish.rotation.z = -Math.PI / 2;
      dish.position.x = r * Math.cos(cap);
      const rim = this.mesh(new THREE.TorusGeometry(r * Math.sin(cap), 0.007, 6, 28), glow);
      rim.rotation.y = Math.PI / 2;
      const arm = this.mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.11, 6), glow);
      arm.rotation.z = Math.PI / 2;
      arm.position.x = 0.03;
      const tip = this.mesh(new THREE.SphereGeometry(0.018, 10, 8), glow);
      tip.position.x = 0.09;
      this.body.add(dish, rim, arm, tip);
    }
    this.label.sprite.position.y = -0.24;
    this.group.add(this.label.sprite);
    this.group.scale.setScalar(0.001);
    interactive(this.group, use, label);
    this.show(task);
  }

  private mesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
    this.geometries.push(geometry);
    const m = new THREE.Mesh(geometry, material);
    m.layers.set(OVERLAY_LAYER);
    m.renderOrder = 9;
    return m;
  }

  show(task: BackgroundTask): void {
    this.task = task;
    const { command, status } = probeCaption(task);
    this.label.draw(command, status, TONE[task.status]);
  }

  /** Moves it on to `t` (`dt` since the last frame), gliding towards `at`; false once it's faded out. */
  update(t: number, dt: number, at: THREE.Vector3): boolean {
    this.presence = THREE.MathUtils.clamp(this.presence + (this.leaving ? -dt : dt) / FADE, 0, 1);
    if (this.leaving && this.presence === 0) return false;
    const running = this.task.status === 'running';
    const p = t + this.phase;
    this.group.position.lerp(at, Math.min(1, dt * 4));
    this.group.position.y = at.y + Math.sin(p * 1.1) * 0.03;
    this.group.scale.setScalar(0.5 + 0.5 * this.presence);
    // a shimmer while it comes and goes, then steady
    const shimmer = this.presence < 1 ? 0.6 + 0.4 * Math.sin(t * 45 + this.phase) : 1;
    const opacity = this.presence * shimmer;
    const breathe = running ? 0.7 + 0.3 * Math.sin(p * 3) : 1;
    this.tone.set(TONE[this.task.status]).multiplyScalar(breathe);
    if ('hologram' in this.look) {
      const { hologram } = this.look;
      if (running) this.body.rotation.y += dt * 0.6;
      hologram.tint.copy(this.tone);
      hologram.material.opacity = opacity;
    } else {
      const { glow, glass } = this.look;
      // sweeping to and fro while it watches; at rest, looking out, once it's ended
      this.body.rotation.y = running ? Math.sin(p * 0.8) * 0.8 : this.body.rotation.y * (1 - Math.min(1, dt * 2));
      this.body.rotation.z = 0.25;
      glow.color.copy(this.tone);
      glow.opacity = opacity;
      glass.opacity = 0.8 * opacity;
    }
    this.label.opacity = opacity;
    return true;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.label.dispose();
  }
}

/**
 * The probes by one lead's chair: put its `group` in their seat, `show` the lead's background tasks as they change, and
 * `update` it every frame (it does nothing while there are none).
 */
export class BackgroundProbes {
  readonly group = new THREE.Group();
  private readonly probes = new Map<string, Probe>();
  private readonly more = new Label(0.36);
  private moreShown = false;
  /** Which side of the chair they float on (±Z in the seat's frame): away from the captain. */
  private side = 1;
  private lastT = 0;
  private readonly at = new THREE.Vector3();

  constructor(
    private readonly use: (taskId: string) => Interaction,
    private readonly label: (task: BackgroundTask) => string,
  ) {
    this.more.sprite.visible = false;
    this.group.add(this.more.sprite);
  }

  /** Floats them on the side of the chair away from `captain` (where the captain stands, world). */
  awayFrom(captain: THREE.Vector3): void {
    this.group.updateWorldMatrix(true, false);
    this.side = this.group.worldToLocal(captain.clone()).z > 0 ? -1 : 1;
  }

  /** The lead's background tasks now: a probe for each that's new, and the ones that have gone fading out. */
  show(tasks: readonly BackgroundTask[]): void {
    const { shown, more } = probeSlots(tasks);
    const ids = new Set(shown.map((t) => t.id));
    for (const [id, probe] of this.probes) if (!ids.has(id)) probe.leaving = true;
    shown.forEach((task, i) => {
      let probe = this.probes.get(task.id);
      if (!probe || probe.leaving) {
        probe?.dispose();
        if (probe) this.group.remove(probe.group);
        const made: Probe = new Probe(task, this.use(task.id), () => this.label(made.task));
        probe = made;
        probe.group.position.copy(slotAt(i, this.side, this.at));
        this.probes.set(task.id, probe);
        this.group.add(probe.group);
      }
      probe.show(task);
      probe.group.userData.slot = i;
    });
    this.moreShown = more > 0;
    this.more.sprite.visible = this.moreShown;
    if (this.moreShown) {
      this.more.draw(`+${more}`, 'more', TONE.running);
      this.more.sprite.position.copy(slotAt(4, this.side, this.at));
    }
  }

  update(t: number): void {
    const dt = Math.min(0.1, t - this.lastT);
    this.lastT = t;
    if (!this.probes.size) return;
    for (const [id, probe] of this.probes) {
      const slot = (probe.group.userData.slot as number | undefined) ?? 0;
      if (probe.update(t, dt, slotAt(slot, this.side, this.at))) continue;
      this.group.remove(probe.group);
      probe.dispose();
      this.probes.delete(id);
    }
  }

  dispose(): void {
    for (const probe of this.probes.values()) probe.dispose();
    this.probes.clear();
    this.more.dispose();
  }
}
