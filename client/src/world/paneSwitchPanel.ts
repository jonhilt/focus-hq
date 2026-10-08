import * as THREE from 'three';
import { canvasTexture, makeCanvas } from './canvas';
import { flat } from './materials';
import { COL, GAP, H, LEFT, PAD, PANE_SWITCHES, W } from './paneSwitches';
import { type PanePrefs, screenPrefs } from './screenPanes';
import { LCARS, LCARS_FONT } from './starship';

/** The strip's canvas, redrawn whenever the viewer's choice changes (`update`). */
export class PaneSwitches {
  readonly material: THREE.MeshBasicMaterial;
  private readonly c = makeCanvas(W, H);
  private readonly texture: THREE.CanvasTexture;
  private version = -1;

  constructor() {
    this.texture = canvasTexture(this.c.canvas);
    this.material = flat(this.texture);
    this.update();
  }

  update(): void {
    if (this.version === screenPrefs.version) return;
    this.version = screenPrefs.version;
    this.draw(screenPrefs.current);
    this.texture.needsUpdate = true;
  }

  private draw(prefs: PanePrefs): void {
    const { ctx } = this.c;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, H);
    const h = H - PAD * 2;
    // the strip's LCARS label at its left: a block with a rounded end, and its name
    ctx.fillStyle = LCARS.periwinkle;
    ctx.beginPath();
    ctx.roundRect(PAD, PAD, LEFT - PAD - GAP, h, [h / 2, 8, 8, h / 2]);
    ctx.fill();
    ctx.fillStyle = '#000000';
    ctx.font = `600 64px ${LCARS_FONT}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.fillText('PANES', LEFT - GAP - 26, H / 2 + 2);

    PANE_SWITCHES.forEach((s, i) => {
      const x = LEFT + i * COL;
      const w = COL - GAP;
      const on = prefs[s.pane];
      // a pill: lit while on, a dim outline while off
      ctx.beginPath();
      ctx.roundRect(x, PAD, w, h, h / 2);
      if (on) {
        ctx.fillStyle = '#99cc66';
        ctx.fill();
      } else {
        ctx.strokeStyle = '#5a5470';
        ctx.lineWidth = 6;
        ctx.stroke();
      }
      ctx.fillStyle = on ? '#000000' : '#8d86a0';
      ctx.font = `600 66px ${LCARS_FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(s.label.toUpperCase(), x + w / 2, H / 2 + 2);
    });
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
  }
}
