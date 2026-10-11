import * as THREE from 'three';
import { helperFor } from '../../../shared/crew';
import type { Workflow, WorkflowAgent } from '../../../shared/types';
import { sound } from '../sound';
import { canvasTexture, fitText, makeCanvas, roundRect } from './canvas';
import { Character, type CrewView } from './character';
import { flat } from './materials';
import { LCARS, LCARS_FONT, LCARS_STATUS, lcarsFrame } from './starship';
import { Beam } from './transporter';
import type { TransporterRoom } from './transporterRoom';
import {
  agentKey, barSegments, bufferGlow, bufferLine, type Counts, PAD_COUNT, type PadOccupant, phaseColour, standOnPads, tacticalSummary,
  type TacticalSummary,
} from './workflowRooms';

// A workflow running in a transporter room (transporterRoom.ts): its agents at work standing on the pads, beaming in as
// they start and out once they've finished, each pad lit in its agent's phase colour; the pattern buffer glowing with
// the agents still queued, and its readout counting them; the tactical display following the operation phase by phase.
// Who stands where is workflowRooms.ts's; this draws it.

/** How often the pads are looked at again, for the finished to beam out once they've lingered (ms). */
const RESTAND_MS = 250;
/** How often a watched room's screens are checked for something new to draw: the clock ticks by the second. */
const SCREENS_MS = 500;
/** A pad's ring and emitter while nobody's on it. */
const DIM = 0.16;

/** The speech bubbles over the pads: how big, and how far every other one's raised. */
const BUBBLE = { size: 0.6, lift: 0.32 };

const READY = { done: LCARS_STATUS.done, failed: LCARS_STATUS.error };

/** How an agent on a pad shows: their label for a name and what they're doing over their head, in an ensign's face. */
function padView(workflow: Workflow, agent: WorkflowAgent): CrewView {
  const key = agentKey(workflow.id, agent.index);
  const phase = workflow.phases.find((p) => p.index === agent.phase);
  return {
    name: agent.label,
    avatar: helperFor(key).avatar,
    status: agent.status === 'working' ? 'working' : agent.status === 'done' ? 'done' : agent.status === 'failed' ? 'error' : 'queued',
    line: agent.activity,
    tag: phase?.title,
  };
}

interface Figure {
  key: string;
  character: Character;
}

export class TransporterOperation {
  private workflow: Workflow | undefined;
  /** When the room first saw its workflow over, to stop the clock. */
  private endedAt: number | undefined;
  private pads: (PadOccupant | undefined)[] = Array.from({ length: PAD_COUNT }, () => undefined);
  private readonly figures: (Figure | undefined)[] = Array.from({ length: PAD_COUNT }, () => undefined);
  /** Pads someone's beaming out of: closed till they've gone. */
  private readonly leaving = new Set<number>();
  private beams: Beam[] = [];
  private lastStand = 0;
  private lastScreens = 0;
  /** Whether anyone's looking: the captain in the room, or its feed in the briefing room. */
  private watched = false;
  /** Whether the captain's in the room, to hear it. */
  private hearing = false;
  private readonly idle: { tactical: THREE.Material | THREE.Material[]; buffer: THREE.Material | THREE.Material[] };
  private readonly tactical = makeCanvas(1440, 800);
  private readonly tacticalTex = canvasTexture(this.tactical.canvas);
  private readonly tacticalMat = flat(this.tacticalTex);
  private tacticalKey = '';
  private readonly buffer = makeCanvas(640, 397);
  private readonly bufferTex = canvasTexture(this.buffer.canvas);
  private readonly bufferMat = flat(this.bufferTex);
  private bufferKey = '';
  private queued = 0;
  private readonly glow: THREE.Color;
  private readonly ringLit: THREE.Color;
  private readonly emitterLit: THREE.Color;
  private readonly tmp = new THREE.Vector3();

  constructor(readonly room: TransporterRoom) {
    this.idle = { tactical: room.tactical.material, buffer: room.buffer.readout.material };
    this.glow = room.buffer.light.color.clone();
    this.ringLit = (room.pads[0].ring.material as THREE.MeshBasicMaterial).color.clone();
    this.emitterLit = (room.pads[0].emitter.material as THREE.MeshBasicMaterial).color.clone();
    for (const pad of room.pads) this.light(pad.ring, this.ringLit, DIM);
    for (const pad of room.pads) this.light(pad.emitter, this.emitterLit, DIM);
    room.buffer.light.color.copy(this.glow).multiplyScalar(bufferGlow(0, 0));
  }

  /** The workflow in the room now, or none: its agents take the pads, or leave them. */
  show(workflow: Workflow | undefined, now: number): void {
    if (workflow?.id !== this.workflow?.id) this.endedAt = undefined;
    if (workflow && workflow.status !== 'running') this.endedAt ??= Date.now();
    this.workflow = workflow;
    this.queued = workflow?.phases.reduce((n, p) => n + p.queued, 0) ?? 0;
    this.stand(now);
    this.tacticalKey = '';
    if (this.watched) this.drawScreens();
  }

  /** The workflow in the room, if any. */
  get current(): Workflow | undefined {
    return this.workflow;
  }

  /** Puts whoever should be on the pads there, beaming them in or out. */
  private stand(now: number): void {
    this.lastStand = now;
    const wf = this.workflow;
    const agents = wf ? wf.agents.map((a) => ({ key: agentKey(wf.id, a.index), phase: a.phase, status: a.status })) : [];
    const closed = this.pads.map((_, i) => this.leaving.has(i));
    const next = standOnPads(this.pads, agents, now, closed);
    for (let i = 0; i < PAD_COUNT; i++) {
      const was = this.figures[i];
      const occupant = next[i];
      if (was && was.key !== occupant?.key) this.beamOut(i, was);
      const agent = wf && occupant ? wf.agents.find((a) => agentKey(wf.id, a.index) === occupant.key) : undefined;
      if (!wf || !occupant || !agent) {
        this.figures[i] = undefined;
        this.light(this.room.pads[i].ring, this.ringLit, DIM);
        this.light(this.room.pads[i].emitter, this.emitterLit, DIM);
        continue;
      }
      const view = padView(wf, agent);
      const figure = this.figures[i];
      if (figure?.key !== occupant.key) this.figures[i] = this.beamIn(i, occupant.key, view);
      else figure.character.set(view);
      const phase = wf.phases.find((p) => p.index === occupant.phase);
      const colour = LCARS[phaseColour(phase ?? { index: occupant.phase })];
      this.light(this.room.pads[i].ring, tint.set(occupant.status === 'working' ? colour : READY[occupant.status]), 1);
      this.light(this.room.pads[i].emitter, tint.set(colour).lerp(WHITE, 0.45), 0.85);
    }
    this.pads = next;
  }

  private light(mesh: THREE.Mesh, colour: THREE.Color, k: number): void {
    (mesh.material as THREE.MeshBasicMaterial).color.copy(colour).multiplyScalar(k);
  }

  private beamIn(i: number, key: string, view: CrewView): Figure {
    const pad = this.room.pads[i];
    // pads stand 0.8 m apart: smaller bubbles than a seated crew member's, every other one raised, so they don't overlap
    const character = new Character(view, 'standing', { size: BUBBLE.size, lift: pad.slot % 2 ? BUBBLE.lift : 0 });
    character.group.position.copy(pad.at);
    character.group.rotation.y = pad.yaw;
    this.room.group.add(character.group);
    // seen from nowhere, nothing to see: they're just there
    if (this.watched) {
      this.beams.push(new Beam(character.group, 'in', performance.now()));
      if (this.hearing) sound.beam();
    }
    return { key, character };
  }

  private beamOut(i: number, figure: Figure): void {
    const gone = () => {
      figure.character.group.removeFromParent();
      figure.character.dispose();
      this.leaving.delete(i);
    };
    if (!this.watched) return gone();
    this.leaving.add(i);
    this.beams.push(new Beam(figure.character.group, 'out', performance.now(), gone));
    if (this.hearing) sound.beam();
  }

  /**
   * Moves the room on: `eye` is where it's watched from (the captain in it, or its feed's camera), or null while
   * nobody's looking, when only what has to happen happens; `hearing` while the captain's in it.
   */
  update(t: number, now: number, eye: THREE.Vector3 | null, hearing: boolean): void {
    const was = this.watched;
    this.watched = !!eye;
    this.hearing = hearing;
    if (now - this.lastStand > RESTAND_MS) this.stand(now);
    if (this.beams.length) this.beams = this.beams.filter((b) => !b.update(now));
    if (!eye) return;
    for (const figure of this.figures) figure?.character.update(t, eye.distanceTo(figure.character.group.getWorldPosition(this.tmp)));
    this.room.buffer.light.color.copy(this.glow).multiplyScalar(bufferGlow(this.queued, t));
    if (!was || now - this.lastScreens > SCREENS_MS) {
      this.lastScreens = now;
      this.drawScreens();
    }
  }

  /** The tactical display and the buffer's readout, redrawn only when what they say has changed. */
  private drawScreens(): void {
    const wf = this.workflow;
    if (!wf) {
      this.room.tactical.material = this.idle.tactical;
      this.room.buffer.readout.material = this.idle.buffer;
      this.tacticalKey = this.bufferKey = '';
      return;
    }
    const summary = tacticalSummary(wf, Date.now(), this.endedAt);
    const key = JSON.stringify(summary);
    if (key !== this.tacticalKey) {
      this.tacticalKey = key;
      drawTactical(this.tactical.ctx, this.tactical.canvas, summary, wf.description, this.room.index);
      this.tacticalTex.needsUpdate = true;
      this.room.tactical.material = this.tacticalMat;
    }
    const held = summary.rows.map((r) => [r.colour, r.queued] as const).filter(([, n]) => n > 0);
    const bufferKey = JSON.stringify(held);
    if (bufferKey !== this.bufferKey) {
      this.bufferKey = bufferKey;
      drawBuffer(this.buffer.ctx, this.buffer.canvas, held.map(([colour, n]) => ({ colour: LCARS[colour], n })));
      this.bufferTex.needsUpdate = true;
      this.room.buffer.readout.material = this.bufferMat;
    }
  }

  dispose(): void {
    for (const beam of this.beams) beam.finish();
    for (const figure of this.figures) figure?.character.dispose();
    this.tacticalTex.dispose();
    this.tacticalMat.dispose();
    this.bufferTex.dispose();
    this.bufferMat.dispose();
  }
}

const tint = new THREE.Color();
const WHITE = new THREE.Color('#ffffff');

const STATUS_PILL: Record<Workflow['status'], { text: string; colour: string }> = {
  running: { text: 'Energising', colour: LCARS.sky },
  done: { text: 'Complete', colour: LCARS_STATUS.done },
  failed: { text: 'Failed', colour: LCARS.red },
};

const COUNT_COLOUR: Record<keyof Counts, string> = { done: LCARS_STATUS.done, failed: LCARS.red, working: LCARS.peach, queued: '#8d86a0' };

/** The counts as LCARS figures, right-aligned at `right`: done, failed, at work and queued (whichever there are). */
function counts(ctx: CanvasRenderingContext2D, c: Counts, right: number, y: number, size: number): void {
  ctx.font = `500 ${size}px ${LCARS_FONT}`;
  ctx.textAlign = 'right';
  let x = right;
  for (const [kind, label] of [['queued', 'queued'], ['working', 'at work'], ['failed', 'failed'], ['done', 'done']] as const) {
    if (!c[kind]) continue;
    const text = `${c[kind]} ${label}`.toUpperCase();
    ctx.fillStyle = COUNT_COLOUR[kind];
    ctx.fillText(text, x, y);
    x -= ctx.measureText(text).width + size * 0.7;
  }
}

/** The tactical display: the workflow, how it stands and its clock, a row per phase with its bar, and the totals. */
function drawTactical(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, s: TacticalSummary, description: string, room: number): void {
  const area = lcarsFrame(ctx, canvas.width, canvas.height, { title: `Transporter room ${room + 1} · operations`, color: LCARS.orange, seed: 7101 + room });
  ctx.textBaseline = 'middle';
  const right = area.x + area.w;

  // the workflow, how it stands and how long it's been going
  const pill = STATUS_PILL[s.status];
  ctx.font = `600 34px ${LCARS_FONT}`;
  const pillW = ctx.measureText(pill.text.toUpperCase()).width + 48;
  ctx.fillStyle = pill.colour;
  roundRect(ctx, right - pillW, area.y, pillW, 52, 26);
  ctx.fill();
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.fillText(pill.text.toUpperCase(), right - pillW / 2, area.y + 27);
  ctx.textAlign = 'right';
  ctx.fillStyle = LCARS.gold;
  ctx.font = `500 44px ${LCARS_FONT}`;
  ctx.fillText(`T+ ${s.elapsed}`, right - pillW - 28, area.y + 27);
  const clockW = ctx.measureText(`T+ ${s.elapsed}`).width;
  ctx.textAlign = 'left';
  ctx.fillStyle = LCARS.peach;
  ctx.font = `600 64px ${LCARS_FONT}`;
  ctx.fillText(fitText(ctx, s.name.toUpperCase(), area.w - pillW - clockW - 80), area.x, area.y + 26);
  ctx.fillStyle = LCARS.lilac;
  ctx.font = `500 30px ${LCARS_FONT}`;
  ctx.fillText(fitText(ctx, description, area.w), area.x, area.y + 82);

  // a row per phase
  const top = area.y + 130;
  const bottom = area.y + area.h - 70;
  const rowH = Math.min(84, (bottom - top) / Math.max(1, s.rows.length));
  const titleW = 300;
  const countsW = 330;
  const barX = area.x + 56 + titleW;
  const barW = area.w - 56 - titleW - countsW - 24;
  const most = Math.max(1, ...s.rows.map((r) => r.total));
  const barH = Math.min(36, rowH * 0.5);
  s.rows.forEach((row, i) => {
    const y = top + rowH * i + rowH / 2;
    const colour = LCARS[row.colour];
    ctx.fillStyle = colour;
    roundRect(ctx, area.x, y - barH / 2, 40, barH, barH / 2);
    ctx.fill();
    ctx.fillStyle = colour;
    ctx.textAlign = 'left';
    ctx.font = `600 ${Math.round(Math.min(44, rowH * 0.55))}px ${LCARS_FONT}`;
    const title = row.child && !row.title.startsWith('▸') ? `▸ ${row.title}` : row.title;
    ctx.fillText(fitText(ctx, title.toUpperCase(), titleW - 16), area.x + 56, y);
    // the bar: its whole length dim, then who's done, failed, at work and queued
    ctx.fillStyle = '#1d1a26';
    ctx.fillRect(barX, y - barH / 2, barW, barH);
    for (const seg of barSegments(row, most)) {
      ctx.fillStyle = seg.kind === 'done' ? LCARS_STATUS.done : seg.kind === 'failed' ? LCARS.red : colour;
      ctx.globalAlpha = seg.kind === 'queued' ? 0.3 : 1;
      ctx.fillRect(barX + seg.from * barW + 1, y - barH / 2, (seg.to - seg.from) * barW - 2, barH);
      ctx.globalAlpha = 1;
    }
    if (!row.total) {
      ctx.fillStyle = '#8d86a0';
      ctx.font = `500 26px ${LCARS_FONT}`;
      ctx.fillText('NOT YET REACHED', barX + 14, y + 1);
    }
    counts(ctx, row, right, y, Math.round(Math.min(30, rowH * 0.42)));
  });
  if (!s.rows.length) {
    ctx.fillStyle = LCARS.peach;
    ctx.font = `500 36px ${LCARS_FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText('LOCKING ON…', area.x, top + 40);
  }

  // the totals
  const y = area.y + area.h - 24;
  ctx.fillStyle = LCARS.orange;
  ctx.fillRect(area.x, y - 40, area.w, 4);
  ctx.textAlign = 'left';
  ctx.fillStyle = LCARS.orange;
  ctx.font = `600 36px ${LCARS_FONT}`;
  ctx.fillText(`${s.totals.total} AGENTS`, area.x, y);
  counts(ctx, s.totals, right, y, 34);
}

/** The pattern buffer's readout: how many are held, and a pattern for each in its phase's colour. */
function drawBuffer(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, held: { colour: string; n: number }[]): void {
  const total = held.reduce((n, h) => n + h.n, 0);
  const area = lcarsFrame(ctx, canvas.width, canvas.height, { title: 'Pattern buffer', color: LCARS.lilac, seed: 7103 });
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = total ? LCARS.peach : LCARS.lilac;
  ctx.font = `600 34px ${LCARS_FONT}`;
  ctx.fillText(bufferLine(total).toUpperCase(), area.x, area.y + 14);
  // a dot per pattern held, as many as fit, the rest counted
  const cols = 12;
  const step = area.w / cols;
  const r = step * 0.32;
  const rows = Math.max(1, Math.floor((area.h - 50) / step));
  const fits = cols * rows;
  let i = 0;
  for (const h of held) {
    for (let k = 0; k < h.n && i < fits; k++, i++) {
      const x = area.x + (i % cols) * step + step / 2;
      const y = area.y + 50 + Math.floor(i / cols) * step + step / 2;
      ctx.fillStyle = h.colour;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (total > fits) {
    ctx.fillStyle = LCARS.peach;
    ctx.textAlign = 'right';
    ctx.font = `500 26px ${LCARS_FONT}`;
    ctx.fillText(`+${total - fits}`, area.x + area.w, area.y + 14);
  }
}
