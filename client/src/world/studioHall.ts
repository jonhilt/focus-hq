import * as THREE from 'three';
import type { StudioSession, StudioTake, StudioVideo } from '../../../shared/types';
import { interactive } from './builder';
import { canvasTexture, makeCanvas, UI_FONT, wrap } from './canvas';
import { OVERLAY_LAYER } from './frame';
import { curvedPanel } from './hallLayout';
import { Hologram, hover } from './hologram';
import { QuestionLights } from './questionLights';
import { takeDraw } from './screenRedraw';
import { LCARS, LCARS_FONT } from './starship';
import { beatsFrom, QUESTION_LIGHT, STUDIO_WALL, THREAD_SLOTS, threadLights } from './studio';
import { TakeStage } from './takes';

// What the studio holodeck shows of the video its computer and the captain are building (studio.ts): its premise on a
// hologram curved round the far wall (or, before there is one, how to start), its beats in a row of cards round under
// it, its open threads as lights in a row across the hall, and the computer's takes playing on the floor (takes.ts). Each hologram
// is drawn again only when what it says changes.

const TEXT = '#e8fbff';
const DIM = '#8fa3b8';
const GOLD = LCARS.gold;
/** How far off (m) you can open a beat's card with E: from anywhere on the floor, since the takes stand between you and the row. */
const CARD_REACH = 18;

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
  private readonly premise = new Holo(2400, 620, GOLD);
  private readonly premiseMesh: THREE.Mesh;
  private readonly premiseY: number;
  private cards: { holo: Holo; mesh: THREE.Mesh }[] = [];
  private readonly lights: QuestionLights;
  private readonly takes: TakeStage;
  private lastT = 0;

  /** `report` tells the office how a take ran in the room. */
  constructor(report: (take: StudioTake, error?: string) => void) {
    this.takes = new TakeStage(report);
    const { r, half, bottom, top } = STUDIO_WALL;
    this.premiseMesh = new THREE.Mesh(curvedPanel(r, -half, half, 0, top - bottom, 40), this.premise.hologram.material);
    this.premiseY = bottom;
    this.premiseMesh.position.y = bottom;
    this.premiseMesh.layers.set(OVERLAY_LAYER);
    this.premiseMesh.userData.aim = (on: boolean) => (this.premise.hologram.aimed = on);
    this.lights = new QuestionLights(THREAD_SLOTS.map(({ x, y, z }) => new THREE.Vector3(x, y, z)));
    this.group.add(this.premiseMesh, this.lights.group, this.takes.group);
    this.premiseMesh.userData.studio = true;
  }

  /** The premise's hologram: pressing E on it talks to the computer. */
  get wall(): THREE.Mesh {
    return this.premiseMesh;
  }

  /** Shows the studio's conversation as it stands: the video so far, and the takes on the floor. */
  show(session: StudioSession): void {
    this.takes.show(session.takes);
    const video = session.video;
    if (!video) {
      this.showBeats([]);
      this.lights.show([]);
      return this.premise.show('welcome', (ctx, W) => {
        const m = 90;
        ctx.textBaseline = 'alphabetic';
        this.badge(ctx, m);
        lines(ctx, 'Describe a video to the computer.', m, m + 210, W - m * 2, `600 96px ${UI_FONT}`, 110, 1, TEXT);
        lines(ctx, 'Press Enter, or E here, and say what it’s about: the premise goes up here, the beats under it, and it tries ways of showing each of them round the floor.', m, m + 330, W - m * 2, `500 54px ${UI_FONT}`, 68, 3, DIM);
      });
    }
    const studio = video;
    const open = video.threads.filter((g) => !g.closed).length;
    this.premise.show(JSON.stringify([studio.premise, studio.takeaway, open]), (ctx, W) => {
      const m = 90;
      ctx.textBaseline = 'alphabetic';
      this.badge(ctx, m);
      ctx.font = `600 52px ${LCARS_FONT}`;
      const threads = open ? `${open} OPEN THREAD${open === 1 ? '' : 'S'}` : 'NO OPEN THREADS';
      ctx.fillStyle = open ? QUESTION_LIGHT : DIM;
      ctx.fillText(threads, W - m - ctx.measureText(threads).width, m + 40);
      let y = lines(ctx, studio.premise, m, m + 180, W - m * 2, `600 76px ${UI_FONT}`, 92, 3, TEXT);
      if (studio.takeaway) {
        y += 20;
        ctx.font = `600 42px ${LCARS_FONT}`;
        ctx.fillStyle = GOLD;
        ctx.fillText('THE VIEWER COMES AWAY WITH', m, y);
        lines(ctx, studio.takeaway, m, y + 64, W - m * 2, `500 54px ${UI_FONT}`, 64, 1, TEXT);
      }
    });
    this.showBeats(video.beats);
    this.lights.show(threadLights(video.threads));
  }

  /** The STUDIO capsule at the premise's top left. */
  private badge(ctx: CanvasRenderingContext2D, m: number): void {
    ctx.fillStyle = GOLD;
    ctx.beginPath();
    ctx.roundRect(m, m - 20, 300, 84, [42, 12, 12, 42]);
    ctx.fill();
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    ctx.font = `600 64px ${LCARS_FONT}`;
    ctx.fillText('STUDIO', m + 150, m + 44);
    ctx.textAlign = 'left';
  }

  /** A card for each beat, in a row round the wall under the premise, numbered in order. */
  private showBeats(beats: StudioVideo['beats']): void {
    const { card, gap, cardR, cardBottom, cardTop } = STUDIO_WALL;
    const n = beats.length;
    while (this.cards.length > n) {
      const gone = this.cards.pop()!;
      this.group.remove(gone.mesh);
      gone.mesh.geometry.dispose();
      gone.holo.dispose();
    }
    const from = beatsFrom(n);
    beats.forEach((beat, i) => {
      let c = this.cards[i];
      if (!c) {
        const holo = new Holo(680, Math.round((680 * (cardTop - cardBottom)) / card), LCARS.periwinkle);
        const mesh = new THREE.Mesh(undefined, holo.hologram.material);
        mesh.layers.set(OVERLAY_LAYER);
        mesh.userData.aim = (on: boolean) => (holo.hologram.aimed = on);
        interactive(mesh, { kind: 'studio', beat: i }, () => `Read beat ${i + 1} in full`, CARD_REACH);
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
        if (beat.point) lines(ctx, beat.point, m, y + 22, W - m * 2, `500 46px ${UI_FONT}`, 56, 2, '#b9cadb');
      });
    });
  }

  /** Moves it on to `t`, the threads' tags readable from `eye` (world) as you near them. */
  update(t: number, eye: THREE.Vector3): void {
    const dt = Math.min(0.1, t - this.lastT);
    this.lastT = t;
    hover(this.premiseMesh, this.premiseY, t);
    this.premise.update(dt);
    this.cards.forEach((c, i) => {
      hover(c.mesh, STUDIO_WALL.cardBottom, t, i * 0.9);
      c.holo.update(dt);
    });
    this.lights.update(t, eye);
    this.takes.update(t, eye);
  }

  dispose(): void {
    this.premise.dispose();
    this.premiseMesh.geometry.dispose();
    for (const c of this.cards) {
      c.holo.dispose();
      c.mesh.geometry.dispose();
    }
    this.lights.dispose();
    this.takes.dispose();
  }
}
