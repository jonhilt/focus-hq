import * as THREE from 'three';
import type { StudioTake } from '../../../shared/types';
import { interactive } from './builder';
import { contactSheet, runTake } from './contactSheet';
import { canvasTexture, fitFont, makeCanvas, UI_FONT, wrap } from './canvas';
import { OVERLAY_LAYER } from './frame';
import { flat } from './materials';
import { LCARS, LCARS_FONT } from './starship';
import { shownTakes, TAKE_PLOT, takeSpots } from './studio';
import { TakeKit } from './takeKit';

// The studio computer's takes, every one of them standing round the holodeck's floor in beat order (studio.ts: where):
// each its own floor, a plaque at its front edge with its id, beat, label and metaphor (E on it reads the beat in full), and its cast, made by its script with the kit
// (takeKit.ts) and set from t every frame, looping. A take staged again under the same id is torn down and built afresh.
// The room tells the office how each version ran, so the computer hears about a script that throws.

type Render = (t: number) => void;
/** How long a take holds its last frame before it loops (s). */
const HOLD = 1.2;
/** Whether a take was staged moments ago, so the computer's waiting to hear how it ran (not one the room's catching up on). */
const fresh = (take: StudioTake) => Date.now() - take.at < 20_000;
/**
 * A take's plaque: `w` metres wide (`px` on its canvas), at least `minPx` tall (`minH` metres), tipped back `tilt`
 * radians, its bottom edge `bottom` metres up.
 */
const PLAQUE = { w: 2.8, px: 1200, minPx: 300, minH: 0.7, tilt: 0.75, bottom: 0.45 - 0.35 * Math.cos(0.75) };
const HEAD_FONT = `600 76px ${LCARS_FONT}`;
const BODY_FONT = `500 44px ${UI_FONT}`;
/** How wide the plaque's lines run on its canvas, right of its id. */
const TEXT_W = 950;

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
    report: (error?: string, sheet?: string) => void,
  ) {
    this.kit = new TakeKit(this.cast);
    const { width, depth } = TAKE_PLOT;
    // its floor: a faint pad on the grid, and its edge
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(width, depth).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#1b2a55', transparent: true, opacity: 0.55, depthWrite: false }));
    this.floor.position.y = 0.012;
    const c = makeCanvas(PLAQUE.px, PLAQUE.minPx);
    this.signTexture = canvasTexture(c.canvas);
    // a plaque at its front edge, tipped back to read from where you stand, below the premise on the far wall: as tall
    // as what it says needs (drawSign)
    this.sign = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), flat(this.signTexture, { transparent: true }));
    this.sign.rotation.x = -PLAQUE.tilt;
    this.sign.layers.set(OVERLAY_LAYER);
    // E on it reads its beat in the script, without walking to the row of cards over the takes
    if (take.beat !== undefined) interactive(this.sign, { kind: 'studio', beat: take.beat }, () => `Read beat ${take.beat! + 1} in full`);
    this.group.add(this.floor, this.sign, this.cast);
    try {
      this.render = runTake(take, this.kit);
      this.render(0);
      // a take just staged sends its contact sheet with word that it runs, for the computer to look at
      report(undefined, fresh(take) ? contactSheet(take) : undefined);
    } catch (err) {
      this.fail(err, report);
    }
    this.drawSign(c, depth);
  }

  private fail(err: unknown, report: (error?: string) => void): void {
    this.failed = err instanceof Error ? err.message : String(err);
    this.render = null;
    report(this.failed);
  }

  /** Draws its plaque, every word of it: the canvas, and the plaque with it, grow taller from its bottom edge to fit. */
  private drawSign({ ctx, canvas }: ReturnType<typeof makeCanvas>, depth: number): void {
    const { take } = this;
    const beat = take.beat !== undefined ? `BEAT ${take.beat + 1} · ` : '';
    const head = `${beat}${take.label.toUpperCase()}${take.version > 1 ? `  · V${take.version}` : ''}`;
    const text = this.failed ? `It stopped: ${this.failed}` : (take.metaphor ?? take.detail ?? '');
    ctx.font = HEAD_FONT;
    const heads = wrap(ctx, head, TEXT_W, 3);
    ctx.font = BODY_FONT;
    const body = wrap(ctx, text, TEXT_W, 8);
    // baselines: the heading's lines from 104, 84 apart, then the body's from 74 under its last, 54 apart
    const top = 104 + (heads.length - 1) * 84 + 74;
    canvas.height = Math.max(PLAQUE.minPx, top + (body.length - 1) * 54 + 52);

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
    ctx.font = HEAD_FONT;
    heads.forEach((l, i) => ctx.fillText(l, 224, 104 + i * 84));
    ctx.fillStyle = this.failed ? '#ff9a9a' : '#9fb3c8';
    ctx.font = BODY_FONT;
    body.forEach((l, i) => ctx.fillText(l, 224, top + i * 54));
    this.signTexture.needsUpdate = true;

    // the plaque at the canvas's size, its bottom edge where a one-line plaque's is, so a longer one rises back over the take's floor
    const w = PLAQUE.w;
    const h = (w * canvas.height) / canvas.width;
    this.sign.geometry.dispose();
    this.sign.geometry = new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0);
    this.sign.position.set(0, PLAQUE.bottom, depth / 2 + 0.25 + (PLAQUE.minH / 2) * Math.sin(PLAQUE.tilt));
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

  constructor(private readonly report: (take: StudioTake, error?: string, sheet?: string) => void) {}

  show(takes: readonly StudioTake[]): void {
    const shown = shownTakes(takes);
    const spots = takeSpots(shown.length);
    const next = new Map<string, Plot>();
    shown.forEach((take, i) => {
      let plot = this.plots.get(take.id);
      if (!plot || plot.take.version !== take.version || plot.take.at !== take.at) {
        if (plot) this.drop(plot);
        plot = new Plot(take, (error, sheet) => this.report(take, error, sheet));
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
