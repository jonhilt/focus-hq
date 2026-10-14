import * as THREE from 'three';
import type { StudioTake } from '../../../shared/types';
import { currentTake } from '../../../shared/takeScript';
import { contactSheet, runTake } from './contactSheet';
import { SCENE_STAGE, ScenePlayback } from './studio';
import { TakeKit } from './takeKit';

// The scene the studio computer built last, standing in the middle of the holodeck on a round stage (studio.ts): its
// cast, made by its script with the kit (takeKit.ts) and set from the scene's own clock every frame (ScenePlayback), so
// the captain can spin it, pause it and scrub through it. A ring round the stage's edge, and a light running round it,
// say how far through it is. The scene staged again under the same id (or another) is torn down and built afresh.
// The room tells the office how each version ran, so the computer hears about a script that throws.

type Render = (t: number) => void;
/** Whether a scene was staged moments ago, so the computer's waiting to hear how it ran (not one the room's catching up on). */
const fresh = (take: StudioTake) => Date.now() - take.at < 20_000;
const RING_COLOUR = '#99ccff';
const MARK_COLOUR = '#ffcc66';

/** One scene, built by its script. */
class Plot {
  readonly cast = new THREE.Group();
  private readonly kit: TakeKit;
  private render: Render | null = null;
  failed: string | null = null;

  constructor(
    readonly take: StudioTake,
    report: (error?: string, sheet?: string) => void,
  ) {
    this.kit = new TakeKit(this.cast);
    try {
      this.render = runTake(take, this.kit);
      this.render(0);
      // a scene just staged sends its contact sheet with word that it runs, for the computer to look at
      report(undefined, fresh(take) ? contactSheet(take) : undefined);
    } catch (err) {
      this.fail(err, report);
    }
  }

  private fail(err: unknown, report: (error?: string) => void): void {
    this.failed = err instanceof Error ? err.message : String(err);
    this.render = null;
    report(this.failed);
  }

  /** Draws it at `at` seconds in; `t` is the wall's time and `eye` how far you are from it, for the crew's bubbles. */
  update(at: number, t: number, eye: number, report: (error?: string) => void): void {
    if (!this.render) return;
    try {
      this.render(at);
    } catch (err) {
      this.fail(err, report);
      return;
    }
    this.kit.update(t, eye);
  }

  dispose(): void {
    this.kit.dispose();
  }
}

/**
 * The studio's stage (its `group` in the hall's frame, at the middle of the floor): `show` the scenes as they change, and
 * it plays the current one; `update` every frame. `report` tells the office how a scene's version ran: once, when it's
 * built, and again if it later throws. `playback` is the captain's to spin, pause, scrub and speed up.
 */
export class TakeStage {
  readonly group = new THREE.Group();
  readonly playback = new ScenePlayback();
  /** Turns with the spin: the scene's front (+z) faces the entrance (-X in the hall's frame) before it's spun. */
  private readonly turntable = new THREE.Group();
  private plot: Plot | null = null;
  private readonly floor: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly mark: THREE.Mesh;
  private readonly at = new THREE.Vector3();
  private lastT: number | null = null;

  constructor(private readonly report: (take: StudioTake, error?: string, sheet?: string) => void) {
    const { radius } = SCENE_STAGE;
    this.floor = new THREE.Mesh(new THREE.CircleGeometry(radius, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#1b2a55', transparent: true, opacity: 0.5, depthWrite: false }));
    this.floor.position.y = 0.012;
    this.ring = new THREE.Mesh(new THREE.RingGeometry(radius - 0.06, radius, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: RING_COLOUR, transparent: true, opacity: 0.6, depthWrite: false }));
    this.ring.position.y = 0.016;
    this.mark = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), new THREE.MeshBasicMaterial({ color: MARK_COLOUR }));
    this.turntable.rotation.y = -Math.PI / 2;
    this.group.add(this.floor, this.ring, this.mark, this.turntable);
    this.group.visible = false;
  }

  /** The scene in the hall, if there is one. */
  get current(): StudioTake | null {
    return this.plot?.take ?? null;
  }

  /** What went wrong with the scene in the hall, if it stopped. */
  get failed(): string | null {
    return this.plot?.failed ?? null;
  }

  show(takes: readonly StudioTake[]): void {
    const take = currentTake(takes) ?? null;
    const same = take && this.plot && this.plot.take.id === take.id && this.plot.take.version === take.version && this.plot.take.at === take.at;
    if (same) return;
    this.drop();
    this.group.visible = !!take;
    if (!take) return;
    this.plot = new Plot(take, (error, sheet) => this.report(take, error, sheet));
    this.turntable.add(this.plot.cast);
    this.playback.restart();
  }

  private drop(): void {
    if (!this.plot) return;
    this.turntable.remove(this.plot.cast);
    this.plot.dispose();
    this.plot = null;
  }

  update(t: number, eye: THREE.Vector3): void {
    const dt = this.lastT === null ? 0 : Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;
    const plot = this.plot;
    if (!plot) return;
    const { seconds } = plot.take;
    this.playback.advance(dt, seconds);
    this.turntable.rotation.y = -Math.PI / 2 + this.playback.spin;
    const at = this.playback.at(seconds);
    // the light round the ring: from in front of the entrance, clockwise as seen from above, once a run through
    const a = Math.PI + (at / seconds) * Math.PI * 2;
    this.mark.position.set(Math.cos(a) * SCENE_STAGE.radius, 0.12, -Math.sin(a) * SCENE_STAGE.radius);
    plot.update(at, t, eye.distanceTo(this.group.getWorldPosition(this.at)), (error) => this.report(plot.take, error));
  }

  dispose(): void {
    this.drop();
    for (const m of [this.floor, this.ring, this.mark]) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }
}
