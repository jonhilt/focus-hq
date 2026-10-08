import * as THREE from 'three';
import { UNIFORM } from '../../../shared/crew';
import type { Agent, Avatar } from '../../../shared/types';
import { canvasTexture, fitFont, fitText, makeCanvas, UI_FONT, wrap } from './canvas';
import type { CrewView } from './character';
import { checklistGlance, type GoalRoomTone, goalRoomState, leadNow, type NoteSection, noteSections, type PrGlance, rowAt, sliceProgress } from './goalRoom';
import { flat } from './materials';
import { portrait } from './portraits';
import { LCARS, LCARS_FONT, LCARS_STATUS } from './starship';

// What a team station shows of its goal besides the lead's session, drawn like the holograms over the holodeck pods
// in Lower Decks: glowing cyan on dark glass. The sign floats over the station's door (and is lit on the dado under the
// briefing room's viewscreen): the station, its goal and lead, whether its room is in session, and how far through its
// slice it is.
// The goal board on the briefing room's wall lists who's round the table and what each is doing, the way the crew
// leaderboard in Lower Decks does, beside the lead's note on the goal. The team screen hangs on the holodeck's teams
// wall beside the other stations', for what the team's up to at a glance.

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
  /** The slice's pull requests and how each stands (the teams wall's). */
  prs?: { label: string; state: PrGlance }[];
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
    const key = JSON.stringify(this.keyOf(view));
    if (key === this.key) return;
    this.key = key;
    this.c.ctx.clearRect(0, 0, this.c.canvas.width, this.c.canvas.height);
    this.draw(view);
    this.texture.needsUpdate = true;
  }

  /** What the display draws from: it's drawn again only when this changes. */
  protected keyOf(view: StationView): unknown {
    const { lead } = view;
    const crew = view.crew?.map(({ who, role }) => [who.name, who.status, who.line, role]);
    return [view.index, view.next, crew, lead && [lead.name, lead.status, lead.lead?.title, lead.lead?.slice, lead.lead?.note, lead.lead?.brief]];
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

/** How each of a goal's pull requests stands on the teams wall: its colour and word. */
const PR_LOOK: Record<PrGlance, { color: string; word: string }> = {
  open: { color: '#a7b4ff', word: 'open' },
  testing: { color: TONE['in-session'], word: 'QA testing' },
  passed: { color: TONE['your-turn'], word: 'QA passed' },
  failed: { color: TONE.stopped, word: 'QA failed' },
  merged: { color: LCARS.lilac, word: 'merged' },
  closed: { color: TONE.free, word: 'closed' },
};

/**
 * A team station's screen on the holodeck's teams wall, the four side by side so you can watch every team at once
 * without going in: how its room stands across the top in big type (seen from across the holodeck), the goal, what the
 * lead's up to right now, how far through the slice they are and what's left on its checklist, and along the bottom
 * who else is round the table and the slice's pull requests. A free station says so, or what's next in line for it.
 */
export class TeamScreen extends Display {
  static readonly W = 1600;
  static readonly H = 840;

  constructor() {
    super(TeamScreen.W, TeamScreen.H, false);
  }

  protected override keyOf(view: StationView): unknown {
    const { lead } = view;
    return [super.keyOf(view), view.prs, lead && [leadNow(lead), lead.avatar]];
  }

  protected draw({ index, accent, lead, crew, next, prs }: StationView): void {
    const { ctx } = this.c;
    const [W, H] = [TeamScreen.W, TeamScreen.H];
    const { tone, label } = goalRoomState(lead);
    const color = TONE[tone];
    ctx.fillStyle = '#061a24';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = GLASS;
    ctx.fillRect(0, 0, W, H);
    glowRect(ctx, 12, 12, W - 24, H - 24, 30, color, 6);

    // across the top: the station's code in its colour, its lead, and how its room stands, big enough to read from the door
    const top = 36;
    const barH = 108;
    const codeW = 270;
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.roundRect(40, top, codeW, barH, [60, 12, 12, 60]);
    ctx.fill();
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 88px ${LCARS_FONT}`;
    ctx.fillText(`TS-${index + 1}`, 40 + codeW / 2 + 8, top + barH / 2 + 4);
    ctx.font = `600 68px ${LCARS_FONT}`;
    const toneText = label.toUpperCase();
    const toneW = ctx.measureText(toneText).width + 80;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(W - 40 - toneW, top, toneW, barH, [12, 60, 60, 12]);
    ctx.fill();
    ctx.fillStyle = '#000000';
    ctx.fillText(toneText, W - 40 - toneW / 2, top + barH / 2 + 4);
    const nameX = 40 + codeW + 34;
    const nameW = W - 40 - toneW - 34 - nameX;
    ctx.textAlign = 'left';
    ctx.font = `600 60px ${LCARS_FONT}`;
    glowText(ctx, fitText(ctx, (lead ? lead.name : 'Team station').toUpperCase(), nameW), nameX, top + barH / 2 - 14, accent, 8);
    ctx.font = `500 32px ${LCARS_FONT}`;
    glowText(ctx, fitText(ctx, lead ? 'GOAL LEAD' : 'NO GOAL', nameW), nameX, top + barH / 2 + 34, TEXT, 4);

    if (!lead) {
      const y = top + barH + 30;
      ctx.fillStyle = PANE;
      ctx.beginPath();
      ctx.roundRect(40, y, W - 80, H - y - 40, 22);
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.font = `600 110px ${LCARS_FONT}`;
      glowText(ctx, next ? 'NEXT UP' : 'FREE', W / 2, y + 150, color, 16);
      ctx.font = `46px ${UI_FONT}`;
      ctx.fillStyle = TEXT;
      const lines = wrap(ctx, next ?? 'Press E here, or at its door, to start a goal at this station.', W - 260, 4);
      lines.forEach((line, i) => ctx.fillText(line, W / 2, y + 280 + i * 60));
      return;
    }

    // the goal, in big type
    ctx.textAlign = 'left';
    ctx.font = `600 88px ${LCARS_FONT}`;
    const title = wrap(ctx, (lead.lead?.title ?? lead.issue.title).toUpperCase(), W - 100, 2);
    title.forEach((line, i) => glowText(ctx, line, 50, top + barH + 62 + i * 92, TEXT, 10));

    // what the lead's up to right now, beside their face
    const nowY = top + barH + 62 + 92 + 58;
    const nowH = 150;
    ctx.fillStyle = PANE;
    ctx.beginPath();
    ctx.roundRect(40, nowY, W - 80, nowH, 22);
    ctx.fill();
    const tile = nowH - 36;
    ctx.fillStyle = 'rgba(8, 50, 66, 0.9)';
    ctx.beginPath();
    ctx.roundRect(58, nowY + 18, tile, tile, 14);
    ctx.fill();
    glowRect(ctx, 58, nowY + 18, tile, tile, 14, color, 3);
    this.face(lead.avatar, 58, nowY + 18, tile);
    const tx = 58 + tile + 30;
    const tw = W - 70 - tx;
    ctx.font = `600 34px ${LCARS_FONT}`;
    glowText(ctx, 'NOW', tx, nowY + 34, color, 8);
    ctx.font = `42px ${UI_FONT}`;
    ctx.fillStyle = TEXT;
    wrap(ctx, leadNow(lead), tw, 2).forEach((line, i) => ctx.fillText(line, tx, nowY + 82 + i * 48));

    // how far through the slice, and what's left on its checklist
    const barY = nowY + nowH + 44;
    const items = lead.lead?.note?.slice ?? [];
    const progress = sliceProgress(lead.lead?.note);
    ctx.font = `600 52px ${LCARS_FONT}`;
    glowText(ctx, `SLICE ${lead.lead?.slice ?? 1}`, 50, barY, TEXT, 6);
    const bx = 260;
    const bw = W - 240 - bx;
    ctx.fillStyle = PANE;
    ctx.beginPath();
    ctx.roundRect(bx, barY - 18, bw, 36, 18);
    ctx.fill();
    if (progress !== null && progress > 0) {
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 16;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(bx, barY - 18, Math.max(36, (bw * progress) / 100), 36, 18);
      ctx.fill();
      ctx.restore();
    }
    ctx.textAlign = 'right';
    ctx.font = `600 72px ${LCARS_FONT}`;
    glowText(ctx, progress === null ? '—' : `${progress}%`, W - 50, barY + 4, color, 14);
    ctx.textAlign = 'left';

    const listY = barY + 54;
    const lineH = 44;
    const glance = checklistGlance(items, 3);
    const lines: { mark: string; text: string; dim?: boolean }[] = [];
    if (glance.done) lines.push({ mark: '☑', text: `${glance.done} done`, dim: true });
    for (const item of glance.items) lines.push({ mark: item.done ? '☑' : '☐', text: item.text, dim: item.done });
    if (glance.more) lines.push({ mark: '+', text: `${glance.more} more`, dim: true });
    if (!items.length) lines.push({ mark: '◎', text: lead.lead?.note ? 'No checklist for this slice yet' : 'Talking the goal through', dim: true });
    ctx.font = `38px ${UI_FONT}`;
    lines.forEach((line, i) => {
      ctx.fillStyle = line.dim ? '#7d9aa3' : TEXT;
      ctx.fillText(line.mark, 54, listY + i * lineH);
      ctx.fillText(fitText(ctx, line.text, W - 160), 106, listY + i * lineH);
    });

    // along the bottom: who else is round the table, and the slice's pull requests
    const footY = H - 30 - 76;
    ctx.fillStyle = PANE;
    ctx.beginPath();
    ctx.roundRect(40, footY, W - 80, 76, 20);
    ctx.fill();
    const others = (crew ?? []).filter((c) => c.role !== 'Lead');
    let x = 56;
    for (const { who } of others.slice(0, 5)) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, footY + 8, 60, 60, 10);
      ctx.fillStyle = 'rgba(8, 50, 66, 0.9)';
      ctx.fill();
      ctx.restore();
      this.face(who.avatar, x, footY + 8, 60);
      ctx.fillStyle = LCARS_STATUS[who.status];
      ctx.beginPath();
      ctx.arc(x + 54, footY + 62, 9, 0, Math.PI * 2);
      ctx.fill();
      x += 72;
    }
    ctx.font = `500 32px ${LCARS_FONT}`;
    const helpers = others.filter((c) => c.role !== 'Reviewer').length;
    const reviewer = others.some((c) => c.role === 'Reviewer');
    const who = [reviewer ? 'REVIEWER' : '', helpers ? `${helpers} HELPER${helpers === 1 ? '' : 'S'}` : ''].filter(Boolean).join(' + ') || 'LEAD ON THEIR OWN';
    glowText(ctx, who, x + (others.length ? 8 : 0), footY + 38, TEXT, 4);
    const whoEnd = x + ctx.measureText(who).width + 40;

    ctx.textAlign = 'center';
    ctx.font = `500 32px ${LCARS_FONT}`;
    let right = W - 56;
    const chips = prs ?? [];
    if (!chips.length) {
      ctx.textAlign = 'right';
      glowText(ctx, 'NO PULL REQUESTS YET', right, footY + 38, '#7d9aa3', 0);
      return;
    }
    for (const pr of [...chips].reverse()) {
      const look = PR_LOOK[pr.state];
      const text = `${pr.label} ${look.word}`.toUpperCase();
      const w = ctx.measureText(text).width + 40;
      if (right - w < whoEnd) break;
      ctx.fillStyle = look.color;
      ctx.beginPath();
      ctx.roundRect(right - w, footY + 14, w, 48, 24);
      ctx.fill();
      ctx.fillStyle = '#000000';
      ctx.fillText(text, right - w / 2, footY + 39);
      right -= w + 14;
    }
  }

  /** A crew member's portrait in a square tile, or their face drawn flat where there's no portrait. */
  private face(avatar: Avatar, x: number, y: number, size: number): void {
    const { ctx } = this.c;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, size, size, 10);
    ctx.clip();
    const pic = portrait(avatar);
    if (pic) ctx.drawImage(pic, x, y, size, size);
    else face(ctx, avatar, x + size / 2, y + size * 0.44, size * 0.42);
    ctx.restore();
  }
}
