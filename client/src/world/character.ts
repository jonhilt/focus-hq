import * as THREE from 'three';
import type { Agent, AgentStatus, Avatar } from '../../../shared/types';
import { canvasTexture, fitText, makeCanvas, roundRect, UI_FONT } from './canvas';
import { darken, toon } from './materials';
import { ball, cyl } from './props';

const capsule = (r: number, len: number, color: string) => new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 12), toon(color));

/** Arm made of a capsule pointing along +X from its shoulder pivot. */
function arm(shirt: string, skin: string): THREE.Group {
  const g = new THREE.Group();
  const upper = capsule(0.065, 0.22, shirt);
  upper.rotation.z = Math.PI / 2;
  upper.position.x = 0.15;
  g.add(upper);
  const hand = ball(0.075, skin);
  hand.position.x = 0.34;
  g.add(hand);
  return g;
}

const STATUS_STYLE: Record<AgentStatus, { icon: string; bg: string; fg: string }> = {
  queued: { icon: '⏳', bg: '#e9ecef', fg: '#343a40' },
  'setting-up': { icon: '📦', bg: '#e7f5ff', fg: '#1864ab' },
  working: { icon: '⌨️', bg: '#ffffff', fg: '#212529' },
  testing: { icon: '🧪', bg: '#f3f0ff', fg: '#5f3dc4' },
  waiting: { icon: '✋', bg: '#ffe066', fg: '#5c3c00' },
  pushing: { icon: '🚀', bg: '#e6fcf5', fg: '#087f5b' },
  done: { icon: '✅', bg: '#d3f9d8', fg: '#2b8a3e' },
  error: { icon: '❗', bg: '#ffe3e3', fg: '#c92a2a' },
  stopped: { icon: '💤', bg: '#dee2e6', fg: '#495057' },
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

/** A chibi office worker sitting on a chair, facing +X. */
export class Character {
  readonly group = new THREE.Group();
  private body: THREE.Group;
  private head: THREE.Group;
  private armL: THREE.Group;
  private armR: THREE.Group;
  private eyes: THREE.Group[] = [];
  private bubble: THREE.Sprite;
  private bubbleCanvas = makeCanvas(640, 180);
  private bubbleTex: THREE.CanvasTexture;
  private bubbleKey = '';
  private phase = Math.random() * 10;
  private celebrateUntil = 0;
  private lastStatus: AgentStatus | null = null;

  constructor(private view: CrewView) {
    const { shirt, skin, hair, accessory } = view.avatar;

    this.body = new THREE.Group();
    this.group.add(this.body);
    const torso = capsule(0.2, 0.18, shirt);
    torso.position.y = 0.78;
    this.body.add(torso);
    // legs: thighs forward on the seat, shins down
    for (const s of [-1, 1]) {
      const thigh = capsule(0.085, 0.26, darken(shirt, 0.45));
      thigh.rotation.z = Math.PI / 2;
      thigh.position.set(0.2, 0.55, s * 0.1);
      this.body.add(thigh);
      const shin = capsule(0.075, 0.3, darken(shirt, 0.45));
      shin.position.set(0.4, 0.3, s * 0.1);
      this.body.add(shin);
      const shoe = ball(0.09, '#343a40');
      shoe.scale.set(1.4, 0.6, 1);
      shoe.position.set(0.46, 0.06, s * 0.1);
      this.body.add(shoe);
    }

    this.head = new THREE.Group();
    this.head.position.y = 1.22;
    this.body.add(this.head);
    this.head.add(ball(0.25, skin, 20));
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.265, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.52), toon(hair));
    hairCap.rotation.z = 0.35;
    hairCap.position.set(-0.02, 0.02, 0);
    this.head.add(hairCap);

    for (const s of [-1, 1]) {
      const eye = new THREE.Group();
      eye.position.set(0.2, 0.04, s * 0.09);
      const white = ball(0.06, '#ffffff', 12);
      white.scale.set(0.7, 1, 1);
      eye.add(white);
      const pupil = ball(0.034, '#1b1b1b', 10);
      pupil.position.x = 0.035;
      eye.add(pupil);
      this.head.add(eye);
      this.eyes.push(eye);
      const blush = ball(0.04, '#ff8fab', 8);
      blush.scale.set(0.4, 0.6, 1);
      blush.position.set(0.205, -0.07, s * 0.16);
      this.head.add(blush);
    }
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 6, 12, Math.PI), toon('#7a2e2e'));
    mouth.rotation.set(0, Math.PI / 2, Math.PI);
    mouth.position.set(0.235, -0.07, 0);
    this.head.add(mouth);
    this.addAccessory(accessory, hair);

    this.armL = arm(shirt, skin);
    this.armL.position.set(0.02, 0.95, -0.25);
    this.armR = arm(shirt, skin);
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

  private addAccessory(kind: Avatar['accessory'], hair: string): void {
    if (kind === 'glasses') {
      for (const s of [-1, 1]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.013, 6, 16), toon('#222'));
        ring.rotation.y = Math.PI / 2;
        ring.position.set(0.245, 0.04, s * 0.09);
        this.head.add(ring);
      }
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.012, 0.05), toon('#222'));
      bridge.position.set(0.25, 0.05, 0);
      this.head.add(bridge);
    } else if (kind === 'headphones') {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.025, 6, 20, Math.PI), toon('#ff006e'));
      band.position.y = 0.0;
      this.head.add(band);
      band.rotation.y = Math.PI / 2;
      for (const s of [-1, 1]) {
        const cup = cyl(0.09, 0.09, 0.07, '#ff006e');
        cup.rotation.x = Math.PI / 2;
        cup.position.set(0, 0, s * 0.27);
        this.head.add(cup);
      }
    } else if (kind === 'cap') {
      const color = darken(hair === '#1e1e1e' ? '#e63946' : '#3a86ff', 0);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.27, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.45), toon(color));
      dome.position.y = 0.04;
      this.head.add(dome);
      const brim = cyl(0.16, 0.16, 0.025, color);
      brim.scale.set(1.4, 1, 1);
      brim.position.set(0.22, 0.12, 0);
      this.head.add(brim);
    } else if (kind === 'bow') {
      for (const s of [-1, 1]) {
        const loop = ball(0.07, '#ff4d6d', 10);
        loop.scale.set(0.6, 0.8, 1.3);
        loop.position.set(-0.02, 0.25, s * 0.08 + 0.12);
        this.head.add(loop);
      }
    }
  }

  set(view: CrewView): void {
    if (this.lastStatus && this.lastStatus !== 'done' && view.status === 'done') this.celebrateUntil = performance.now() + 3500;
    this.lastStatus = view.status;
    this.view = view;
    this.drawBubble();
  }

  private drawBubble(): void {
    const view = this.view;
    const style = STATUS_STYLE[view.status];
    const text = view.line;
    const key = `${view.name}|${view.status}|${text}|${view.tag}|${view.icon}`;
    if (key === this.bubbleKey) return;
    this.bubbleKey = key;
    const { canvas, ctx } = this.bubbleCanvas;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    // speech bubble body + tail
    ctx.fillStyle = style.bg;
    ctx.strokeStyle = '#1b1b1b';
    ctx.lineWidth = 7;
    roundRect(ctx, 6, 6, w - 12, h - 40, 34);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(w / 2 - 22, h - 37);
    ctx.lineTo(w / 2, h - 6);
    ctx.lineTo(w / 2 + 22, h - 37);
    ctx.fill();
    ctx.stroke();
    ctx.fillRect(w / 2 - 19, h - 44, 38, 10);

    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#1b1b1b';
    ctx.font = `700 46px ${UI_FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText(`${view.icon ?? style.icon} ${view.name}`, 30, 52);
    ctx.fillStyle = style.fg;
    ctx.globalAlpha = 0.8;
    ctx.font = `600 34px ${UI_FONT}`;
    ctx.textAlign = 'right';
    if (view.tag) ctx.fillText(view.tag, w - 30, 54);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
    ctx.font = `500 34px ${UI_FONT}`;
    ctx.fillText(fitText(ctx, text, w - 60), 30, 104);
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

    if (s === 'working' || s === 'setting-up' || s === 'pushing') {
      lz += Math.sin(p * 17) * 0.1;
      rz += Math.sin(p * 17 + 2) * 0.1;
      headTilt = Math.sin(p * 2) * 0.04;
      if (thinking) {
        rz = 0.25;
        rx = -0.5;
        headTilt = 0.15;
        headTurn = Math.sin(p) * 0.15;
      }
    } else if (s === 'testing') {
      lz += Math.sin(p * 6) * 0.06;
      rz += Math.sin(p * 9) * 0.08;
      headTurn = Math.sin(p * 0.8) * 0.12;
    } else if (s === 'waiting') {
      rz = 1.35 + Math.sin(p * 9) * 0.15;
      rx = 0.2;
      bodyY = Math.abs(Math.sin(p * 4)) * 0.04;
      headTurn = -0.5;
      headTilt = 0.15;
    } else if (s === 'done') {
      lz = -1.1;
      rz = -1.1;
      headTilt = 0.12;
      if (now < this.celebrateUntil) {
        lz = rz = 1.2 + Math.sin(p * 14) * 0.2;
        bodyY = Math.abs(Math.sin(p * 9)) * 0.18;
      }
    } else if (s === 'error') {
      lz = rz = -1.2;
      headTilt = -0.35;
    } else if (s === 'stopped' || s === 'queued') {
      lz = rz = -1.15;
      headTilt = s === 'stopped' ? -0.25 + Math.sin(p * 1.2) * 0.04 : Math.sin(p * 0.7) * 0.05;
      headTurn = s === 'queued' ? Math.sin(p * 0.5) * 0.4 : 0;
    }

    this.armL.rotation.set(lx, 0.15, lz);
    this.armR.rotation.set(rx, -0.15, rz);
    this.head.rotation.set(0, headTurn, headTilt);
    this.body.position.y = bodyY;
    this.body.scale.y = 1 + Math.sin(p * 2.2) * 0.008;

    // blink
    const blink = (p % 4.3) < 0.12 ? 0.1 : 1;
    for (const eye of this.eyes) eye.scale.y = s === 'stopped' ? 0.1 : blink;

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
