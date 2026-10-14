import * as THREE from 'three';
import type { StudioTake } from '../../../shared/types';
import { canvasTexture, makeCanvas, UI_FONT, wrap } from './canvas';
import { sceneThumbnail } from './contactSheet';
import { OVERLAY_LAYER } from './frame';
import { Hologram } from './hologram';
import { LCARS, LCARS_FONT } from './starship';
import { SHELF, shelfMove, shelfSpots } from './studio';

// The studio's shelf (docs/studio.md): every scene the computer's kept, as a hologram card with a picture of it, hung in
// an arc at eye height round where you stood when you opened it. Swipe to bring another card in front, and pick it to
// call that scene back to the middle of the hall. It stays where you opened it, in the hall's frame, until it's closed.

const CARD = { w: 1.3, px: 640, py: 470 };
const THUMB = { w: 600, h: 340 };

/** One card: a scene's picture, its label and id, and whether it's the one in the hall. */
class Card {
  readonly mesh: THREE.Mesh;
  readonly hologram: Hologram;
  private readonly texture: THREE.CanvasTexture;

  constructor(readonly take: StudioTake, inHall: boolean) {
    const { canvas, ctx } = makeCanvas(CARD.px, CARD.py);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, CARD.px, CARD.py);
    const thumb = sceneThumbnail(take, THUMB.w, THUMB.h);
    const x = (CARD.px - THUMB.w) / 2;
    if (thumb) ctx.drawImage(thumb, x, 20);
    else {
      ctx.fillStyle = '#1b2a55';
      ctx.fillRect(x, 20, THUMB.w, THUMB.h);
    }
    ctx.textBaseline = 'alphabetic';
    ctx.font = `600 40px ${UI_FONT}`;
    ctx.fillStyle = '#e8fbff';
    ctx.fillText(wrap(ctx, take.label, THUMB.w - 10, 1)[0] ?? '', x, 20 + THUMB.h + 54);
    ctx.font = `600 30px ${LCARS_FONT}`;
    ctx.fillStyle = inHall ? LCARS.gold : '#8fa3b8';
    const tag = inHall ? `${take.id.toUpperCase()} · IN THE HALL` : take.id.toUpperCase();
    ctx.fillText(tag, x, 20 + THUMB.h + 96);
    this.texture = canvasTexture(canvas);
    this.hologram = new Hologram(this.texture, CARD.px / CARD.py);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(CARD.w, (CARD.w * CARD.py) / CARD.px), this.hologram.material);
    this.mesh.layers.set(OVERLAY_LAYER);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.hologram.dispose();
    this.texture.dispose();
  }
}

/** The shelf (its `group` in the hall's frame): `open` it round where you stand, `move` the pick, `picked` to call it back. */
export class SceneShelf {
  readonly group = new THREE.Group();
  private cards: Card[] = [];
  private pick = 0;
  /** The pick, eased, so the arc slides round rather than jumping. */
  private at = 0;
  private readonly eye = new THREE.Vector3();
  private yaw = 0;
  private readonly spot = new THREE.Vector3();

  get isOpen(): boolean {
    return this.cards.length > 0;
  }

  /** Hangs every kept scene round `eye` (the hall's frame), facing `yaw` (radians round Y, 0 along +Z), the one in the hall picked. */
  open(takes: readonly StudioTake[], inHall: StudioTake | null, eye: THREE.Vector3, yaw: number): void {
    this.close();
    if (!takes.length) return;
    this.cards = takes.map((t) => new Card(t, t.id === inHall?.id));
    for (const c of this.cards) this.group.add(c.mesh);
    this.pick = this.at = Math.max(0, takes.findIndex((t) => t.id === inHall?.id));
    this.eye.copy(eye);
    this.yaw = yaw;
    this.place();
  }

  close(): void {
    for (const c of this.cards) {
      this.group.remove(c.mesh);
      c.dispose();
    }
    this.cards = [];
  }

  /** Swipes the pick `by` cards (+ to the right). */
  move(by: number): void {
    this.pick = shelfMove(this.pick, by, this.cards.length);
  }

  /** The scene whose card is in front. */
  get picked(): StudioTake | null {
    return this.cards[this.pick]?.take ?? null;
  }

  update(dt: number): void {
    if (!this.isOpen) return;
    this.at += (this.pick - this.at) * Math.min(1, dt * 10);
    this.place();
    this.cards.forEach((c, i) => {
      c.hologram.aimed = i === this.pick;
      c.hologram.tint.set(i === this.pick ? LCARS.gold : '#99ccff');
      c.hologram.update(dt);
    });
  }

  /** Each card on the arc round your eyes, a little below them, turned to face you. */
  private place(): void {
    const spots = shelfSpots(this.cards.length, this.at);
    this.cards.forEach((c, i) => {
      const { angle, scale, opacity } = spots[i];
      const a = this.yaw + angle;
      c.mesh.position.set(this.eye.x + Math.sin(a) * SHELF.distance, this.eye.y - SHELF.drop, this.eye.z + Math.cos(a) * SHELF.distance);
      c.mesh.lookAt(this.spot.set(this.eye.x, this.eye.y - SHELF.drop, this.eye.z));
      c.mesh.scale.setScalar(scale);
      c.mesh.visible = opacity > 0.01;
      c.hologram.material.opacity = opacity;
    });
  }

  dispose(): void {
    this.close();
  }
}
