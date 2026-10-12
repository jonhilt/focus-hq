import * as THREE from 'three';
import type { StudioTake } from '../../../shared/types';
import { TAKE_PARAMS, takeBody, takeHelpers } from '../../../shared/takeScript';
import { canvasTexture, fitFont, makeCanvas, UI_FONT, wrap } from './canvas';
import { OVERLAY_LAYER } from './frame';
import { flat } from './materials';
import { LCARS, LCARS_FONT } from './starship';
import { shownTakes, TAKE_PLOT, takeSpots } from './studio';
import { TakeKit } from './takeKit';

// The studio computer's takes, every one of them standing round the holodeck's floor in beat order (studio.ts: where):
// each its own floor, a plaque at its front edge with its id, beat, label and metaphor, and its cast, made by its script with the kit
// (takeKit.ts) and set from t every frame, looping. A take staged again under the same id is torn down and built afresh.
// The room tells the office how each version ran, so the computer hears about a script that throws.

type Render = (t: number) => void;
/** How long a take holds its last frame before it loops (s). */
const HOLD = 1.2;

/** One take on its floor. */
class Plot {
  readonly group = new THREE.Group();
  private readonly cast = new THREE.Group();
  private readonly kit: TakeKit;
  private readonly floor: THREE.Mesh;
  private readonly sign: THREE.Mesh;
  private readonly signTexture: THREE.CanvasTexture;
  private render: Render | null = null;
  private failed: string | null = null;
  private readonly start = performance.now() / 1000;

  constructor(
    readonly take: StudioTake,
    report: (error?: string) => void,
  ) {
    this.kit = new TakeKit(this.cast);
    const { width, depth } = TAKE_PLOT;
    // its floor: a faint pad on the grid, and its edge
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(width, depth).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#1b2a55', transparent: true, opacity: 0.55, depthWrite: false }));
    this.floor.position.y = 0.012;
    const c = makeCanvas(1200, 300);
    this.signTexture = canvasTexture(c.canvas);
    // a plaque at its front edge, tipped back to read from where you stand, below the premise on the far wall
    this.sign = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 0.7), flat(this.signTexture, { transparent: true }));
    this.sign.position.set(0, 0.45, depth / 2 + 0.25);
    this.sign.rotation.x = -0.75;
    this.sign.layers.set(OVERLAY_LAYER);
    this.group.add(this.floor, this.sign, this.cast);
    try {
      // the computer's own script, run in the captain's browser like the explainers it shows on a station's screen
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const made = new Function(...TAKE_PARAMS, takeBody(take.script)) as (...args: unknown[]) => Render | undefined;
      const helpers: Record<string, unknown> = { kit: this.kit, THREE, ...takeHelpers(take.phases) };
      const render = made(...TAKE_PARAMS.map((name) => helpers[name]));
      if (!render) throw new Error('The script never defined render(t)');
      this.render = render;
      this.render(0);
      report();
    } catch (err) {
      this.fail(err, report);
    }
    this.drawSign(c);
  }

  private fail(err: unknown, report: (error?: string) => void): void {
    this.failed = err instanceof Error ? err.message : String(err);
    this.render = null;
    report(this.failed);
  }

  private drawSign({ ctx, canvas }: ReturnType<typeof makeCanvas>): void {
    const { take } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.beginPath();
    ctx.roundRect(0, 0, canvas.width, canvas.height, 40);
    ctx.fill();
    ctx.fillStyle = this.failed ? '#ff5c5c' : LCARS.gold;
    ctx.beginPath();
    ctx.roundRect(24, 24, 170, canvas.height - 48, [40, 10, 10, 40]);
    ctx.fill();
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitFont(ctx, take.id.toUpperCase(), 150, 120, 40, '600', LCARS_FONT);
    ctx.fillText(take.id.toUpperCase(), 109, canvas.height / 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#e8fbff';
    ctx.font = `600 76px ${LCARS_FONT}`;
    const beat = take.beat !== undefined ? `BEAT ${take.beat + 1} · ` : '';
    ctx.fillText(wrap(ctx, `${beat}${take.label.toUpperCase()}${take.version > 1 ? `  · V${take.version}` : ''}`, 960, 1)[0], 224, 110);
    ctx.fillStyle = this.failed ? '#ff9a9a' : '#9fb3c8';
    ctx.font = `500 44px ${UI_FONT}`;
    wrap(ctx, this.failed ? `It stopped: ${this.failed}` : (take.metaphor ?? take.detail ?? ''), 950, 2).forEach((l, i) => ctx.fillText(l, 224, 184 + i * 54));
    this.signTexture.needsUpdate = true;
  }

  /** Plays it on to now, looping; `eye` is how far you are from it, for the crew's bubbles. */
  update(t: number, eye: number, report: (error?: string) => void): void {
    if (!this.render) return;
    const loop = this.take.seconds + HOLD;
    const at = Math.min(this.take.seconds, (t - this.start) % loop);
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
    this.floor.geometry.dispose();
    (this.floor.material as THREE.Material).dispose();
    this.sign.geometry.dispose();
    (this.sign.material as THREE.Material).dispose();
    this.signTexture.dispose();
  }
}

/**
 * The takes on the studio's floor (its `group` in the hall's frame): `show` them as they change, `update` every frame.
 * `report` tells the office how a take's version ran: once, when it's built, and again if it later throws.
 */
export class TakeStage {
  readonly group = new THREE.Group();
  private plots = new Map<string, Plot>();
  private readonly at = new THREE.Vector3();

  constructor(private readonly report: (take: StudioTake, error?: string) => void) {}

  show(takes: readonly StudioTake[]): void {
    const shown = shownTakes(takes);
    const spots = takeSpots(shown.length);
    const next = new Map<string, Plot>();
    shown.forEach((take, i) => {
      let plot = this.plots.get(take.id);
      if (!plot || plot.take.version !== take.version || plot.take.at !== take.at) {
        if (plot) this.drop(plot);
        plot = new Plot(take, (error) => this.report(take, error));
        this.group.add(plot.group);
      }
      // round the room, its front (+z) towards the middle
      const { x, z, face, scale } = spots[i];
      plot.group.position.set(x, 0, z);
      plot.group.rotation.y = face;
      plot.group.scale.setScalar(scale);
      next.set(take.id, plot);
    });
    for (const [id, plot] of this.plots) if (next.get(id) !== plot) this.drop(plot);
    this.plots = next;
  }

  private drop(plot: Plot): void {
    this.group.remove(plot.group);
    plot.dispose();
  }

  update(t: number, eye: THREE.Vector3): void {
    for (const plot of this.plots.values()) plot.update(t, eye.distanceTo(plot.group.getWorldPosition(this.at)), (error) => this.report(plot.take, error));
  }

  dispose(): void {
    for (const plot of this.plots.values()) plot.dispose();
    this.plots.clear();
  }
}
