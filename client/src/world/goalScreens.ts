import * as THREE from 'three';
import { UNIFORM } from '../../../shared/crew';
import type { Agent, Avatar } from '../../../shared/types';
import { canvasTexture, fitFont, fitText, makeCanvas, UI_FONT, wrap } from './canvas';
import type { CrewView } from './character';
import { type GoalRoomTone, goalRoomState, type NoteSection, noteSections, rowAt, sliceProgress } from './goalRoom';
import { flat } from './materials';
import { portrait } from './portraits';
import { LCARS, LCARS_FONT, LCARS_STATUS } from './starship';

// What a team station shows of its goal besides the lead's session, drawn like the holograms over the holodeck pods
// in Lower Decks: glowing cyan on dark glass. The sign floats over the station's door (and hangs beside the briefing
// room's screen): the station, its goal and lead, whether its room is in session, and how far through its slice it is.
// The goal board on the briefing room's wall lists who's round the table and what each is doing, the way the crew
// leaderboard in Lower Decks does, beside the lead's note on the goal.

/** Each goal room tone's colour: cyan in session, as the pods' holograms are; red once stopped, as theirs go. */
export const TONE: Record<GoalRoomTone, string> = {
  free: '#8d9bb0',
  'in-session': '#66f0ff',
  'needs-you': LCARS.gold,
  'your-turn': '#99ee77',
  queued: '#a7b4ff',
  stopped: '#ff5c5c',
};

const GLASS = 'rgba(5, 30, 42, 0.9)';
const PANE = 'rgba(30, 120, 150, 0.22)';
const TEXT = '#dcfbff';

/**
 * What a station shows: its number and colour, its lead (none while it's free), who's round its table, and what's
 * next in line for it.
 */
export interface StationView {
  index: number;
  accent: string;
  lead?: Agent;
  crew?: { who: CrewView; role: string }[];
  next?: string;
}

/**
 * A crew member's face, drawn flat, for where their portrait can't be (no WebGL): shoulders in their division's
 * colour, their skin, hair and eyes.
 */
function face(ctx: CanvasRenderingContext2D, avatar: Avatar, cx: number, cy: number, r: number): void {
  ctx.save();
  ctx.fillStyle = UNIFORM[avatar.division];
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 1.25, r * 1.05, r * 0.6, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = avatar.skin;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
  ctx.fill();
  if (avatar.hairstyle !== 'bald') {
    ctx.fillStyle = avatar.hair;
    ctx.beginPath();
    ctx.arc(cx, cy - r * 0.05, r * 0.66, Math.PI * 1.05, Math.PI * 1.95);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#111';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(cx + s * r * 0.22, cy + r * 0.08, r * 0.07, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = '#111';
  ctx.lineWidth = r * 0.05;
  ctx.beginPath();
  ctx.arc(cx, cy + r * 0.2, r * 0.18, Math.PI * 0.2, Math.PI * 0.8);
  ctx.stroke();
  ctx.restore();
}

/** A glowing outline round a rounded rectangle. */
function glowRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, color: string, width: number): void {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = width * 4;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.stroke();
  ctx.restore();
}

/** Text that glows a little in its own colour. */
function glowText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, blur: number): void {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** A canvas drawn only when what it shows changes. */
abstract class Display {
  readonly material: THREE.MeshBasicMaterial;
  protected readonly c: ReturnType<typeof makeCanvas>;
  private readonly texture: THREE.CanvasTexture;
  private key = '';

  constructor(w: number, h: number, transparent: boolean) {
    this.c = makeCanvas(w, h);
    this.texture = canvasTexture(this.c.canvas);
    this.material = flat(this.texture, { transparent });
  }

  show(view: StationView): void {
    const { lead } = view;
    const crew = view.crew?.map(({ who, role }) => [who.name, who.status, who.line, role]);
    const key = JSON.stringify([view.index, view.next, crew, lead && [lead.name, lead.status, lead.lead?.title, lead.lead?.slice, lead.lead?.note, lead.lead?.brief]]);
    if (key === this.key) return;
    this.key = key;
    this.c.ctx.clearRect(0, 0, this.c.canvas.width, this.c.canvas.height);
    this.draw(view);
    this.texture.needsUpdate = true;
  }

  protected abstract draw(view: StationView): void;

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
  }
}

/**
 * The station's sign: a strip of holographic glass with the station's code at the left in its own colour, its goal and
 * lead in the middle, and at the right how far through the slice it is (or whether it's free), all edged in its room's
 * tone, so you can tell from across the holodeck which rooms are in session and which need you.
 */
export class GoalSign extends Display {
  static readonly W = 1800;
  static readonly H = 256;

  constructor() {
    super(GoalSign.W, GoalSign.H, true);
  }

  protected draw({ index, accent, lead, next }: StationView): void {
    const { ctx } = this.c;
    const [W, H] = [GoalSign.W, GoalSign.H];
    const { tone, label } = goalRoomState(lead);
    const color = TONE[tone];
    const m = 14;
    ctx.fillStyle = GLASS;
    ctx.beginPath();
    ctx.roundRect(m, m, W - m * 2, H - m * 2, 28);
    ctx.fill();
    glowRect(ctx, m, m, W - m * 2, H - m * 2, 28, color, 5);

    // the station's code, in its own colour
    const codeW = 230;
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.roundRect(m + 22, m + 22, codeW, H - m * 2 - 44, [70, 12, 12, 70]);
    ctx.fill();
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 96px ${LCARS_FONT}`;
    ctx.fillText(`TS-${index + 1}`, m + 22 + codeW / 2 + 8, H / 2 - 12);
    ctx.font = `600 30px ${LCARS_FONT}`;
    ctx.fillText('TEAM STATION', m + 22 + codeW / 2 + 8, H / 2 + 58);

    // how far through the slice, or whether it's free: the state you see first
    const progress = sliceProgress(lead?.lead?.note);
    const rightW = 330;
    const rx = W - m - 22 - rightW;
    ctx.fillStyle = PANE;
    ctx.beginPath();
    ctx.roundRect(rx, m + 22, rightW, H - m * 2 - 44, 16);
    ctx.fill();
    ctx.textAlign = 'center';
    if (lead && progress !== null) {
      ctx.font = `600 104px ${LCARS_FONT}`;
      glowText(ctx, `${progress}%`, rx + rightW / 2, H / 2 - 22, color, 18);
      ctx.font = `600 42px ${LCARS_FONT}`;
      glowText(ctx, `SLICE ${lead.lead?.slice ?? 1}`, rx + rightW / 2, H / 2 + 60, TEXT, 6);
    } else {
      // smaller type for a longer label (YOUR ANSWER), rather than cutting it off
      fitFont(ctx, label.toUpperCase(), rightW - 30, 64, 44, '600', LCARS_FONT);
      glowText(ctx, fitText(ctx, label.toUpperCase(), rightW - 30), rx + rightW / 2, H / 2, color, 18);
    }

    // the goal, its lead and how the room stands
    const x = m + 22 + codeW + 34;
    const w = rx - 30 - x;
    ctx.textAlign = 'left';
    ctx.font = `600 100px ${LCARS_FONT}`;
    const title = lead ? (lead.lead?.title ?? lead.issue.title) : next ? 'Free' : `Team station ${index + 1}`;
    glowText(ctx, fitText(ctx, title.toUpperCase(), w), x, H / 2 - 32, TEXT, 10);
    ctx.font = `500 50px ${LCARS_FONT}`;
    const sub = lead ? `${lead.name} · ${label}` : next ? `Next up: ${next}` : 'Free · start a goal here';
    glowText(ctx, fitText(ctx, sub.toUpperCase(), w), x, H / 2 + 50, color, 8);
  }
}

/**
 * The goal board on the briefing room's wall: the goal and how the room stands across the top; under it, like the
 * crew leaderboard in Lower Decks, who's round the table, each with their face, name, part and what they're doing,
 * beside the lead's note on the goal (noteSections), or before there's a note, the goal as the captain put it. While
 * the station's free, what's next for it.
 */
export class GoalBoard extends Display {
  static readonly W = 1440;
  static readonly H = 804;
  /** Where each crew member's row is, in the roster's order, as last drawn. */
  private rows: { left: number; right: number; top: number; bottom: number }[] = [];

  constructor() {
    super(GoalBoard.W, GoalBoard.H, false);
  }

  /** Which crew member's row (in the roster's order) a point on the board is on, from its texture coordinates. */
  rowAt(uv: THREE.Vector2): number | undefined {
    const [x, y] = [uv.x * GoalBoard.W, (1 - uv.y) * GoalBoard.H];
    const i = rowAt(this.rows, y);
    return i !== undefined && x >= this.rows[i].left && x < this.rows[i].right ? i : undefined;
  }

  protected draw({ index, accent, lead, crew, next }: StationView): void {
    const { ctx } = this.c;
    const [W, H] = [GoalBoard.W, GoalBoard.H];
    this.rows = [];
    const { tone, label } = goalRoomState(lead);
    const color = TONE[tone];
    ctx.fillStyle = '#061a24';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = GLASS;
    ctx.fillRect(0, 0, W, H);
    glowRect(ctx, 10, 10, W - 20, H - 20, 26, color, 4);

    // across the top: the station's colour, the goal, and how the room stands
    const top = 36;
    const barH = 92;
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.roundRect(36, top, 26, barH, [13, 0, 0, 13]);
    ctx.fill();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = `600 64px ${LCARS_FONT}`;
    const title = lead ? (lead.lead?.title ?? lead.issue.title) : `Team station ${index + 1}`;
    const status = lead ? `${lead.name} · ${label}` : label;
    ctx.save();
    ctx.font = `500 40px ${LCARS_FONT}`;
    const statusW = ctx.measureText(status.toUpperCase()).width;
    ctx.restore();
    glowText(ctx, fitText(ctx, title.toUpperCase(), W - 140 - statusW - 60), 82, top + barH / 2, TEXT, 10);
    ctx.font = `500 40px ${LCARS_FONT}`;
    ctx.textAlign = 'right';
    glowText(ctx, status.toUpperCase(), W - 50, top + barH / 2, color, 10);

    const y = top + barH + 30;
    const h = H - y - 40;
    const note = lead?.lead?.note;
    if (!lead) return this.message('Free', next ? `Next up: ${next}` : 'Press E at the door, or on the table, to start a goal here.', y, h, color);
    const gap = 30;
    const crewW = Math.round((W - 80 - gap) * 0.52);
    this.crew(crew ?? [], 40, y, crewW, h);
    const sections = note ? noteSections(note, lead.lead?.slice ?? 1) : [];
    const brief = lead.lead?.brief;
    if (!sections.length && brief) sections.push({ heading: 'As the captain put it', lines: 9, items: [{ mark: '“', text: brief }] });
    if (!sections.length) sections.push({ heading: 'No note yet', lines: 2, items: [{ mark: '◎', text: `${lead.name} hasn’t written the goal’s note yet.` }] });
    this.pane(sections, 40 + crewW + gap, y, W - 80 - gap - crewW, h);
  }

  /** The crew round the table, a row each, as many as fit: face, name and part, and what they're doing. */
  private crew(crew: { who: CrewView; role: string }[], x: number, y: number, w: number, h: number): void {
    const { ctx } = this.c;
    ctx.fillStyle = PANE;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 18);
    ctx.fill();
    const pad = 18;
    const rowH = Math.min(122, (h - pad * 2) / Math.max(4, crew.length));
    const tile = rowH - 14;
    crew.forEach(({ who, role }, i) => {
      const ry = y + pad + i * rowH;
      if (ry + rowH > y + h) return;
      this.rows.push({ left: x, right: x + w, top: ry - 7, bottom: ry + rowH - 7 });
      // the face in its own glowing cell, as on the leaderboard
      ctx.fillStyle = 'rgba(8, 50, 66, 0.9)';
      ctx.beginPath();
      ctx.roundRect(x + pad, ry, tile, tile, 10);
      ctx.fill();
      glowRect(ctx, x + pad, ry, tile, tile, 10, TONE['in-session'], 2);
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x + pad, ry, tile, tile, 10);
      ctx.clip();
      const pic = portrait(who.avatar);
      if (pic) ctx.drawImage(pic, x + pad, ry, tile, tile);
      else face(ctx, who.avatar, x + pad + tile / 2, ry + tile * 0.44, tile * 0.42);
      ctx.restore();
      const tx = x + pad + tile + 22;
      const tw = x + w - pad - tx;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = `600 ${Math.round(tile * 0.4)}px ${LCARS_FONT}`;
      const name = who.name.toUpperCase();
      glowText(ctx, fitText(ctx, name, tw - 150), tx, ry + tile * 0.3, TONE['in-session'], 10);
      const nameW = Math.min(ctx.measureText(name).width, tw - 150);
      ctx.font = `600 ${Math.round(tile * 0.24)}px ${LCARS_FONT}`;
      ctx.fillStyle = LCARS_STATUS[who.status];
      ctx.beginPath();
      ctx.arc(tx + nameW + 22, ry + tile * 0.3, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText(role.toUpperCase(), tx + nameW + 38, ry + tile * 0.31);
      ctx.font = `${Math.round(tile * 0.27)}px ${UI_FONT}`;
      ctx.fillStyle = TEXT;
      ctx.fillText(fitText(ctx, who.line, tw), tx, ry + tile * 0.76);
    });
  }

  /** One pane of the board, its sections one under another, as many lines as fit. */
  private pane(sections: NoteSection[], x: number, y: number, w: number, h: number): void {
    const { ctx } = this.c;
    ctx.fillStyle = PANE;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 18);
    ctx.fill();
    const pad = 26;
    const bottom = y + h - pad;
    const lineH = 44;
    let cy = y + pad + 22;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    for (const section of sections) {
      if (cy + lineH > bottom) break;
      ctx.font = `600 42px ${LCARS_FONT}`;
      glowText(ctx, section.heading.toUpperCase(), x + pad, cy, TONE['in-session'], 8);
      cy += lineH + 6;
      ctx.font = `34px ${UI_FONT}`;
      for (const item of section.items) {
        const lines = wrap(ctx, item.text, w - pad * 2 - 48, section.lines);
        for (const [i, line] of lines.entries()) {
          if (cy > bottom) break;
          ctx.fillStyle = item.dim ? '#6f8a93' : TEXT;
          if (i === 0) ctx.fillText(item.mark, x + pad, cy);
          ctx.fillText(line, x + pad + 48, cy);
          cy += lineH;
        }
        cy += 4;
      }
      cy += 18;
    }
  }

  /** A heading and a few lines in the middle of the board, for when there's no note to show. */
  private message(heading: string, text: string, y: number, h: number, color: string): void {
    const { ctx } = this.c;
    const W = GoalBoard.W;
    ctx.fillStyle = PANE;
    ctx.beginPath();
    ctx.roundRect(40, y, W - 80, h, 18);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 64px ${LCARS_FONT}`;
    glowText(ctx, fitText(ctx, heading.toUpperCase(), W - 160), W / 2, y + h * 0.3, color, 14);
    ctx.font = `34px ${UI_FONT}`;
    ctx.fillStyle = TEXT;
    const lines = wrap(ctx, text, W - 240, 6);
    lines.forEach((line, i) => ctx.fillText(line, W / 2, y + h * 0.3 + 90 + i * 46));
  }
}
