import * as THREE from 'three';
import { UNIFORM } from '../../../shared/crew';
import type { Agent, Avatar } from '../../../shared/types';
import { canvasTexture, fitFont, fitText, makeCanvas, UI_FONT, wrap } from './canvas';
import type { CrewView } from './character';
import { checklistGlance, type GoalRoomTone, goalRoomState, leadNow, type NoteSection, noteSections, type PrGlance, rowAt, sliceProgress } from './goalRoom';
import { flat } from './materials';
import { portrait } from './portraits';
import { LCARS, LCARS_FONT, LCARS_STATUS } from './starship';

// What a team station shows of its goal besides the lead's session. What floats in the holodeck is drawn like the
// holograms over the pods in Lower Decks, glowing cyan on dark glass: the sign over the station's door (also lit on the
// dado under the briefing room's viewscreen), with the station, its goal and lead, whether its room is in session, and
// how far through its slice it is; and the team screen over its pod, for what the team's up to at a glance.
// The goal board on the briefing room's wall is LCARS, like the viewscreen beside it: the goal and the lead's note on
// it, and who's in the briefing room and what each is doing, the way the crew leaderboard in Lower Decks does.

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
 * What a station shows: its number and colour, its lead (none while it's free), who's in its briefing room, and what's
 * next in line for it.
 */
export interface StationView {
  index: number;
  accent: string;
  lead?: Agent;
  crew?: { who: CrewView; role: string }[];
  next?: string;
  /** The slice's pull requests and how each stands (the screen over its pod's). */
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
  protected readonly c: ReturnType<typeof makeCanvas>;
  /** What it draws into, for a material other than its own to show (a Hologram, hologram.ts). */
  readonly texture: THREE.CanvasTexture;
  private flat?: THREE.MeshBasicMaterial;
  private key = '';

  constructor(
    w: number,
    h: number,
    private readonly transparent: boolean,
  ) {
    this.c = makeCanvas(w, h);
    this.texture = canvasTexture(this.c.canvas);
  }

  /** Its own unlit material, made the first time it's asked for. */
  get material(): THREE.MeshBasicMaterial {
    return (this.flat ??= flat(this.texture, { transparent: this.transparent }));
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
    this.flat?.dispose();
  }
}

/**
 * The station's sign: a strip of holographic glass with the station's code at the left in its own colour, its goal and
 * lead in the middle, and at the right how far through the slice it is (or whether it's free), a hologram (hologram.ts)
 * edged in its room's tone, so you can tell from across the holodeck which rooms are in session and which need you.
 */
export class GoalSign extends Display {
  static readonly W = 1800;
  static readonly H = 256;

  constructor() {
    super(GoalSign.W, GoalSign.H, false);
  }

  protected draw({ index, accent, lead, next }: StationView): void {
    const { ctx } = this.c;
    const [W, H] = [GoalSign.W, GoalSign.H];
    const { tone, label } = goalRoomState(lead);
    const color = TONE[tone];
    const m = 14;
    ctx.fillStyle = GLASS;
    ctx.fillRect(0, 0, W, H);
    // edged by its hologram's outline, in its room's tone (teamStation.ts)

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

/** How each of a goal's pull requests stands on the goal board and the screen over its pod: its colour and word. */
export const PR_LOOK: Record<PrGlance, { color: string; word: string }> = {
  open: { color: '#a7b4ff', word: 'open' },
  testing: { color: TONE['in-session'], word: 'QA testing' },
  passed: { color: TONE['your-turn'], word: 'QA passed' },
  failed: { color: TONE.stopped, word: 'QA failed' },
  merged: { color: LCARS.lilac, word: 'merged' },
  closed: { color: TONE.free, word: 'closed' },
};

/** The goal board's body type, largest first: it takes the largest that fits all of the note, down to the smallest. */
const BOARD_TYPE = [30, 28, 26, 24, 22, 20];
/** The size of the board's headings, whatever size its body type. */
const HEADING = 34;
const BOARD_BG = '#000000';
const DIM = '#6e7681';
const BODY = '#e6edf3';

/** Each of the note's headings on the board, in its own LCARS colour. */
const SECTION_COLOR: Record<string, string> = { 'Done looks like': LCARS.peach, Next: LCARS.peach, Learned: LCARS.periwinkle, 'As the captain put it': LCARS.peach };

/**
 * The goal board on the briefing room's wall, an LCARS screen like the viewscreen beside it (which keeps to the work
 * going on now): an elbow in the station's colour with its code, the goal in full across the top and how the room
 * stands; under it, in two columns, this slice's checklist (with a bar for how far through it they are) and what done
 * looks like, and beside them who's in the briefing room, each with their face, name, part and what they're doing, the
 * slice's pull requests, what might come next and the latest lessons (noteSections). Before there's a note, the goal
 * as the captain put it. The type shrinks until it all fits, rather than cutting lines off. While the station's free,
 * what's next for it.
 */
export class GoalBoard extends Display {
  static readonly W = 1440;
  static readonly H = 804;
  /** Where each crew member's row is, in the roster's order, as last drawn. */
  private rows: { left: number; right: number; top: number; bottom: number }[] = [];

  constructor() {
    super(GoalBoard.W, GoalBoard.H, false);
  }

  protected override keyOf(view: StationView): unknown {
    return [super.keyOf(view), view.accent, view.prs];
  }

  /** Which crew member's row (in the roster's order) a point on the board is on, from its texture coordinates. */
  rowAt(uv: THREE.Vector2): number | undefined {
    const [x, y] = [uv.x * GoalBoard.W, (1 - uv.y) * GoalBoard.H];
    const i = rowAt(this.rows, y);
    return i !== undefined && x >= this.rows[i].left && x < this.rows[i].right ? i : undefined;
  }

  protected draw({ index, accent, lead, crew, next, prs }: StationView): void {
    const { ctx } = this.c;
    const [W, H] = [GoalBoard.W, GoalBoard.H];
    this.rows = [];
    const { tone, label } = goalRoomState(lead);
    const color = TONE[tone];
    ctx.fillStyle = BOARD_BG;
    ctx.fillRect(0, 0, W, H);

    // the elbow, in the station's colour, sweeping from the top bar down the left side
    const side = 150;
    const bar = 118;
    const rule = 10;
    const r = 60;
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(0, bar + 120);
    ctx.lineTo(0, r);
    ctx.arc(r, r, r, Math.PI, (Math.PI * 3) / 2);
    ctx.lineTo(side, 0);
    ctx.lineTo(side, bar + rule);
    ctx.arc(side + 30, bar + rule + 30, 30, Math.PI * 1.5, Math.PI, true);
    ctx.lineTo(side, bar + 120);
    ctx.closePath();
    ctx.fill();
    // the rule under the top bar, from the elbow to the right-hand end
    ctx.fillRect(side, bar, W - side - 24, rule);
    ctx.beginPath();
    ctx.roundRect(W - 30, bar, 30, rule, [0, rule / 2, rule / 2, 0]);
    ctx.fill();
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `600 54px ${LCARS_FONT}`;
    ctx.fillText(`TS-${index + 1}`, side - 14, bar - 16);
    // blocks down the left side, as on the viewscreen's frame
    const blocks: [string, number][] = [[LCARS.lilac, 90], [LCARS.periwinkle, 150], [LCARS.peach, H]];
    let by = bar + 130;
    for (const [i, [c, bh]] of blocks.entries()) {
      const h = Math.min(bh, H - by);
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.roundRect(0, by, side, h, i === blocks.length - 1 ? [0, 0, 0, r] : 0);
      ctx.fill();
      by += h + 8;
    }

    // across the top: the goal in full, and how the room stands
    const status = (lead ? `${lead.name} · ${label}` : label).toUpperCase();
    ctx.font = `600 34px ${LCARS_FONT}`;
    const pillW = ctx.measureText(status).width + 56;
    const pillH = 56;
    const pillX = W - 24 - pillW;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(pillX, (bar - pillH) / 2, pillW, pillH, pillH / 2);
    ctx.fill();
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(status, pillX + pillW / 2, bar / 2 + 2);
    const title = (lead ? (lead.lead?.title ?? lead.issue.title) : `Team station ${index + 1}`).toUpperCase();
    const tx = side + 28;
    const tw = pillX - 28 - tx;
    let titleLines: string[] = [];
    for (const px of [54, 46, 40, 36]) {
      ctx.font = `600 ${px}px ${LCARS_FONT}`;
      titleLines = wrap(ctx, title, tw, 2);
      if (wrap(ctx, title, tw).length <= 2) break;
    }
    const titleH = parseInt(ctx.font.split(' ')[1], 10) * 1.05;
    ctx.fillStyle = LCARS.peach;
    ctx.textAlign = 'left';
    titleLines.forEach((line, i) => ctx.fillText(line, tx, bar / 2 + (i - (titleLines.length - 1) / 2) * titleH));

    const x = side + 34;
    const y = bar + rule + 30;
    const w = W - 30 - x;
    const h = H - 26 - y;
    if (!lead) return this.message('Free', next ? `Next up: ${next}` : 'Press E at the door, or on this board, to start a goal here.', x, y, w, h, color);

    const note = lead.lead?.note;
    const sections = note ? noteSections(note, lead.lead?.slice ?? 1) : [];
    const brief = lead.lead?.brief;
    if (!sections.length && brief) sections.push({ heading: 'As the captain put it', side: 'goal', items: [{ mark: '“', text: brief }] });
    if (!sections.length) sections.push({ heading: 'No note yet', side: 'goal', items: [{ mark: '◎', text: `${lead.name} hasn’t written the goal’s note yet.` }] });
    const gap = 44;
    const leftW = Math.round((w - gap) * 0.54);
    const rx = x + leftW + gap;
    const rw = w - leftW - gap;
    const goal = sections.filter((s) => s.side === 'goal');
    const ahead = sections.filter((s) => s.side === 'crew');
    const progress = sliceProgress(note);

    // the crew and their pull requests take what they need of the right-hand column; the note has the rest. The type
    // is the largest that fits both columns, so they match, moving what's next and the lessons over under the goal
    // when there's no room for them under the crew, and leaving the lessons out, then what's next, when even the
    // smallest type can't fit them.
    const crewBottom = this.crew(crew ?? [], prs ?? [], rx, y, rw);
    const columns = (kept: number, moved: number) => [[...goal, ...ahead.slice(0, moved)], ahead.slice(moved, kept)];
    const fits = (px: number, kept: number, moved: number) => {
      const [left, right] = columns(kept, moved);
      return this.flow(left, x, y, leftW, h, px, progress, false) && this.flow(right, rx, crewBottom, rw, y + h - crewBottom, px, null, false);
    };
    let [size, kept, moved] = [BOARD_TYPE[BOARD_TYPE.length - 1], 0, 0];
    found: for (let k = ahead.length; k >= 0; k--) {
      for (const px of BOARD_TYPE) {
        for (let m = 0; m <= k; m++) {
          if (fits(px, k, m)) {
            [size, kept, moved] = [px, k, m];
            break found;
          }
        }
      }
    }
    const [left, right] = columns(kept, moved);
    this.flow(left, x, y, leftW, h, size, progress, true);
    this.flow(right, rx, crewBottom, rw, y + h - crewBottom, size, null, true);
  }

  /** An LCARS heading: a rounded tab in its colour, then its words. */
  private heading(text: string, x: number, y: number, w: number, px: number, color: string): void {
    const { ctx } = this.c;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y - px * 0.5, px * 0.45, px, [px / 2, 0, 0, px / 2]);
    ctx.fill();
    ctx.font = `600 ${px}px ${LCARS_FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(fitText(ctx, text.toUpperCase(), w - px * 0.8), x + px * 0.8, y + 1);
  }

  /**
   * Sections one under another in a column, their items wrapped in `px` type; the first section gets a bar for
   * `progress` under its heading when there is one. Says whether all of it fitted; with `draw`, draws it, as far down
   * as fits.
   */
  private flow(sections: NoteSection[], x: number, y: number, w: number, h: number, px: number, progress: number | null, draw: boolean): boolean {
    const { ctx } = this.c;
    const bottom = y + h;
    const lineH = Math.round(px * 1.32);
    const headPx = HEADING;
    const markW = Math.round(px * 1.4);
    let cy = y;
    for (const [i, section] of sections.entries()) {
      const color = i === 0 && section.side === 'goal' ? LCARS.gold : (SECTION_COLOR[section.heading] ?? LCARS.lilac);
      if (draw && cy + headPx <= bottom) this.heading(section.heading, x, cy + headPx / 2, w, headPx, color);
      cy += headPx + 10;
      if (i === 0 && progress !== null) {
        if (draw && cy + 14 <= bottom) {
          ctx.fillStyle = '#1c2230';
          ctx.beginPath();
          ctx.roundRect(x, cy, w, 14, 7);
          ctx.fill();
          if (progress > 0) {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.roundRect(x, cy, Math.max(14, (w * progress) / 100), 14, 7);
            ctx.fill();
          }
        }
        cy += 14 + 12;
      }
      ctx.font = `${px}px ${UI_FONT}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      for (const item of section.items) {
        for (const [j, line] of wrap(ctx, item.text, w - markW).entries()) {
          if (draw && cy + lineH <= bottom) {
            ctx.fillStyle = item.dim ? DIM : BODY;
            if (j === 0) ctx.fillText(item.mark, x, cy);
            ctx.fillText(line, x + markW, cy);
          }
          cy += lineH;
        }
        cy += Math.round(px * 0.25);
      }
      cy += Math.round(px * 0.7);
    }
    return cy - Math.round(px * 0.95) <= bottom;
  }

  /**
   * Who's in the briefing room, a row each (face, name and part, and what they're doing), then the slice's pull
   * requests, at the top of a column. Returns where the column's free below them.
   */
  private crew(crew: { who: CrewView; role: string }[], prs: { label: string; state: PrGlance }[], x: number, y: number, w: number): number {
    const { ctx } = this.c;
    const headPx = HEADING;
    this.heading('Crew', x, y + headPx / 2, w, headPx, LCARS.periwinkle);
    let cy = y + headPx + 14;
    const tile = 62;
    const rowH = Math.min(70, 280 / Math.max(4, crew.length));
    const size = Math.min(tile, rowH - 10);
    for (const { who, role } of crew) {
      this.rows.push({ left: x, right: x + w, top: cy - 4, bottom: cy + rowH - 4 });
      ctx.fillStyle = '#10161f';
      ctx.beginPath();
      ctx.roundRect(x, cy, size, size, 10);
      ctx.fill();
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, cy, size, size, 10);
      ctx.clip();
      const pic = portrait(who.avatar);
      if (pic) ctx.drawImage(pic, x, cy, size, size);
      else face(ctx, who.avatar, x + size / 2, cy + size * 0.44, size * 0.42);
      ctx.restore();
      const tx = x + size + 16;
      const tw = x + w - tx;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = `600 ${Math.round(size * 0.44)}px ${LCARS_FONT}`;
      const name = fitText(ctx, who.name.toUpperCase(), tw - 140);
      ctx.fillStyle = LCARS.periwinkle;
      ctx.fillText(name, tx, cy + size * 0.26);
      const nameW = ctx.measureText(name).width;
      ctx.fillStyle = LCARS_STATUS[who.status];
      ctx.beginPath();
      ctx.arc(tx + nameW + 16, cy + size * 0.26, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `600 ${Math.round(size * 0.32)}px ${LCARS_FONT}`;
      ctx.fillStyle = LCARS.lilac;
      ctx.fillText(fitText(ctx, role.toUpperCase(), tw - nameW - 30), tx + nameW + 28, cy + size * 0.28);
      ctx.font = `${Math.round(size * 0.34)}px ${UI_FONT}`;
      ctx.fillStyle = '#c8d1db';
      ctx.fillText(fitText(ctx, who.line, tw), tx, cy + size * 0.74);
      cy += rowH;
    }
    cy += 16;

    // the slice's pull requests, as many as fit on two lines
    this.heading('Pull requests', x, cy + headPx / 2, w, headPx, LCARS.lilac);
    cy += headPx + 14;
    ctx.font = `600 26px ${LCARS_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (!prs.length) {
      ctx.textAlign = 'left';
      ctx.fillStyle = DIM;
      ctx.fillText('NONE YET', x, cy + 18);
      return cy + 36 + 30;
    }
    const chipH = 38;
    let cx = x;
    let line = 0;
    for (const pr of prs) {
      const look = PR_LOOK[pr.state];
      const text = `${pr.label} ${look.word}`.toUpperCase();
      const cw = Math.min(w, ctx.measureText(text).width + 32);
      if (cx + cw > x + w && cx > x) {
        if (++line === 2) break;
        cx = x;
        cy += chipH + 10;
      }
      ctx.fillStyle = look.color;
      ctx.beginPath();
      ctx.roundRect(cx, cy, cw, chipH, chipH / 2);
      ctx.fill();
      ctx.fillStyle = '#000000';
      ctx.fillText(fitText(ctx, text, cw - 24), cx + cw / 2, cy + chipH / 2 + 1);
      cx += cw + 10;
    }
    return cy + chipH + 30;
  }

  /** A heading and a few lines in the middle of the board, for when there's no note to show. */
  private message(heading: string, text: string, x: number, y: number, w: number, h: number, color: string): void {
    const { ctx } = this.c;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 96px ${LCARS_FONT}`;
    ctx.fillStyle = color;
    ctx.fillText(fitText(ctx, heading.toUpperCase(), w - 80), x + w / 2, y + h * 0.3);
    ctx.font = `34px ${UI_FONT}`;
    ctx.fillStyle = BODY;
    const lines = wrap(ctx, text, w - 160, 6);
    lines.forEach((line, i) => ctx.fillText(line, x + w / 2, y + h * 0.3 + 100 + i * 46));
  }
}

/**
 * The star chart to starboard of the briefing room's viewscreen (blender/team_station.py), an LCARS screen like the
 * goal board to port: for now its title over the goal, until it draws the goal's course itself.
 */
export class ChartScreen extends Display {
  static readonly W = GoalBoard.W;
  static readonly H = GoalBoard.H;

  constructor() {
    super(ChartScreen.W, ChartScreen.H, false);
  }

  protected override keyOf(view: StationView): unknown {
    return [view.index, view.accent, view.lead?.lead?.title, view.lead?.lead?.slice];
  }

  protected draw({ accent, lead }: StationView): void {
    const { ctx } = this.c;
    const [W, H] = [ChartScreen.W, ChartScreen.H];
    ctx.fillStyle = BOARD_BG;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.roundRect(0, 0, W, 118, [60, 0, 0, 0]);
    ctx.fill();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = `600 64px ${LCARS_FONT}`;
    ctx.fillStyle = '#000000';
    ctx.fillText('STELLAR CARTOGRAPHY', 60, 62);
    const work = lead?.lead;
    ctx.textAlign = 'center';
    ctx.fillStyle = accent;
    ctx.font = `600 72px ${LCARS_FONT}`;
    ctx.fillText(fitText(ctx, (work?.title ?? 'No goal under way').toUpperCase(), W - 120), W / 2, H * 0.45);
    ctx.font = `34px ${UI_FONT}`;
    ctx.fillStyle = BODY;
    ctx.fillText(work ? `Charting the voyage: waypoint ${work.slice}` : 'The chart of a goal shows here once one starts', W / 2, H * 0.45 + 90);
  }
}

/**
 * A team station's screen, hung over its pod as a hologram (hologram.ts), the four round the holodeck so you can watch every team at once
 * without going in: how its room stands across the top in big type (seen from across the holodeck), the goal, what the
 * lead's up to right now, how far through the slice they are and what's left on its checklist, and along the bottom
 * who else is in the briefing room and the slice's pull requests. A free station says so, or what's next in line for it.
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
    // edged by its hologram's outline, in its room's tone (teamStation.ts)

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

    // along the bottom: who else is in the briefing room, and the slice's pull requests
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
