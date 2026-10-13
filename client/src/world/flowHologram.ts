import * as THREE from 'three';
import type { Workflow } from '../../../shared/types';
import { canvasTexture, fitText, makeCanvas, roundRect } from './canvas';
import { flowPrefs } from './flowPrefs';
import { OVERLAY_LAYER } from './frame';
import { fadeTexture, HOLO_CYAN, Hologram } from './hologram';
import { LCARS, LCARS_FONT, LCARS_STATUS } from './starship';
import { beamOpacity, elapsed, type FlowNode, flowNodes } from './workflowRooms';

// The flow of a workflow's script, hanging in the air between the transporter console and the platform, in the
// holograms' navy glass (hologram.ts): its phases as nodes in a row, in their colours, glowing while they've agents at
// work, then where it returns to the lead. A faint beam runs down from each phase at work to each of its agents on the pads; as an agent finishes, a spark
// of light rises from its pad into its phase (green, or red if it failed), and when the workflow's over one beams up out
// of the return, towards the briefing room. What the nodes say is drawn on the hologram when it changes; the beams,
// sparks and glows round the nodes at work move every frame, all on OVERLAY_LAYER. The viewer can switch it off from the
// console's screen (flowPrefs.ts).

/** The hologram's size (m), and the canvas drawn on it. */
const SIZE = { w: 2.8, h: 0.8 };
const CANVAS = { w: 1400, h: 400 };
/** How far up the canvas the nodes sit (0 top, 1 bottom), and how big they are (canvas px). */
const NODE_V = 0.42;
const NODE_R = 34;
/** The hologram's inset round its drawing, in its heights (hologram.ts: HOLO_PAD). */
const HOLO_PAD = 0.045;
/** How long a spark takes to rise from a pad to its node, and to beam out of the return (s). */
const SPARK_S = 1.1;
const RETURN_S = 1.6;
/** The captain's eye height, which it tips down to face (m). */
const EYE = 1.6;
/** How high over a pad a beam ends: about an agent's chest (m). */
const CHEST = 1.15;

const FINISHED = { done: LCARS_STATUS.done, failed: '#ff6a6a' };

/** A spark on its way: from where to where, when it set off and how long it takes. */
interface Spark {
  sprite: THREE.Sprite;
  from: THREE.Vector3;
  to: THREE.Vector3;
  start: number;
  seconds: number;
  /** The node it lights as it arrives, if any. */
  node?: number;
}

export class FlowHologram {
  /** All of it, in world coordinates; hidden while there's no workflow. */
  readonly group = new THREE.Group();
  /** The hologram's panel: E on it reads the script. */
  readonly panel: THREE.Mesh;
  private readonly hologram: Hologram;
  private readonly canvas = makeCanvas(CANVAS.w, CANVAS.h);
  private readonly texture = canvasTexture(this.canvas.canvas);
  private key = '';
  private nodes: FlowNode[] = [];
  /** A glow round each node, pulsing while its phase is at work and flaring as a spark arrives. */
  private readonly glows: THREE.Sprite[] = [];
  private readonly flare: number[] = [];
  private readonly beams: THREE.Mesh[] = [];
  private readonly beamGeometry = new THREE.CylinderGeometry(0.006, 0.022, 1, 8, 1, true).translate(0, 0.5, 0);
  private sparks: Spark[] = [];
  private readonly idleSparks: THREE.Sprite[] = [];
  /** 0 gone, 1 there: fades in with a workflow and out once it's gone. */
  private presence = 0;
  private present = false;
  private readonly tmp = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(
    /** Where its middle hangs (world), and where it faces: where the captain arrives (on the floor). */
    at: THREE.Vector3,
    facing: THREE.Vector3,
  ) {
    this.hologram = new Hologram(this.texture, SIZE.w / SIZE.h);
    this.hologram.material.side = THREE.DoubleSide;
    this.panel = new THREE.Mesh(new THREE.PlaneGeometry(SIZE.w, SIZE.h), this.hologram.material);
    this.panel.position.copy(at);
    // tipped down towards the captain's eyes, so it reads face on from where they arrive
    this.panel.lookAt(facing.x, EYE, facing.z);
    this.panel.layers.set(OVERLAY_LAYER);
    this.panel.renderOrder = 9;
    this.panel.userData.aim = (on: boolean) => (this.hologram.aimed = on);
    this.group.add(this.panel);
    this.group.visible = false;
    this.group.updateMatrixWorld(true);
  }

  /** Where a point on the canvas (px) is in the world, as the hologram's inset drawing puts it. */
  private worldAt(px: number, py: number, out: THREE.Vector3): THREE.Vector3 {
    const halfX = SIZE.w / SIZE.h / 2 - HOLO_PAD;
    const halfY = 0.5 - HOLO_PAD;
    out.set((px / CANVAS.w - 0.5) * 2 * halfX * SIZE.h, (0.5 - py / CANVAS.h) * 2 * halfY * SIZE.h, 0.01);
    return this.panel.localToWorld(out);
  }

  private nodeAt(i: number, out: THREE.Vector3): THREE.Vector3 {
    return this.worldAt((this.nodes[i]?.x ?? 0.5) * CANVAS.w, NODE_V * CANVAS.h, out);
  }

  /** The workflow it shows, or none: it fades in or out. */
  show(wf: Workflow | undefined, endedAt: number | undefined): void {
    this.present = !!wf;
    if (!wf) return;
    const before = this.nodes;
    this.nodes = flowNodes(wf);
    // the return beams out once, as the workflow ends
    const ret = this.nodes.length - 1;
    const was = before.at(-1)?.state;
    const now = this.nodes[ret]?.state;
    if (before.length && was === 'waiting' && now && now !== 'waiting') {
      const from = this.nodeAt(ret, new THREE.Vector3());
      this.spark(from, from.clone().add(new THREE.Vector3(0, 1.6, 0)), now === 'done' ? LCARS.gold : LCARS.red, RETURN_S);
      this.flare[ret] = 1;
    }
    this.syncGlows();
    this.draw(wf, endedAt);
  }

  /** A finished agent's result rising from where it stands into its phase's node. */
  rise(phase: number, from: THREE.Vector3, status: 'done' | 'failed'): void {
    if (!flowPrefs.on) return;
    const node = this.nodes.findIndex((n) => n.index === phase);
    if (node < 0) return;
    this.spark(from.clone().setY(from.y + CHEST), this.nodeAt(node, new THREE.Vector3()), FINISHED[status], SPARK_S, node);
  }

  private spark(from: THREE.Vector3, to: THREE.Vector3, colour: string, seconds: number, node?: number): void {
    const sprite = this.idleSparks.pop() ?? this.makeSprite(0.16);
    sprite.material.color.set(colour);
    sprite.position.copy(from);
    sprite.visible = true;
    this.group.add(sprite);
    this.sparks.push({ sprite, from, to, start: performance.now() / 1000, seconds, node });
  }

  private makeSprite(size: number): THREE.Sprite {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: fadeTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    sprite.scale.setScalar(size);
    sprite.layers.set(OVERLAY_LAYER);
    sprite.renderOrder = 10;
    return sprite;
  }

  /** A glow for each node, where it sits. */
  private syncGlows(): void {
    while (this.glows.length < this.nodes.length) {
      const glow = this.makeSprite(0.3);
      this.glows.push(glow);
      this.flare.push(0);
      this.group.add(glow);
    }
    this.glows.forEach((glow, i) => {
      glow.visible = i < this.nodes.length;
      if (glow.visible) this.nodeAt(i, glow.position);
    });
  }

  /**
   * Moves it on: `t` seconds, `dt` since the last frame, and `working` the agents at work on the pads, each with its
   * phase and where it stands, for the beams.
   */
  update(t: number, dt: number, working: { phase: number; at: THREE.Vector3 }[]): void {
    const wanted = this.present && flowPrefs.on;
    this.presence = THREE.MathUtils.clamp(this.presence + (wanted ? dt : -dt) / 0.6, 0, 1);
    this.group.visible = this.presence > 0;
    if (!this.group.visible) return;
    this.hologram.update(dt);
    this.hologram.material.opacity = this.presence;
    this.hologram.tint.set(HOLO_CYAN);

    // a glow round each node at work, breathing, and flaring as a spark lands
    this.nodes.forEach((node, i) => {
      const glow = this.glows[i];
      if (!glow) return;
      this.flare[i] = Math.max(0, (this.flare[i] ?? 0) - dt * 2);
      const base = node.working > 0 ? 0.45 + 0.25 * Math.sin(t * 3 + i) : node.index === -1 && node.state !== 'waiting' ? 0.5 : 0;
      glow.material.color.set(node.index === -1 && node.state === 'failed' ? LCARS.red : LCARS[node.colour]);
      glow.material.opacity = Math.min(1, base + (this.flare[i] ?? 0)) * this.presence;
      glow.scale.setScalar(0.3 + 0.25 * (this.flare[i] ?? 0));
    });

    // a beam from each phase at work down to each of its agents
    const shown = working.filter((w) => this.nodes.some((n) => n.index === w.phase));
    const perPhase = new Map<number, number>();
    for (const w of shown) perPhase.set(w.phase, (perPhase.get(w.phase) ?? 0) + 1);
    shown.forEach((w, k) => {
      const beam = this.beams[k] ?? this.makeBeam();
      const node = this.nodes.findIndex((n) => n.index === w.phase);
      const from = this.nodeAt(node, this.tmp);
      const to = w.at.clone().setY(w.at.y + CHEST);
      const dir = to.sub(from);
      beam.position.copy(from);
      beam.scale.set(1, dir.length(), 1);
      beam.quaternion.setFromUnitVectors(this.up, dir.normalize());
      const mat = beam.material as THREE.MeshBasicMaterial;
      mat.color.set(LCARS[this.nodes[node]?.colour ?? 'sky']);
      mat.opacity = beamOpacity(perPhase.get(w.phase) ?? 1) * (0.8 + 0.2 * Math.sin(t * 4 + k)) * this.presence;
      beam.visible = true;
    });
    for (let k = shown.length; k < this.beams.length; k++) this.beams[k].visible = false;

    // the sparks: rising in a gentle arc, fading in and out, and lighting their node as they land
    const now = performance.now() / 1000;
    this.sparks = this.sparks.filter((s) => {
      const p = (now - s.start) / s.seconds;
      if (p >= 1) {
        if (s.node !== undefined) this.flare[s.node] = 1;
        s.sprite.visible = false;
        s.sprite.removeFromParent();
        this.idleSparks.push(s.sprite);
        return false;
      }
      const e = p * p * (3 - 2 * p);
      s.sprite.position.lerpVectors(s.from, s.to, e);
      s.sprite.position.y += Math.sin(p * Math.PI) * 0.25;
      s.sprite.material.opacity = Math.min(1, Math.sin(p * Math.PI) * 1.6) * this.presence;
      return true;
    });
  }

  private makeBeam(): THREE.Mesh {
    const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide });
    const beam = new THREE.Mesh(this.beamGeometry, mat);
    beam.layers.set(OVERLAY_LAYER);
    beam.renderOrder = 8;
    this.beams.push(beam);
    this.group.add(beam);
    return beam;
  }

  /** What the hologram says: the workflow and its clock, then each node with what it's for and how it stands. */
  private draw(wf: Workflow, endedAt: number | undefined): void {
    const clock = elapsed((endedAt ?? Date.now()) - wf.startedAt);
    const key = JSON.stringify([wf.name, clock, this.nodes]);
    if (key === this.key) return;
    this.key = key;
    const { ctx } = this.canvas;
    const { w, h } = CANVAS;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = HOLO_CYAN;
    ctx.font = `600 44px ${LCARS_FONT}`;
    ctx.fillText(fitText(ctx, wf.name.toUpperCase(), w * 0.7), 24, 40);
    ctx.textAlign = 'right';
    ctx.font = `500 38px ${LCARS_FONT}`;
    ctx.fillText(`T+ ${clock}`, w - 24, 40);

    const y = NODE_V * h;
    // the line through them: solid as far as the script has got, dashed beyond
    const reached = Math.max(0, ...this.nodes.map((n, i) => (n.state !== 'waiting' ? i : 0)));
    for (let i = 0; i < this.nodes.length - 1; i++) {
      const a = this.nodes[i].x * w + NODE_R;
      const b = this.nodes[i + 1].x * w - NODE_R;
      ctx.strokeStyle = HOLO_CYAN;
      ctx.lineWidth = 5;
      ctx.setLineDash(i < reached ? [] : [16, 12]);
      ctx.globalAlpha = i < reached ? 0.9 : 0.45;
      ctx.beginPath();
      ctx.moveTo(a, y);
      ctx.lineTo(b, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    const slot = w / this.nodes.length - 16;
    for (const node of this.nodes) {
      const x = node.x * w;
      const colour = node.index === -1 && node.state === 'failed' ? LCARS.red : LCARS[node.colour];
      ctx.beginPath();
      ctx.arc(x, y, NODE_R, 0, Math.PI * 2);
      if (node.state === 'waiting') {
        ctx.strokeStyle = colour;
        ctx.lineWidth = 5;
        ctx.globalAlpha = 0.6;
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = colour;
        ctx.fill();
        ctx.fillStyle = '#000000';
        ctx.textAlign = 'center';
        ctx.font = `600 36px ${LCARS_FONT}`;
        const inside = node.index === -1 ? (node.state === 'done' ? '✓' : '✗') : node.state === 'active' ? String(node.working || '…') : '✓';
        ctx.fillText(inside, x, y + 2);
      }
      ctx.textAlign = 'center';
      ctx.fillStyle = colour;
      ctx.font = `600 34px ${LCARS_FONT}`;
      ctx.fillText(fitText(ctx, node.title.toUpperCase(), slot), x, y + NODE_R + 34);
      ctx.fillStyle = '#c8d4f0';
      ctx.font = `500 26px ${LCARS_FONT}`;
      if (node.detail) ctx.fillText(fitText(ctx, node.detail, slot), x, y + NODE_R + 72);
      const status = node.index === -1 ? (node.state === 'waiting' ? 'to the lead' : node.state === 'done' ? 'returned' : 'failed')
        : node.back ? `${node.back} back${node.failed ? ` · ${node.failed} failed` : ''}` : node.state === 'waiting' ? 'not yet reached' : '';
      if (status) {
        ctx.fillStyle = node.failed ? LCARS.red : '#8aedff';
        ctx.fillText(fitText(ctx, status, slot), x, y + NODE_R + (node.detail ? 106 : 72));
      }
    }
    // a frame line under the title, as the probes' readouts have
    ctx.fillStyle = HOLO_CYAN;
    ctx.globalAlpha = 0.5;
    roundRect(ctx, 24, 72, w - 48, 3, 1.5);
    ctx.fill();
    ctx.globalAlpha = 1;
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    this.hologram.dispose();
    this.panel.geometry.dispose();
    this.beamGeometry.dispose();
    for (const beam of this.beams) (beam.material as THREE.Material).dispose();
    for (const s of [...this.glows, ...this.idleSparks, ...this.sparks.map((x) => x.sprite)]) s.material.dispose();
  }
}
