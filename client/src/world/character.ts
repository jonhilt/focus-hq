import * as THREE from 'three';
import { HELD_ICON, STATUS_ICON, statusLine } from '../../../shared/agentStatus';
import { UNIFORM } from '../../../shared/crew';
import type { Agent, AgentStatus, Avatar, Rank } from '../../../shared/types';
import { canvasTexture, fitText, makeCanvas } from './canvas';
import { Head, PIP_GOLD } from './head';
import { toon } from './materials';
import { keyboardPose, type Pose, type PoseInput, paddPose } from './pose';
import { ball, capsule, cyl, padd, PADD_WIDTH } from './props';
import { LCARS, LCARS_FONT, LCARS_STATUS } from './starship';
import { OVERLAY_LAYER } from './frame';
import { mergeStatic } from './merge';

/** The jumpsuit: black, with the division's colour across the shoulders. */
const SUIT = '#32363f';

/** How far along an arm's +X its hand sits. */
const REACH = 0.34;

/** Arm made of a capsule pointing along +X from its shoulder pivot. */
function arm(colour: string, skin: string): THREE.Group {
  const g = new THREE.Group();
  g.add(ball(0.085, colour));
  const upper = capsule(0.065, 0.22, SUIT);
  upper.rotation.z = Math.PI / 2;
  upper.position.x = 0.15;
  g.add(upper);
  const hand = ball(0.075, skin);
  hand.position.x = REACH;
  g.add(hand);
  // it moves as one: one draw call (merge.ts)
  mergeStatic(g);
  return g;
}

/** Faces +X, so it sits flat on a chest whose surface there points along `normal` (an angle round Y from +X towards -Z). */
function onChest(o: THREE.Object3D, y: number, normal: number, r = 0.205): THREE.Object3D {
  o.position.set(Math.cos(normal) * r, y, -Math.sin(normal) * r);
  o.rotation.y = normal;
  return o;
}

/** The Starfleet delta on a silver oval, worn on the left breast. */
function combadge(): THREE.Group {
  const g = new THREE.Group();
  const oval = cyl(0.03, 0.03, 0.014, '#c9ced6', 20);
  oval.rotation.z = Math.PI / 2;
  oval.scale.set(1, 1, 1.6);
  g.add(oval);
  const delta = new THREE.Shape();
  delta.moveTo(0, 0.05);
  delta.lineTo(0.026, -0.036);
  delta.lineTo(0, -0.02);
  delta.lineTo(-0.026, -0.036);
  delta.closePath();
  const arrow = new THREE.Mesh(new THREE.ExtrudeGeometry(delta, { depth: 0.012, bevelEnabled: false }), toon(PIP_GOLD));
  arrow.rotation.y = Math.PI / 2;
  arrow.position.x = 0.002;
  g.add(arrow);
  return g;
}

/** Rank pips on the right of the collar. */
function pips(rank: Rank): THREE.Object3D[] {
  const count = rank === 'ensign' ? 1 : 2;
  return Array.from({ length: count }, (_, i) => onChest(ball(0.022, PIP_GOLD, 10), 0.93, -0.45 - i * 0.26, 0.2));
}

/** What a character shows: an agent at their desk, or a permanent crew member like the operations officer at Ops. */
export interface CrewView {
  name: string;
  avatar: Avatar;
  /** Picks the pose and the bubble's colours. */
  status: AgentStatus;
  /** The speech bubble's second line. */
  line: string;
  /** Right of the name on the bubble, e.g. "#12". */
  tag?: string;
  /** Replaces the status icon on the bubble. */
  icon?: string;
  /** Hand on chin. */
  thinking?: boolean;
}

export function agentView(agent: Agent): CrewView {
  return {
    name: agent.name,
    avatar: agent.avatar,
    status: agent.status,
    line: statusLine(agent),
    icon: agent.held ? HELD_ICON : undefined,
    tag: agent.task === 'lead' ? 'Lead' : `#${agent.issue.number}`,
    thinking: agent.activity === 'Thinking…',
  };
}

/** What a seated character works with: a workstation's touch panel in front of them, or a PADD in their hands. */
export type Grip = 'keyboard' | 'padd';
type Hands = { grip: 'keyboard' } | { grip: 'padd'; padd: THREE.Group };

/** The left hand holds a PADD by its lower-left corner. */
const PADD_GRIP = new THREE.Vector3(0, 0.1, PADD_WIDTH / 2);
const tmpHand = new THREE.Vector3();
const tmpGrip = new THREE.Vector3();

/** A chibi Starfleet crew member sitting on a chair, facing +X. */
export class Character {
  readonly group = new THREE.Group();
  private body: THREE.Group;
  private head: Head;
  private armL: THREE.Group;
  private armR: THREE.Group;
  private bubble: THREE.Sprite;
  private bubbleCanvas = makeCanvas(640, 180);
  private bubbleTex: THREE.CanvasTexture;
  private bubbleKey = '';
  private phase = Math.random() * 10;
  private celebrateUntil = 0;
  private lastStatus: AgentStatus | null = null;
  private hands: Hands;

  constructor(
    private view: CrewView,
    grip: Grip = 'keyboard',
  ) {
    const { division, rank, skin } = view.avatar;
    const colour = UNIFORM[division];

    this.body = new THREE.Group();
    this.group.add(this.body);
    const torso = capsule(0.2, 0.18, SUIT);
    torso.position.y = 0.78;
    this.body.add(torso);
    const yoke = new THREE.Mesh(new THREE.SphereGeometry(0.207, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), toon(colour));
    yoke.position.y = 0.87;
    this.body.add(yoke);
    this.body.add(onChest(combadge(), 0.88, 0.5, 0.214), ...pips(rank));
    // legs: thighs forward on the seat, shins down
    for (const s of [-1, 1]) {
      const thigh = capsule(0.085, 0.26, SUIT);
      thigh.rotation.z = Math.PI / 2;
      thigh.position.set(0.2, 0.55, s * 0.1);
      this.body.add(thigh);
      const shin = capsule(0.075, 0.3, SUIT);
      shin.position.set(0.4, 0.3, s * 0.1);
      this.body.add(shin);
      const boot = ball(0.09, '#1f2228');
      boot.scale.set(1.4, 0.6, 1);
      boot.position.set(0.46, 0.06, s * 0.1);
      this.body.add(boot);
    }

    this.head = new Head(view.avatar);
    this.head.group.position.y = 1.27;
    this.body.add(this.head.group);

    this.armL = arm(colour, skin);
    this.armL.position.set(0.02, 0.95, -0.25);
    this.armR = arm(colour, skin);
    this.armR.position.set(0.02, 0.95, 0.25);
    this.body.add(this.armL, this.armR);
    switch (grip) {
      case 'keyboard':
        this.hands = { grip };
        break;
      case 'padd':
        this.hands = { grip, padd: padd() };
        this.body.add(this.hands.padd);
        break;
    }

    // the torso, legs and badges are a draw call each until merged: the head and arms move, and the PADD with them
    mergeStatic(this.body, [this.head.group, this.armL, this.armR, ...(this.hands.grip === 'padd' ? [this.hands.padd] : [])]);

    // soft blob shadow
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.45, 24),
      new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.15, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.012;
    this.group.add(shadow);

    this.bubbleTex = canvasTexture(this.bubbleCanvas.canvas);
    this.bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.bubbleTex, depthWrite: false, transparent: true }));
    this.bubble.scale.set(1.75, 0.49, 1);
    this.bubble.position.set(0, 1.95, 0);
    this.bubble.renderOrder = 10;
    this.bubble.layers.set(OVERLAY_LAYER);
    this.group.add(this.bubble);
    this.set(view);
  }

  set(view: CrewView): void {
    if (this.lastStatus && this.lastStatus !== 'done' && view.status === 'done') this.celebrateUntil = performance.now() + 3500;
    this.lastStatus = view.status;
    this.view = view;
    this.drawBubble();
  }

  private drawBubble(): void {
    const view = this.view;
    const color = LCARS_STATUS[view.status];
    const text = view.line;
    const key = `${view.name}|${view.status}|${text}|${view.tag}|${view.icon}`;
    if (key === this.bubbleKey) return;
    this.bubbleKey = key;
    const { canvas, ctx } = this.bubbleCanvas;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    // an LCARS readout: a status-coloured cap, a black plate with a rail along the top, and a tail
    const plateH = h - 40;
    const capW = 44;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(6, 6, capW, plateH, [plateH / 2, 0, 0, plateH / 2]);
    ctx.fill();
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.roundRect(capW + 12, 6, w - capW - 18, plateH, [0, 24, 24, 0]);
    ctx.moveTo(w / 2 - 22, plateH + 4);
    ctx.lineTo(w / 2, h - 6);
    ctx.lineTo(w / 2 + 22, plateH + 4);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillRect(capW + 12, 6, (w - capW - 18) * 0.45, 8);

    const tx = capW + 32;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = LCARS.peach;
    ctx.font = `600 46px ${LCARS_FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText(`${view.icon ?? STATUS_ICON[view.status]} ${view.name.toUpperCase()}`, tx, 56);
    ctx.fillStyle = color;
    ctx.font = `600 34px ${LCARS_FONT}`;
    ctx.textAlign = 'right';
    if (view.tag) ctx.fillText(view.tag.toUpperCase(), w - 34, 58);
    ctx.textAlign = 'left';
    ctx.font = `500 36px ${LCARS_FONT}`;
    ctx.fillText(fitText(ctx, text, w - tx - 34), tx, 108);
    this.bubbleTex.needsUpdate = true;
  }

  /** dist = camera distance, used to fade the speech bubble when you look over their shoulder. */
  update(t: number, dist = 10): void {
    const s = this.view.status;
    const p = t + this.phase;
    const input: PoseInput = {
      status: s,
      thinking: this.view.thinking ?? false,
      celebrating: performance.now() < this.celebrateUntil,
      p,
    };
    let bodyY: number;
    switch (this.hands.grip) {
      case 'keyboard':
        bodyY = this.strike(keyboardPose(input), p);
        break;
      case 'padd': {
        const pose = paddPose(input);
        bodyY = this.strike(pose, p);
        this.holdPadd(this.hands.padd, pose.lean);
        break;
      }
    }

    // bubble bob, and pulse when the hand is up
    this.bubble.position.y = 1.95 + Math.sin(p * 2) * 0.03 + bodyY;
    const pulse = s === 'waiting' ? 1 + Math.sin(p * 8) * 0.06 : 1;
    this.bubble.scale.set(1.75 * pulse, 0.49 * pulse, 1);
    // gone by the time you're looking over their shoulder (2.2 m from their feet), but not as you walk into the room
    const fade = Math.min(1, Math.max(0, (dist - 2.3) / 0.7));
    this.bubble.material.opacity = fade;
    this.bubble.visible = fade > 0.02;
  }

  /** Puts the arms, head, body and face in the pose; returns how high the body has bounced. */
  private strike({ armL, armR, headTilt, headTurn, bodyY, expression }: Pose, p: number): number {
    this.armL.rotation.set(armL.x, armL.y, armL.z);
    this.armR.rotation.set(armR.x, armR.y, armR.z);
    this.head.group.rotation.set(0, headTurn, headTilt);
    this.body.position.y = bodyY;
    this.body.scale.y = 1 + Math.sin(p * 2.2) * 0.008;

    // the face follows the pose, blinking now and then
    this.head.express(expression, (p % 4.3) < 0.12);
    return bodyY;
  }

  /** Puts the PADD in the left hand, leaning back from upright so its screen faces the eyes. */
  private holdPadd(pad: THREE.Group, lean: number): void {
    this.armL.updateMatrix();
    tmpHand.set(REACH, 0, 0).applyMatrix4(this.armL.matrix);
    pad.rotation.set(0, 0, -lean);
    pad.position.copy(tmpHand).add(tmpGrip.copy(PADD_GRIP).applyEuler(pad.rotation));
  }

  dispose(): void {
    this.bubbleTex.dispose();
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
  }
}
