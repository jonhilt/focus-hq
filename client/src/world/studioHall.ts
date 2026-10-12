import * as THREE from 'three';
import type { Studio } from '../../../shared/types';
import { canvasTexture, makeCanvas, UI_FONT, wrap } from './canvas';
import { OVERLAY_LAYER } from './frame';
import { around, curvedPanel } from './hallLayout';
import { Hologram, hover } from './hologram';
import { QuestionLights } from './questionLights';
import { takeDraw } from './screenRedraw';
import { LCARS, LCARS_FONT } from './starship';
import { beatsFrom, GAP_SLOTS, gapLights, QUESTION_LIGHT, STUDIO_WALL } from './studio';

// What the studio holodeck shows of the video a goal is making (studio.ts): its premise on a hologram curved round the
// far wall, its beats in a row of cards round under it, and its open gaps as lights either side. Built once with the
// hall and hidden until a goal has a studio; each hologram is drawn again only when what it says changes.

const TEXT = '#e8fbff';
const DIM = '#8fa3b8';
const GOLD = LCARS.gold;

/** What the studio shows: the goal's title and its studio. */
export interface StudioView {
  title: string;
  studio: Studio;
}

/** A canvas on a hologram, drawn by `paint` when its key changes and there's a draw to spare this frame (screenRedraw.ts). */
class Holo {
  readonly texture: THREE.CanvasTexture;
  readonly hologram: Hologram;
  private readonly c: ReturnType<typeof makeCanvas>;
  private key = '';
  private pending: (() => void) | null = null;

  constructor(w: number, h: number, tint: string) {
    this.c = makeCanvas(w, h);
    this.texture = canvasTexture(this.c.canvas);
    this.hologram = new Hologram(this.texture, w / h);
    this.hologram.tint.set(tint);
  }

  show(key: string, paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): void {
    if (key === this.key) return;
    this.key = key;
    this.pending = () => {
      const { ctx, canvas } = this.c;
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      paint(ctx, canvas.width, canvas.height);
      this.texture.needsUpdate = true;
    };
  }

  update(dt: number): void {
    this.hologram.update(dt);
    if (this.pending && takeDraw()) {
      this.pending();
      this.pending = null;
    }
  }

  dispose(): void {
    this.texture.dispose();
    this.hologram.dispose();
  }
}

/** Lines of `text` in `font`, as many as fit `maxLines`, drawn from `y` down `lead` apart; returns where it ended. */
function lines(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, font: string, lead: number, maxLines: number, color: string): number {
  ctx.font = font;
  ctx.fillStyle = color;
  for (const line of wrap(ctx, text, w, maxLines)) {
    ctx.fillText(line, x, y);
    y += lead;
  }
  return y;
}

/** The studio's set in a hall (its `group` in the hall's frame): `show` a goal's studio (or none), `update` it every frame. */
export class StudioSet {
  readonly group = new THREE.Group();
  private readonly premise = new Holo(2000, 810, GOLD);
  private readonly premiseMesh: THREE.Mesh;
  private readonly premiseY: number;
  private cards: { holo: Holo; mesh: THREE.Mesh }[] = [];
  private readonly lights: QuestionLights;
  private lastT = 0;

  constructor() {
    const { r, half, bottom, top } = STUDIO_WALL;
    this.premiseMesh = new THREE.Mesh(curvedPanel(r, -half, half, 0, top - bottom, 40), this.premise.hologram.material);
    this.premiseY = bottom;
    this.premiseMesh.position.y = bottom;
    this.premiseMesh.layers.set(OVERLAY_LAYER);
    this.premiseMesh.userData.aim = (on: boolean) => (this.premise.hologram.aimed = on);
    this.lights = new QuestionLights(GAP_SLOTS.map(({ across, out, y }) => around(r - out, across / (r - out), y)));
    this.group.add(this.premiseMesh, this.lights.group);
    this.group.visible = false;
  }

  /** Shows a goal's studio, or hides the set while no goal has one. */
  show(view: StudioView | undefined): void {
    this.group.visible = !!view;
    if (!view) return this.lights.show([]);
    const { title, studio } = view;
    const open = studio.gaps.filter((g) => !g.closed).length;
    this.premise.show(JSON.stringify([title, studio.premise, studio.takeaway, open]), (ctx, W) => {
      const m = 90;
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = GOLD;
      ctx.beginPath();
      ctx.roundRect(m, m - 20, 300, 84, [42, 12, 12, 42]);
      ctx.fill();
      ctx.fillStyle = '#000000';
      ctx.textAlign = 'center';
      ctx.font = `600 64px ${LCARS_FONT}`;
      ctx.fillText('STUDIO', m + 150, m + 44);
      ctx.textAlign = 'left';
      ctx.font = `600 52px ${LCARS_FONT}`;
      ctx.fillStyle = DIM;
      const gaps = open ? `${open} OPEN GAP${open === 1 ? '' : 'S'}` : 'NO OPEN GAPS';
      const gapsW = ctx.measureText(gaps).width;
      ctx.fillText(wrap(ctx, title.toUpperCase(), W - m * 2 - 360 - gapsW - 60, 1)[0], m + 340, m + 40);
      ctx.fillStyle = open ? QUESTION_LIGHT : DIM;
      ctx.fillText(gaps, W - m - gapsW, m + 40);
      let y = lines(ctx, studio.premise, m, m + 200, W - m * 2, `600 92px ${UI_FONT}`, 112, 4, TEXT);
      if (studio.takeaway) {
        y += 30;
        ctx.font = `600 46px ${LCARS_FONT}`;
        ctx.fillStyle = GOLD;
        ctx.fillText('THE VIEWER COMES AWAY WITH', m, y);
        lines(ctx, studio.takeaway, m, y + 74, W - m * 2, `500 60px ${UI_FONT}`, 74, 2, TEXT);
      }
    });
    this.showBeats(studio);
    this.lights.show(gapLights(studio.gaps));
  }

  /** A card for each beat, in a row round the wall under the premise, numbered in order. */
  private showBeats(studio: Studio): void {
    const { card, gap, cardR, cardBottom, cardTop } = STUDIO_WALL;
    const n = studio.beats.length;
    while (this.cards.length > n) {
      const gone = this.cards.pop()!;
      this.group.remove(gone.mesh);
      gone.mesh.geometry.dispose();
      gone.holo.dispose();
    }
    const from = beatsFrom(n);
    studio.beats.forEach((beat, i) => {
      let c = this.cards[i];
      if (!c) {
        const holo = new Holo(680, Math.round((680 * (cardTop - cardBottom)) / card), LCARS.periwinkle);
        const mesh = new THREE.Mesh(undefined, holo.hologram.material);
        mesh.layers.set(OVERLAY_LAYER);
        mesh.userData.aim = (on: boolean) => (holo.hologram.aimed = on);
        this.group.add(mesh);
        c = this.cards[i] = { holo, mesh };
      }
      // laid out again each time, since the row's as wide as there are beats
      const a0 = from + (i * (card + gap)) / cardR;
      c.mesh.geometry.dispose();
      c.mesh.geometry = curvedPanel(cardR, a0, a0 + card / cardR, 0, cardTop - cardBottom, 8);
      c.mesh.position.y = cardBottom;
      c.holo.show(JSON.stringify([i, beat]), (ctx, W) => {
        const m = 44;
        ctx.textBaseline = 'alphabetic';
        ctx.font = `600 64px ${LCARS_FONT}`;
        ctx.fillStyle = LCARS.periwinkle;
        ctx.fillText(String(i + 1).padStart(2, '0'), m, m + 50);
        const y = lines(ctx, beat.title.toUpperCase(), m, m + 150, W - m * 2, `600 76px ${LCARS_FONT}`, 80, 2, TEXT);
        if (beat.point) lines(ctx, beat.point, m, y + 22, W - m * 2, `500 50px ${UI_FONT}`, 60, 4, '#b9cadb');
      });
    });
  }

  /** Moves it on to `t`, the gaps' tags readable from `eye` (world) as you near them. */
  update(t: number, eye: THREE.Vector3): void {
    if (!this.group.visible) return;
    const dt = Math.min(0.1, t - this.lastT);
    this.lastT = t;
    hover(this.premiseMesh, this.premiseY, t);
    this.premise.update(dt);
    this.cards.forEach((c, i) => {
      hover(c.mesh, STUDIO_WALL.cardBottom, t, i * 0.9);
      c.holo.update(dt);
    });
    this.lights.update(t, eye);
  }

  dispose(): void {
    this.premise.dispose();
    this.premiseMesh.geometry.dispose();
    for (const c of this.cards) {
      c.holo.dispose();
      c.mesh.geometry.dispose();
    }
    this.lights.dispose();
  }
}
