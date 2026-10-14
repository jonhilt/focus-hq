import * as THREE from 'three';
import type { StudioSession, StudioTake } from '../../../shared/types';
import { canvasTexture, makeCanvas, UI_FONT, wrap } from './canvas';
import { OVERLAY_LAYER } from './frame';
import { curvedPanel } from './hallLayout';
import { Hologram, hover } from './hologram';
import { takeDraw } from './screenRedraw';
import { LCARS, LCARS_FONT } from './starship';
import { STUDIO_WALL } from './studio';
import { TakeStage } from './takes';

// What the studio holodeck shows (studio.ts): the scene its computer built last, playing in the middle of the hall
// (takes.ts), and a hologram curved round the far wall saying what it is and how to play it (or, before there's one,
// how to start). The hologram is drawn again only when what it says changes.

const TEXT = '#e8fbff';
const DIM = '#8fa3b8';
const GOLD = LCARS.gold;
const RED = '#ff5c5c';
/** How to play the scene, along the hologram's foot. */
const KEYS = 'Q / R  SPIN    P  PAUSE    [ / ]  SCRUB    − / =  SPEED    ENTER  TALK';

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

/** The studio's set in a hall (its `group` in the hall's frame): `show` the studio's session, `update` it every frame. */
export class StudioSet {
  readonly group = new THREE.Group();
  private readonly sign = new Holo(2400, 620, GOLD);
  private readonly signMesh: THREE.Mesh;
  private readonly signY: number;
  private readonly stage: TakeStage;
  private lastT = 0;

  /** `report` tells the office how a scene ran. */
  constructor(report: (take: StudioTake, error?: string, sheet?: string) => void) {
    this.stage = new TakeStage(report);
    const { r, half, bottom, top } = STUDIO_WALL;
    this.signMesh = new THREE.Mesh(curvedPanel(r, -half, half, 0, top - bottom, 40), this.sign.hologram.material);
    this.signY = bottom;
    this.signMesh.position.y = bottom;
    this.signMesh.layers.set(OVERLAY_LAYER);
    this.signMesh.userData.aim = (on: boolean) => (this.sign.hologram.aimed = on);
    this.group.add(this.signMesh, this.stage.group);
    this.signMesh.userData.studio = true;
  }

  /** The far wall's hologram: pressing E on it talks to the computer. */
  get wall(): THREE.Mesh {
    return this.signMesh;
  }

  /** The captain's controls for the scene in the hall: spin, pause, scrub, speed. */
  get playback(): TakeStage['playback'] {
    return this.stage.playback;
  }

  /** The scene in the hall, if there is one. */
  get scene(): StudioTake | null {
    return this.stage.current;
  }

  /** Shows the studio's conversation as it stands: the scene it built last, in the middle of the hall. */
  show(session: StudioSession): void {
    this.stage.show(session.takes);
    this.drawSign();
  }

  /** The far wall's hologram: how to start, or the scene in the hall, how it's playing, and how to play it. */
  private drawSign(): void {
    const scene = this.stage.current;
    if (!scene) {
      return this.sign.show('welcome', (ctx, W) => {
        const m = 90;
        ctx.textBaseline = 'alphabetic';
        this.badge(ctx, m);
        lines(ctx, 'Describe something to see.', m, m + 210, W - m * 2, `600 96px ${UI_FONT}`, 110, 1, TEXT);
        lines(ctx, 'Press Enter, or E here, and say what you want to see: the computer builds it in the middle of the room, moving, for you to walk round, spin and scrub through.', m, m + 330, W - m * 2, `500 54px ${UI_FONT}`, 68, 3, DIM);
      });
    }
    const failed = this.stage.failed;
    const { paused, speed } = this.stage.playback;
    const state = failed ? 'STOPPED' : `${paused ? 'PAUSED' : 'PLAYING'}${speed !== 1 ? `  ×${speed}` : ''}`;
    this.sign.show(JSON.stringify([scene.id, scene.version, scene.label, scene.metaphor, failed, state]), (ctx, W, H) => {
      const m = 90;
      ctx.textBaseline = 'alphabetic';
      this.badge(ctx, m);
      ctx.font = `600 52px ${LCARS_FONT}`;
      ctx.fillStyle = failed ? RED : paused ? GOLD : DIM;
      ctx.fillText(state, W - m - ctx.measureText(state).width, m + 40);
      const y = lines(ctx, scene.label, m, m + 190, W - m * 2, `600 84px ${UI_FONT}`, 96, 1, TEXT);
      const text = failed ? `It stopped: ${failed}` : (scene.metaphor ?? scene.detail ?? '');
      lines(ctx, text, m, y + 10, W - m * 2, `500 52px ${UI_FONT}`, 64, 3, failed ? '#ff9a9a' : DIM);
      ctx.font = `600 40px ${LCARS_FONT}`;
      ctx.fillStyle = GOLD;
      ctx.fillText(KEYS, m, H - 50);
    });
  }

  /** The STUDIO capsule at the hologram's top left. */
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

  /** Moves it on to `t`, as seen from `eye` (world). */
  update(t: number, eye: THREE.Vector3): void {
    const dt = Math.min(0.1, t - this.lastT);
    this.lastT = t;
    hover(this.signMesh, this.signY, t);
    this.stage.update(t, eye);
    // a pause, a speed or a fault changes what the sign says
    this.drawSign();
    this.sign.update(dt);
  }

  dispose(): void {
    this.sign.dispose();
    this.signMesh.geometry.dispose();
    this.stage.dispose();
  }
}
