import * as THREE from 'three';
import { canvasTexture, makeCanvas } from './canvas';
import { flat } from './materials';
import { H, HEADER, PAD, PANE_SWITCHES, ROW, switchOn, TOP, W } from './paneSwitches';
import { type PanePrefs, screenPrefs } from './screenPanes';
import { LCARS, LCARS_FONT } from './starship';

/** The panel's canvas, redrawn whenever the viewer's choice changes (`update`). */
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
    // the LCARS elbow along the top: a bar with a rounded end, and the panel's name
    ctx.fillStyle = LCARS.periwinkle;
    ctx.beginPath();
    ctx.roundRect(PAD, PAD, W - PAD * 2, HEADER - PAD - 10, [50, 12, 12, 0]);
    ctx.fill();
    ctx.fillStyle = '#000000';
    ctx.font = `600 64px ${LCARS_FONT}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.fillText('SCREEN PANES', W - PAD - 30, (PAD + HEADER - 10) / 2 + 2);

    PANE_SWITCHES.forEach((s, i) => {
      const y = TOP + i * ROW;
      const h = ROW - 20;
      const on = switchOn(s, prefs);
      const tone = s.pane === 'terminal' ? '#99cc66' : LCARS.sky;
      // a pill: lit in its tone while on, a dim outline while off
      ctx.beginPath();
      ctx.roundRect(PAD, y, W - PAD * 2, h, h / 2);
      if (on) {
        ctx.fillStyle = tone;
        ctx.fill();
      } else {
        ctx.strokeStyle = '#5a5470';
        ctx.lineWidth = 6;
        ctx.stroke();
      }
      ctx.fillStyle = on ? '#000000' : '#8d86a0';
      ctx.font = `600 62px ${LCARS_FONT}`;
      ctx.textAlign = 'left';
      ctx.fillText(s.label.toUpperCase(), PAD + 50, y + h / 2 + 2);
      ctx.font = `500 46px ${LCARS_FONT}`;
      ctx.textAlign = 'right';
      ctx.fillText((s.pane === 'terminal' ? 'Always on' : on ? 'On' : 'Off').toUpperCase(), W - PAD - 50, y + h / 2 + 2);
    });
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
  }
}
