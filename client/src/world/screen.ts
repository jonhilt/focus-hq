import * as THREE from 'three';
import type { Agent, BrowserFrame, TermLine } from '../../../shared/types';
import { canvasTexture, fitText, makeCanvas, MONO_FONT, roundRect, UI_FONT } from './canvas';
import { flat } from './materials';

export const TERM_COLORS: Record<TermLine['kind'], string> = {
  system: '#8b949e',
  text: '#e6edf3',
  thinking: '#d2a8ff',
  tool: '#79c0ff',
  output: '#8b949e',
  error: '#ff7b72',
  success: '#7ee787',
  manager: '#ffd33d',
};

const STATUS_COLORS: Record<Agent['status'], string> = {
  queued: '#868e96',
  'setting-up': '#339af0',
  working: '#4c6ef5',
  testing: '#9775fa',
  waiting: '#fab005',
  pushing: '#20c997',
  done: '#40c057',
  error: '#fa5252',
  stopped: '#868e96',
};

/** Draws a terminal (and the agent's browser while it tests) onto a canvas used as the laptop screen. */
export class LaptopScreen {
  readonly material: THREE.MeshBasicMaterial;
  private readonly c = makeCanvas(800, 512);
  private readonly texture: THREE.CanvasTexture;
  private dirty = true;
  private lastDraw = 0;
  private image: HTMLImageElement | null = null;
  private imageSrc = '';

  constructor(private agent: Agent | null) {
    this.texture = canvasTexture(this.c.canvas);
    this.material = flat(this.texture);
  }

  setAgent(agent: Agent | null): void {
    this.agent = agent;
    this.dirty = true;
  }

  markDirty(): void {
    this.dirty = true;
  }

  /** Redraws when something changed, more often when the player is close. */
  maybeDraw(now: number, near: boolean, lines: TermLine[] | undefined, frame: BrowserFrame | undefined): void {
    if (!this.dirty || now - this.lastDraw < (near ? 120 : 1500)) return;
    this.dirty = false;
    this.lastDraw = now;
    this.draw(lines ?? [], frame);
    this.texture.needsUpdate = true;
    // keep the cursor blinking while the agent is busy
    if (this.agent && !['done', 'error', 'stopped'].includes(this.agent.status)) this.dirty = true;
  }

  private draw(lines: TermLine[], frame: BrowserFrame | undefined): void {
    const { canvas, ctx } = this.c;
    const W = canvas.width;
    const H = canvas.height;
    const agent = this.agent;
    if (!agent) {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#3a0ca3');
      g.addColorStop(1, '#4cc9f0');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.textAlign = 'center';
      ctx.font = `700 64px ${UI_FONT}`;
      ctx.fillText('Focus OS', W / 2, H / 2 - 10);
      ctx.font = `500 30px ${UI_FONT}`;
      ctx.fillText('This desk is free', W / 2, H / 2 + 44);
      return;
    }

    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, W, H);

    // title bar
    ctx.fillStyle = '#2b303b';
    ctx.fillRect(0, 0, W, 36);
    ['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(20 + i * 22, 18, 7, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = '#c9d1d9';
    ctx.font = `600 17px ${UI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(fitText(ctx, `${agent.name.toLowerCase()} — ${agent.repo}#${agent.issue.number} — claude`, W - 160), W / 2, 19);

    const footerH = 34;
    const browserActive = !!frame && (agent.status === 'testing' || Date.now() - frame.at < 45_000);
    const termW = browserActive ? Math.round(W * 0.5) : W;
    this.drawTerminal(lines, 0, 36, termW, H - 36 - footerH);
    if (browserActive && frame) this.drawBrowser(frame, termW, 36, W - termW, H - 36 - footerH);

    // status bar
    ctx.fillStyle = STATUS_COLORS[agent.status];
    ctx.fillRect(0, H - footerH, W, footerH);
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 18px ${UI_FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const right = agent.costUsd > 0 ? `$${agent.costUsd.toFixed(2)}` : '';
    ctx.fillText(fitText(ctx, `● ${agent.status.toUpperCase()}  ${agent.activity}`, W - 120), 12, H - footerH / 2);
    ctx.textAlign = 'right';
    ctx.fillText(right, W - 12, H - footerH / 2);
  }

  private drawTerminal(lines: TermLine[], x: number, y: number, w: number, h: number): void {
    const ctx = this.c.ctx;
    const lineH = 20;
    const pad = 10;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.font = `15px ${MONO_FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const maxRows = Math.floor((h - pad * 2) / lineH);
    const charW = ctx.measureText('M').width;
    const cols = Math.max(10, Math.floor((w - pad * 2) / charW));
    // wrap from the end until the screen is full
    const rows: { kind: TermLine['kind']; text: string }[] = [];
    for (let i = lines.length - 1; i >= 0 && rows.length < maxRows; i--) {
      const text = lines[i].text;
      const chunks: string[] = [];
      for (let j = 0; j < Math.max(1, text.length); j += cols) chunks.push(text.slice(j, j + cols));
      for (let k = chunks.length - 1; k >= 0 && rows.length < maxRows; k--) rows.unshift({ kind: lines[i].kind, text: chunks[k] });
    }
    rows.forEach((row, i) => {
      ctx.fillStyle = TERM_COLORS[row.kind];
      ctx.fillText(row.text, x + pad, y + pad + i * lineH);
    });
    // blinking cursor
    if (Math.floor(performance.now() / 500) % 2 === 0) {
      ctx.fillStyle = '#e6edf3';
      ctx.fillRect(x + pad, y + pad + Math.min(rows.length, maxRows - 1) * lineH + 2, charW, lineH - 4);
    }
    ctx.restore();
  }

  private drawBrowser(frame: BrowserFrame, x: number, y: number, w: number, h: number): void {
    const ctx = this.c.ctx;
    ctx.fillStyle = '#dee2e6';
    ctx.fillRect(x, y, w, h);
    // browser chrome
    ctx.fillStyle = '#f1f3f5';
    ctx.fillRect(x, y, w, 34);
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, x + 10, y + 6, w - 20, 22, 11);
    ctx.fill();
    ctx.fillStyle = '#495057';
    ctx.font = `14px ${MONO_FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(fitText(ctx, `🔒 ${frame.url}`, w - 44), x + 20, y + 17);
    const vy = y + 34;
    const vh = h - 34;
    if (frame.image) {
      if (this.imageSrc !== frame.image) {
        this.imageSrc = frame.image;
        const img = new Image();
        img.onload = () => {
          this.image = img;
          this.dirty = true;
        };
        img.src = frame.image;
      }
      if (this.image) {
        const scale = Math.min(w / this.image.width, vh / this.image.height);
        const iw = this.image.width * scale;
        const ih = this.image.height * scale;
        ctx.drawImage(this.image, x + (w - iw) / 2, vy, iw, ih);
      }
    } else if (frame.mock) {
      drawMockPage(ctx, frame.mock, x, vy, w, vh);
    }
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
  }
}

/** Demo mode: a pretend web page standing in for a screenshot. */
export function drawMockPage(
  ctx: CanvasRenderingContext2D,
  mock: NonNullable<BrowserFrame['mock']>,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = mock.accent;
  ctx.fillRect(x, y, w, 46);
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 20px ${UI_FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('◆ Demo App', x + 14, y + 23);
  ctx.fillStyle = '#212529';
  ctx.font = `700 19px ${UI_FONT}`;
  ctx.fillText(fitText(ctx, mock.heading, w - 28), x + 14, y + 72);
  const cardW = (w - 42) / 2;
  for (let i = 0; i < 4; i++) {
    const cx = x + 14 + (i % 2) * (cardW + 14);
    const cy = y + 96 + Math.floor(i / 2) * 110;
    ctx.fillStyle = '#f1f3f5';
    roundRect(ctx, cx, cy, cardW, 96, 10);
    ctx.fill();
    ctx.fillStyle = ['#ffd6a5', '#caffbf', '#9bf6ff', '#ffc6ff'][i];
    roundRect(ctx, cx + 8, cy + 8, cardW - 16, 50, 6);
    ctx.fill();
    ctx.fillStyle = mock.step >= 1 && i === 1 ? mock.accent : '#adb5bd';
    roundRect(ctx, cx + 8, cy + 66, cardW * 0.55, 20, 10);
    ctx.fill();
  }
  if (mock.step >= 2) {
    ctx.fillStyle = 'rgba(64,192,87,0.95)';
    roundRect(ctx, x + w - 190, y + h - 56, 176, 40, 10);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `600 16px ${UI_FONT}`;
    ctx.fillText('✓ Looks good!', x + w - 172, y + h - 36);
  }
  // mouse pointer
  const px = x + 14 + cardW + 14 + cardW * 0.3;
  const py = y + 96 + 66 + 12 + (mock.step === 0 ? 60 : 0);
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(px + 14, py + 14);
  ctx.lineTo(px + 6, py + 15);
  ctx.lineTo(px + 2, py + 22);
  ctx.closePath();
  ctx.fill();
}
