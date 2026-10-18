import * as THREE from 'three';
import { canvasTexture, makeCanvas } from '../../world/canvas';
import { OVERLAY_LAYER } from '../../world/frame';
import { LCARS, LCARS_FONT } from '../../world/starship';

// The holodeck stage's props that aren't crew: labels in the scene, and the context gauge column.

/** The stage's green: answers coming back, and a context with room to spare. */
export const GREEN = '#99cc66';
const GLASS = '#8fd8ff';

/**
 * A label in the scene: a canvas on a sprite in the overlay, so it always faces the camera, `metres` high. It redraws
 * only when what it shows (`key`) changes.
 */
export class Tag {
  readonly sprite: THREE.Sprite;
  private readonly c: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D };
  private readonly texture: THREE.CanvasTexture;
  private key = '';
  private readonly size: THREE.Vector2;

  constructor(w: number, hgt: number, metres: number) {
    this.c = makeCanvas(w, hgt);
    this.texture = canvasTexture(this.c.canvas);
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture, depthWrite: false, transparent: true, opacity: 0 }));
    this.size = new THREE.Vector2((metres * w) / hgt, metres);
    this.sprite.scale.set(this.size.x, this.size.y, 1);
    this.sprite.layers.set(OVERLAY_LAYER);
    this.sprite.visible = false;
  }

  draw(key: string, paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): void {
    if (key === this.key) return;
    this.key = key;
    const { canvas, ctx } = this.c;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    paint(ctx, canvas.width, canvas.height);
    this.texture.needsUpdate = true;
  }

  set opacity(o: number) {
    this.sprite.material.opacity = o;
    this.sprite.visible = o > 0.01;
  }

  /** Swells a little and back, `k` of the way through a glow. */
  pulse(k: number): void {
    const s = 1 + 0.18 * Math.sin(Math.min(1, Math.max(0, k)) * Math.PI);
    this.sprite.scale.set(this.size.x * s, this.size.y * s, 1);
  }
}

export function pill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, hgt: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, w, hgt, hgt / 2);
  ctx.fill();
}

/** A context's colour by how full it is: green with room to spare, gold, then red. */
export const fillColour = (fill: number) => (fill > 0.7 ? LCARS.red : fill > 0.4 ? LCARS.gold : GREEN);

/** A pill-shaped chip of text, for a job or an answer in flight, or a pull request. */
export function drawChip(tag: Tag, text: string, colour: string, ink = '#000'): void {
  tag.draw(text + colour + ink, (ctx, w, hgt) => {
    ctx.font = `600 ${Math.round(hgt * 0.48)}px ${LCARS_FONT}`;
    const tw = Math.min(w - 8, ctx.measureText(text).width + hgt * 0.6);
    pill(ctx, (w - tw) / 2, 4, tw, hgt - 8, colour);
    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    ctx.fillText(text, w / 2, hgt / 2 + 2);
  });
}

/** Lines of text on a navy hologram panel, with an outline: a queue, a script, a counter. */
export function drawPanel(tag: Tag, title: string, lines: { text: string; colour?: string; on?: boolean }[]): void {
  tag.draw(JSON.stringify([title, lines]), (ctx, w, hgt) => {
    ctx.fillStyle = '#05081ae0';
    ctx.beginPath();
    ctx.roundRect(4, 4, w - 8, hgt - 8, 26);
    ctx.fill();
    ctx.strokeStyle = LCARS.sky;
    ctx.lineWidth = 5;
    ctx.stroke();
    const row = Math.min(70, (hgt - (title ? 110 : 40)) / Math.max(1, lines.length));
    let y = 30;
    if (title) {
      ctx.fillStyle = LCARS.gold;
      ctx.font = `600 52px ${LCARS_FONT}`;
      ctx.fillText(title, 36, y + 26);
      y += 80;
    }
    ctx.font = `500 ${Math.round(row * 0.62)}px ${LCARS_FONT}`;
    for (const line of lines) {
      if (line.on) pill(ctx, 20, y + 2, w - 40, row - 6, LCARS.orange);
      ctx.fillStyle = line.on ? '#000' : (line.colour ?? LCARS.peach);
      ctx.fillText(line.text, 40, y + row / 2);
      y += row;
    }
  });
}

/**
 * A crew member's context as a hologram column on the floor, `height` metres tall: a glass case, a fill that rises
 * green → gold → red, a big readout on top, and a ghost line where an earlier fill reached.
 */
export class Gauge {
  readonly group = new THREE.Group();
  private readonly fillMesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  private readonly ghostMesh: THREE.Mesh;
  private readonly readout = new Tag(400, 170, 0.55);
  private readonly ghostTag = new Tag(420, 90, 0.26);
  private readonly materials: THREE.MeshBasicMaterial[] = [];
  private fill = 0;
  private ghost: { level: number; label: string } | null = null;
  private shown = 0;

  constructor(private readonly height = 1.8) {
    const glass = new THREE.MeshBasicMaterial({ color: GLASS, transparent: true, opacity: 0.12, depthWrite: false });
    const fill = new THREE.MeshBasicMaterial({ color: GREEN, transparent: true, opacity: 0.85, depthWrite: false });
    const ghost = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7, depthWrite: false });
    const base = new THREE.MeshBasicMaterial({ color: GLASS, transparent: true, opacity: 0.6, depthWrite: false });
    this.materials.push(glass, fill, ghost, base);
    const caseMesh = new THREE.Mesh(new THREE.BoxGeometry(0.36, height, 0.36), glass);
    caseMesh.position.y = height / 2 + 0.06;
    this.fillMesh = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1, 0.3), fill);
    this.ghostMesh = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.025, 0.42), ghost);
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.06, 24), base);
    plinth.position.y = 0.03;
    this.readout.sprite.position.y = height + 0.32;
    this.ghostTag.sprite.position.set(0, 0, 0);
    this.group.add(caseMesh, this.fillMesh, this.ghostMesh, plinth, this.readout.sprite, this.ghostTag.sprite);
    this.group.visible = false;
    this.set(0);
  }

  /** How full it is, 0–1. */
  set(fill: number): void {
    this.fill = Math.max(0, Math.min(1, fill));
    const h = Math.max(0.01, this.fill * this.height);
    this.fillMesh.scale.y = h;
    this.fillMesh.position.y = 0.06 + h / 2;
    this.fillMesh.material.color.set(fillColour(this.fill));
    this.drawReadout();
  }

  get level(): number {
    return this.fill;
  }

  /** A line where an earlier fill reached, labelled; or none. */
  setGhost(level: number | null, label = ''): void {
    this.ghost = level === null ? null : { level, label };
    this.ghostMesh.visible = !!this.ghost;
    if (this.ghost) {
      this.ghostMesh.position.y = 0.06 + this.ghost.level * this.height;
      this.ghostTag.sprite.position.set(0, this.ghostMesh.position.y, 0.55);
      drawChip(this.ghostTag, this.ghost.label || `${Math.round(this.ghost.level * 100)}%`, '#ffffffd0');
    }
    this.ghostTag.opacity = this.ghost && this.shown ? this.shown : 0;
  }

  /** Fades the whole column in (1) or out (0). */
  setShown(o: number): void {
    this.shown = o;
    this.group.visible = o > 0.01;
    const base = [0.12, 0.85, 0.7, 0.6];
    this.materials.forEach((m, i) => (m.opacity = base[i] * o));
    this.readout.opacity = o;
    this.ghostTag.opacity = this.ghost ? o : 0;
  }

  pulse(k: number): void {
    this.readout.pulse(k);
  }

  private drawReadout(): void {
    const pct = Math.round(this.fill * 100);
    this.readout.draw(`${pct}`, (ctx, w, hgt) => {
      pill(ctx, 2, 2, w - 4, hgt - 4, '#000000d0');
      ctx.fillStyle = LCARS.peach;
      ctx.font = `600 40px ${LCARS_FONT}`;
      ctx.fillText('CONTEXT', 34, hgt / 2);
      ctx.textAlign = 'right';
      ctx.fillStyle = fillColour(this.fill);
      ctx.font = `700 96px ${LCARS_FONT}`;
      ctx.fillText(`${pct}%`, w - 34, hgt / 2 + 4);
    });
  }
}
