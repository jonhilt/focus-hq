import * as THREE from 'three';
import type { Agent, BrowserFrame, ClaudeTask, GoalNote, TermLine } from '../../../shared/types';
import { showsBrowser } from '../../../shared/browserView';
import { canvasTexture, fitText, makeCanvas, MONO_FONT, roundRect, UI_FONT } from './canvas';
import { flat } from './materials';
import { screenPanes, screenPrefs } from './screenPanes';
import { LCARS, LCARS_FONT, LCARS_STATUS, lcarsFrame } from './starship';

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

/** A station display's canvas: its pixels, and how many of them make one unit of the 800 × 512 layout's type and rails. */
export interface ScreenSize {
  w: number;
  h: number;
  scale: number;
}

/** A desk's laptop: room for two panes side by side. */
export const LAPTOP: ScreenSize = { w: 800, h: 512, scale: 1 };
/** A team's big display: sharper, and wide enough for the terminal, the browser and the progress pane at once. */
export const BIG_SCREEN: ScreenSize = { w: 1600, h: 1024, scale: 1.25 };

/**
 * Draws an agent's work onto a canvas used as a station's display, in panes side by side (`screenPanes`): their
 * terminal, their browser when they have a page up, and their progress (the task list Claude keeps for itself, and a
 * lead's goal note) when there's any. Each viewer can switch the browser and progress panes off (`screenPrefs`).
 */
export class StationScreen {
  readonly material: THREE.MeshBasicMaterial;
  private readonly c: ReturnType<typeof makeCanvas>;
  private prefsVersion = screenPrefs.version;
  private readonly texture: THREE.CanvasTexture;
  private dirty = true;
  private lastDraw = 0;
  private image: HTMLImageElement | null = null;
  private imageSrc = '';

  /** `idle` is what the screen says while nobody's using it. */
  constructor(
    private agent: Agent | null,
    private idle = 'This station is free',
    private readonly size: ScreenSize = LAPTOP,
  ) {
    this.c = makeCanvas(size.w, size.h);
    this.texture = canvasTexture(this.c.canvas);
    this.material = flat(this.texture);
  }

  setAgent(agent: Agent | null): void {
    this.agent = agent;
    this.dirty = true;
  }

  /** What the screen says while nobody's using it. */
  setIdle(text: string): void {
    if (text === this.idle) return;
    this.idle = text;
    this.dirty = true;
  }

  markDirty(): void {
    this.dirty = true;
  }

  /** Redraws when something changed, more often when the player is close. */
  maybeDraw(now: number, near: boolean, lines: TermLine[] | undefined, frame: BrowserFrame | undefined): void {
    if (this.prefsVersion !== screenPrefs.version) {
      this.prefsVersion = screenPrefs.version;
      this.dirty = true;
    }
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
    // everything is laid out in units of the laptop's layout: a bigger screen is sharper, and wider in those units
    ctx.setTransform(this.size.scale, 0, 0, this.size.scale, 0, 0);
    const W = canvas.width / this.size.scale;
    const H = canvas.height / this.size.scale;
    const agent = this.agent;
    if (!agent) {
      const area = lcarsFrame(ctx, W, H, { title: 'Focus OS', color: LCARS.periwinkle, seed: 47 });
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = LCARS.peach;
      ctx.font = `600 64px ${LCARS_FONT}`;
      ctx.fillText('STANDING BY', area.x, area.y + area.h / 2 - 30);
      ctx.fillStyle = LCARS.sky;
      ctx.font = `500 32px ${LCARS_FONT}`;
      ctx.fillText(fitText(ctx, this.idle.toUpperCase(), area.w), area.x, area.y + area.h / 2 + 30);
      return;
    }

    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, W, H);

    // title bar: an LCARS rail in the agent's status colour
    const color = LCARS_STATUS[agent.status];
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, 36);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(4, 4, 64, 28, [14, 0, 0, 14]);
    ctx.roundRect(W - 40, 4, 36, 28, [0, 14, 14, 0]);
    ctx.fill();
    ctx.fillStyle = LCARS.peach;
    ctx.font = `600 20px ${LCARS_FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const what = agent.task === 'lead' ? `${agent.lead?.title ?? 'lead'} · slice ${agent.lead?.slice ?? 1}` : `${agent.repo}#${agent.issue.number}`;
    ctx.fillText(fitText(ctx, `${agent.name} · ${what} · claude${agent.cloud ? ' ☁ cloud' : ''}`.toUpperCase(), W - 140), 80, 19);

    const footerH = 34;
    const prefs = screenPrefs.current;
    const tasks = prefs.tasks ? (agent.tasks ?? []) : [];
    const note = prefs.note && agent.task === 'lead' ? agent.lead?.note : undefined;
    const hasNote = !!note && (!!note.done || note.slice.length > 0);
    const panes = screenPanes(Math.round(W), { browser: prefs.browser && showsBrowser(frame), progress: tasks.length > 0 || hasNote });
    for (const { pane, x, w } of panes) {
      if (pane === 'terminal') this.drawTerminal(lines, x, 36, w, H - 36 - footerH);
      else if (pane === 'browser' && frame) this.drawBrowser(frame, x, 36, w, H - 36 - footerH);
      else if (pane === 'progress') this.drawProgress(agent, tasks, hasNote ? note : undefined, x, 36, w, H - 36 - footerH);
    }

    // status bar
    ctx.fillStyle = color;
    ctx.fillRect(0, H - footerH, W, footerH);
    ctx.fillStyle = '#000000';
    ctx.font = `600 20px ${LCARS_FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    // no room for the task list beside the terminal: how far along it is goes in the status bar instead
    const listed = !panes.some((p) => p.pane === 'progress') && tasks.length ? `📋 ${tasks.filter((t) => t.status === 'completed').length}/${tasks.length}` : '';
    const right = [listed, agent.context ? `◔ ${agent.context.percent}%` : '', agent.costUsd > 0 ? `$${agent.costUsd.toFixed(2)}` : ''].filter(Boolean).join('  ·  ');
    ctx.fillText(fitText(ctx, `● ${agent.status.toUpperCase()}  ${agent.activity}`, W - 40 - ctx.measureText(right).width), 12, H - footerH / 2);
    ctx.textAlign = 'right';
    ctx.fillText(right, W - 12, H - footerH / 2);
  }

  /**
   * The agent's progress: the task list Claude keeps for itself, each item with what it's doing while it's at it, and,
   * for a goal's lead, the goal note's what-done-looks-like and this slice's checklist.
   */
  private drawProgress(agent: Agent, tasks: ClaudeTask[], note: GoalNote | undefined, x: number, y: number, w: number, h: number): void {
    const ctx = this.c.ctx;
    const pad = 12;
    const lineH = 22;
    const bottom = y + h - pad;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = '#05070d';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = LCARS.lilac;
    ctx.fillRect(x, y, 4, h);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    let cy = y + pad + lineH / 2;
    const heading = (text: string, color: string) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x + pad, cy - 11, 10, 22, [11, 0, 0, 11]);
      ctx.fill();
      ctx.font = `600 18px ${LCARS_FONT}`;
      ctx.fillText(fitText(ctx, text.toUpperCase(), w - pad * 2 - 18), x + pad + 16, cy);
      cy += lineH + 4;
    };
    const item = (mark: string, text: string, color: string) => {
      if (cy > bottom) return;
      ctx.fillStyle = color;
      ctx.font = `15px ${UI_FONT}`;
      ctx.fillText(fitText(ctx, `${mark} ${text}`, w - pad * 2 - 8), x + pad + 6, cy);
      cy += lineH;
    };
    if (tasks.length) {
      heading(`Claude's tasks · ${tasks.filter((t) => t.status === 'completed').length}/${tasks.length}`, LCARS.lilac);
      for (const t of tasks) {
        if (t.status === 'in_progress') item('▶', t.activeForm || t.subject, LCARS.gold);
        else if (t.status === 'completed') item('✓', t.subject, '#6e7681');
        else item('○', t.subject, LCARS.sky);
      }
      cy += 8;
    }
    if (note && cy < bottom) {
      heading(`Goal · slice ${agent.lead?.slice ?? 1}`, LCARS.orange);
      if (note.done) item('◎', note.done, LCARS.peach);
      for (const i of note.slice) item(i.done ? '☑' : '☐', i.text, i.done ? '#6e7681' : '#e6edf3');
    }
    ctx.restore();
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
