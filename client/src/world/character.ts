import * as THREE from 'three';
import { UNIFORM } from '../../../shared/crew';
import type { Agent, AgentStatus, Avatar, Rank } from '../../../shared/types';
import { canvasTexture, fitText, makeCanvas } from './canvas';
import { type Expression, Head, PIP_GOLD } from './head';
import { toon } from './materials';
import { ball, capsule, cyl } from './props';
import { LCARS, LCARS_FONT, LCARS_STATUS } from './starship';

/** The jumpsuit: black, with the division's colour across the shoulders. */
const SUIT = '#32363f';

/** Arm made of a capsule pointing along +X from its shoulder pivot. */
function arm(colour: string, skin: string): THREE.Group {
  const g = new THREE.Group();
  g.add(ball(0.085, colour));
  const upper = capsule(0.065, 0.22, SUIT);
  upper.rotation.z = Math.PI / 2;
  upper.position.x = 0.15;
  g.add(upper);
  const hand = ball(0.075, skin);
  hand.position.x = 0.34;
  g.add(hand);
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

const STATUS_ICON: Record<AgentStatus, string> = {
  queued: '⏳',
  'setting-up': '📦',
  working: '⌨️',
  testing: '🧪',
  waiting: '✋',
  pushing: '🚀',
  done: '✅',
  error: '❗',
  stopped: '💤',
};

export function statusLine(agent: Agent): string {
  switch (agent.status) {
    case 'waiting':
      return 'Needs your approval!';
    case 'done':
      return agent.pr ? `PR #${agent.pr.number} ready for review` : agent.activity;
    case 'error':
      return 'Hit a problem – come and look';
    case 'stopped':
      return 'Stopped';
    default:
      return agent.activity || agent.status;
  }
}

/** What a character shows: an agent at their desk, or a permanent crew member like the planner at the stand. */
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
    tag: `#${agent.issue.number}`,
    thinking: agent.activity === 'Thinking…',
  };
}

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

  constructor(private view: CrewView) {
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

    // soft blob shadow
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.45, 24),
      new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.15, depthWrite: false }),
    );
    shadow.material.userData.outlineParameters = { visible: false };
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.012;
    this.group.add(shadow);

    this.bubbleTex = canvasTexture(this.bubbleCanvas.canvas);
    this.bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.bubbleTex, depthWrite: false, transparent: true }));
    this.bubble.scale.set(1.75, 0.49, 1);
    this.bubble.position.set(0, 1.95, 0);
    this.bubble.renderOrder = 10;
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
    const now = performance.now();
    const thinking = this.view.thinking;

    // defaults: hands on the keyboard
    let lz = -0.42, rz = -0.42, lx = 0, rx = 0;
    let headTilt = 0, headTurn = 0, bodyY = 0;
    let expression: Expression = 'idle';

    if (s === 'working' || s === 'setting-up' || s === 'pushing') {
      lz += Math.sin(p * 17) * 0.1;
      rz += Math.sin(p * 17 + 2) * 0.1;
      headTilt = Math.sin(p * 2) * 0.04;
      expression = 'focused';
      if (thinking) {
        expression = 'thinking';
        rz = 0.25;
        rx = -0.5;
        headTilt = 0.15;
        headTurn = Math.sin(p) * 0.15;
      }
    } else if (s === 'testing') {
      lz += Math.sin(p * 6) * 0.06;
      rz += Math.sin(p * 9) * 0.08;
      headTurn = Math.sin(p * 0.8) * 0.12;
      expression = 'focused';
    } else if (s === 'waiting') {
      rz = 1.35 + Math.sin(p * 9) * 0.15;
      rx = 0.2;
      bodyY = Math.abs(Math.sin(p * 4)) * 0.04;
      headTurn = -0.5;
      headTilt = 0.15;
      expression = 'eager';
    } else if (s === 'done') {
      lz = -1.1;
      rz = -1.1;
      headTilt = 0.12;
      expression = 'happy';
      if (now < this.celebrateUntil) {
        expression = 'grin';
        lz = rz = 1.2 + Math.sin(p * 14) * 0.2;
        bodyY = Math.abs(Math.sin(p * 9)) * 0.18;
      }
    } else if (s === 'error') {
      lz = rz = -1.2;
      headTilt = -0.35;
      expression = 'worried';
    } else if (s === 'stopped' || s === 'queued') {
      lz = rz = -1.15;
      headTilt = s === 'stopped' ? -0.25 + Math.sin(p * 1.2) * 0.04 : Math.sin(p * 0.7) * 0.05;
      headTurn = s === 'queued' ? Math.sin(p * 0.5) * 0.4 : 0;
      if (s === 'stopped') expression = 'asleep';
    }

    this.armL.rotation.set(lx, 0.15, lz);
    this.armR.rotation.set(rx, -0.15, rz);
    this.head.group.rotation.set(0, headTurn, headTilt);
    this.body.position.y = bodyY;
    this.body.scale.y = 1 + Math.sin(p * 2.2) * 0.008;

    // the face follows the pose, blinking now and then
    this.head.express(expression, (p % 4.3) < 0.12);

    // bubble bob, and pulse when the hand is up
    this.bubble.position.y = 1.95 + Math.sin(p * 2) * 0.03 + bodyY;
    const pulse = s === 'waiting' ? 1 + Math.sin(p * 8) * 0.06 : 1;
    this.bubble.scale.set(1.75 * pulse, 0.49 * pulse, 1);
    const fade = Math.min(1, Math.max(0, (dist - 2.5) / 1.5));
    this.bubble.material.opacity = fade;
    this.bubble.visible = fade > 0.02;
  }

  dispose(): void {
    this.bubbleTex.dispose();
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
  }
}
