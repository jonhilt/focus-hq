import * as THREE from 'three';
import { helperFor } from '../../../shared/crew';
import type { AgentStatus } from '../../../shared/types';
import { canvasTexture, makeCanvas } from '../world/canvas';
import { Character, type CrewView } from '../world/character';
import { OVERLAY_LAYER } from '../world/frame';
import type { VacantHall } from '../world/room';
import { StationScreen } from '../world/screen';
import { LCARS, LCARS_FONT, workstation } from '../world/starship';
import { Beam } from '../world/transporter';
import { h } from './dom';

// The studio's holodeck stage (?studio=1&stage=delegation, docs/studio.md): an empty holodeck where only what a scene
// needs beams in, played from a timeline rather than demo mode, so it's the same every time and can be timed to a
// narration. A rough cut of "how Claude delegates", a rung at a time: one session alone, subagents, helpers with helpers
// of their own, a dynamic workflow's waves on transporter pads, /batch's lanes each ending in a pull request, and the
// ladder. Its labels (context gauges, jobs in flight, the workflow's script, pull requests) are sprites in the scene,
// as the crew's speech bubbles are, so they sit in the world and shrink with distance.

type V3 = [number, number, number];
const v = (p: V3) => new THREE.Vector3(...p);

/** The stage's green: answers coming back, and a context with room to spare. */
const GREEN = '#99cc66';
const ease = (k: number) => k * k * (3 - 2 * k);
const span = (t: number, a: number, b: number) => ease(Math.min(1, Math.max(0, (t - a) / (b - a))));

/**
 * A label in the scene: a canvas on a sprite in the overlay, so it always faces the camera, `metres` high. It redraws
 * only when what it shows (`key`) changes.
 */
class Tag {
  readonly sprite: THREE.Sprite;
  private readonly c: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D };
  private readonly texture: THREE.CanvasTexture;
  private key = '';

  constructor(w: number, hgt: number, metres: number) {
    this.c = makeCanvas(w, hgt);
    this.texture = canvasTexture(this.c.canvas);
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture, depthWrite: false, transparent: true, opacity: 0 }));
    this.sprite.scale.set((metres * w) / hgt, metres, 1);
    this.sprite.layers.set(OVERLAY_LAYER);
    this.sprite.visible = false;
  }

  draw(key: string, paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): void {
    if (key === this.key) return;
    this.key = key;
    const { canvas, ctx } = this.c;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'left';
    paint(ctx, canvas.width, canvas.height);
    this.texture.needsUpdate = true;
  }

  set opacity(o: number) {
    this.sprite.material.opacity = o;
    this.sprite.visible = o > 0.01;
  }
}

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, hgt: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, w, hgt, hgt / 2);
  ctx.fill();
}

/** A context gauge over a crew member's head: how full their context window is. */
function drawGauge(tag: Tag, fill: number): void {
  const pct = Math.round(Math.max(0, Math.min(1, fill)) * 100);
  tag.draw(`${pct}`, (ctx, w, hgt) => {
    pill(ctx, 2, 2, w - 4, hgt - 4, '#000000cc');
    const colour = pct > 70 ? LCARS.red : pct > 40 ? LCARS.gold : GREEN;
    pill(ctx, 12, hgt - 30, Math.max(22, ((w - 24) * pct) / 100), 18, colour);
    ctx.font = `600 30px ${LCARS_FONT}`;
    ctx.textBaseline = 'top';
    ctx.fillStyle = LCARS.peach;
    ctx.fillText('CONTEXT', 24, 8);
    ctx.textAlign = 'right';
    ctx.fillStyle = colour;
    ctx.fillText(`${pct}%`, w - 24, 8);
  });
}

function drawChip(tag: Tag, text: string, colour: string): void {
  tag.draw(text + colour, (ctx, w, hgt) => {
    ctx.font = `600 44px ${LCARS_FONT}`;
    const tw = Math.min(w - 8, ctx.measureText(text).width + 56);
    pill(ctx, (w - tw) / 2, 4, tw, hgt - 8, colour);
    ctx.fillStyle = '#000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, hgt / 2 + 2);
  });
}

/** A crew member at a console on the stage, and the context gauge over their head. */
interface Actor {
  console: THREE.Group;
  seat: THREE.Group;
  screen: StationScreen;
  character?: Character;
  view: CrewView;
  gauge: Tag;
  at: THREE.Vector3;
  /** How big their speech bubble is: smaller where the crew sit close together. */
  bubble: number;
}

/** One of the workflow's agents, standing on a transporter pad for its wave. */
interface Padder {
  character: Character;
  view: CrewView;
  leaving: boolean;
}

// where things stand on the stage (its own frame, metres): the camera's on the +X side looking towards -X, with -Z on
// the right of the picture; the crew face -Z-ish, side on to it
const YAW = -1.9;
const LEAD_AT: V3 = [1.0, 0, -2.6];
const HELPERS_AT: V3[] = [[-1.6, 0, -0.6], [-2.4, 0, 1.7], [-1.2, 0, 3.9]];
const NEST_AT: V3 = [-2.4, 0, 1.7];
const SUBS_AT: V3[] = [[-4.9, 0, 0.5], [-4.9, 0, 2.9]];
const PADS: V3[] = Array.from({ length: 16 }, (_, i) => [-0.9 - (i % 4), 0, 0.1 + Math.floor(i / 4)] as V3);
const SCRIPT_AT: V3 = [-6.0, 2.7, 1.6];
// /batch's lanes run across the picture, work flowing left to right (+Z to -Z) from each agent to its pull request
const LANES_X = [-1.2, -2.7, -4.2, -5.7, -7.2];
const LANE = { head: 4.2, from: 3.3, to: -4.0, card: -4.7, yaw: Math.PI / 2 };

const SOLO_TASKS = ['Read web/src/App.tsx', 'Read web/src/store/cart.ts', 'Read web/src/Header.tsx', 'Read api/src/routes.ts', 'Read api/src/orders.ts', 'Search "saved items"', 'Read api/src/auth.ts'];
const HELPER_JOBS = [
  { job: 'map ./web', reads: ['Read App.tsx', 'Read store/cart.ts', 'Read Header.tsx'], answer: 'web: fits in Header.tsx' },
  { job: 'map ./api', reads: ['Read routes.ts', 'Read orders.ts', 'Read auth.ts'], answer: 'api: add routes/saved.ts' },
  { job: 'find the tests', reads: ['Glob **/*.test.ts', 'Read cart.test.ts', 'Read orders.test.ts'], answer: 'tests: cart.test.ts covers it' },
];
const SUB_JOBS = [
  { job: 'check auth', answer: 'auth: tokens never expire' },
  { job: 'check orders', answer: 'orders: no rate limit' },
];
const WAVES = [{ start: 56 }, { start: 61 }, { start: 66 }];
const WAVE = { stagger: 0.05, work: 3.2, leave: 4.2 };
const LANE_JOBS = ['rename getUser', 'bump lodash', 'fix lint in api', 'add alt text', 'drop dead flags'];

/** Camera keyframes: where it is and what it looks at, `at` seconds in; it eases from one to the next. */
const SHOTS: { at: number; pos: V3; look: V3 }[] = [
  { at: 0, pos: [8.5, 2.6, 0.5], look: [1, 1, -2.6] },
  { at: 3, pos: [4.6, 1.8, -0.7], look: [0.8, 1.0, -2.6] },
  { at: 15.5, pos: [4.6, 1.8, -0.7], look: [0.8, 1.0, -2.6] },
  { at: 18.5, pos: [8.4, 3.8, 0.4], look: [-0.6, 1.0, 0.5] },
  { at: 29.5, pos: [8.4, 3.8, 0.4], look: [-0.6, 1.0, 0.5] },
  { at: 32.5, pos: [5.4, 2.2, -1.0], look: [0.6, 1.1, -2.6] },
  { at: 35, pos: [5.4, 2.2, -1.0], look: [0.6, 1.1, -2.6] },
  { at: 38, pos: [7.2, 6.4, 1.6], look: [-2.4, 0.4, 1.0] },
  { at: 50, pos: [7.2, 6.4, 1.6], look: [-2.4, 0.4, 1.0] },
  { at: 54, pos: [8.4, 5.2, 1.8], look: [-2.8, 0.55, 1.6] },
  { at: 69, pos: [8.4, 5.2, 1.8], look: [-2.8, 0.55, 1.6] },
  { at: 71.5, pos: [4.6, 1.8, -0.7], look: [0.8, 1.0, -2.6] },
  { at: 75, pos: [4.6, 1.8, -0.7], look: [0.8, 1.0, -2.6] },
  { at: 78, pos: [6.5, 8.6, 0.4], look: [-4.3, 0.2, 0.2] },
  { at: 90, pos: [6.5, 8.6, 0.4], look: [-4.3, 0.2, 0.2] },
  { at: 93, pos: [9.0, 4.0, 0.6], look: [-1.0, 0.9, 0.5] },
  { at: 104, pos: [8.2, 3.6, -1.4], look: [-1.0, 0.9, 0.2] },
];

/** The captions, as the timeline reaches them. */
const CAPTIONS: { at: number; title?: string; text?: string }[] = [
  { at: 0.5, title: 'How Claude delegates', text: 'Computer: show me how Claude gets work done.' },
  { at: 3.2, title: '1 · On its own', text: 'One session does everything itself, one step at a time.' },
  { at: 11, title: '1 · On its own', text: 'Every file it reads stays in its context window. It fills up.' },
  { at: 16, title: '2 · Subagents', text: 'Same job, with helpers: each one reads in a fresh context of its own.' },
  { at: 26.5, title: '2 · Subagents', text: 'Only their answers come back, so the lead stays light.' },
  { at: 35, title: '3 · Helpers with helpers', text: 'A helper can split its own job and start helpers of its own.' },
  { at: 44.5, title: '3 · Helpers with helpers', text: 'The lead still hears one answer, from the helper it asked.' },
  { at: 52, title: '4 · Dynamic workflows', text: 'For a big job, Claude writes a script, and the script runs a fleet.' },
  { at: 61.5, title: '4 · Dynamic workflows', text: 'Up to 16 agents at a time; the rest wait their turn. The plan lives in the script.' },
  { at: 70.5, title: '4 · Dynamic workflows', text: 'Claude only sees the results: 48 files migrated.' },
  { at: 76, title: '5 · /batch', text: 'Many separate changes at once, each agent in its own worktree…' },
  { at: 85, title: '5 · /batch', text: '…and each one ends in its own pull request, ready to review.' },
  { at: 92.5, title: 'The ladder', text: 'Start small; reach for more hands when the job is bigger than one context.' },
  { at: 104, title: undefined },
];

const RECAP = [
  { at: 93.5, rung: 'On its own', when: 'small, focused jobs' },
  { at: 95, rung: 'Subagents', when: 'reading and research in parallel, keeping the lead light' },
  { at: 96.5, rung: 'Nested helpers', when: 'a helper with a big job of its own' },
  { at: 98, rung: 'Dynamic workflows', when: 'big fan-out jobs: a script runs the fleet' },
  { at: 99.5, rung: '/batch', when: 'many independent changes, a pull request each' },
];

export const STAGE_SECONDS = 105;

export class HoloStage {
  private readonly group = new THREE.Group();
  private readonly overlay = h('div', { class: 'stage-overlay' });
  private readonly recap = h('div', { class: 'stage-recap' });
  private readonly lead: Actor;
  private readonly helpers: Actor[];
  private readonly nest: Actor;
  private readonly subs: Actor[];
  private readonly lanes: Actor[];
  private readonly beams: Beam[] = [];
  private readonly fired = new Set<string>();
  private readonly chips = new Map<string, Tag>();
  private readonly queue = new Tag(560, 470, 1.35);
  private readonly script = new Tag(1000, 620, 1.9);
  private readonly cards: Tag[];
  private readonly strips = new Map<string, THREE.Mesh>();
  private readonly pads: THREE.Mesh[] = [];
  private readonly padders = new Map<string, Padder>();
  /** When the timeline started (performance.now()), or null until it's played. */
  private start: number | null = null;
  private readonly tmp = new THREE.Vector3();

  constructor(
    hall: VacantHall,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly say: (title?: string, text?: string) => void,
  ) {
    for (const prop of hall.props) prop.visible = false;
    // a longer lens than walking about: less distortion, and the crew fill the frame
    camera.fov = 45;
    camera.updateProjectionMatrix();
    // turned so the hall's door is behind the camera, and the grid's all there is behind the crew
    this.group.rotation.y = Math.PI;
    hall.group.add(this.group);
    document.body.append(this.overlay);
    this.overlay.append(this.recap);
    const crew = (key: string, line: string, tag: string): CrewView => {
      const who = helperFor(key);
      return { name: who.name, avatar: who.avatar, status: 'working', line, tag };
    };
    this.lead = this.actor(LEAD_AT, { ...crew('stage-lead', 'Starting on the goal', 'LEAD · OPUS'), name: 'Claude' }, LCARS.orange);
    this.helpers = HELPERS_AT.map((at, i) => this.actor(at, crew(`stage-helper-${i}`, HELPER_JOBS[i].job, 'EXPLORE · HAIKU'), [LCARS.sky, LCARS.lilac, LCARS.periwinkle][i]));
    this.nest = this.actor(NEST_AT, crew('stage-nest', 'audit the API', 'GENERAL · SONNET'), LCARS.lilac);
    this.subs = SUBS_AT.map((at, i) => this.actor(at, crew(`stage-sub-${i}`, SUB_JOBS[i].job, 'EXPLORE · HAIKU'), LCARS.periwinkle));
    this.lanes = LANES_X.map((x, i) => this.actor([x, 0, LANE.head], crew(`stage-lane-${i}`, LANE_JOBS[i], `WORKTREE ${i + 1}`), LCARS.gold, LANE.yaw, 0.75));
    this.cards = LANES_X.map((x) => {
      const card = new Tag(420, 150, 0.5);
      card.sprite.position.set(x, 0.6, LANE.card);
      this.group.add(card.sprite);
      return card;
    });
    this.queue.sprite.position.copy(v(LEAD_AT).add(new THREE.Vector3(0.2, 1.55, -1.5)));
    this.script.sprite.position.set(...SCRIPT_AT);
    this.group.add(this.queue.sprite, this.script.sprite);
    // the tree under the nested helpers, and the batch's lanes: glowing strips on the floor
    this.strip('nest', LEAD_AT, NEST_AT, LCARS.sky);
    SUBS_AT.forEach((at, i) => this.strip(`sub${i}`, NEST_AT, at, LCARS.lilac));
    LANES_X.forEach((x, i) => this.strip(`lane${i}`, [x, 0, LANE.from], [x, 0, LANE.to], LCARS.gold, 0.5));
    for (const at of PADS) {
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.44, 0.08, 32), new THREE.MeshBasicMaterial({ color: '#5f8fb3' }));
      pad.position.set(at[0], 0.04, at[2]);
      pad.visible = false;
      this.group.add(pad);
      this.pads.push(pad);
    }
    this.frame(0, 0);
  }

  /** Starts the timeline from the top, or `from` seconds in (to look at a rung while working on it); how long it runs (seconds). */
  play(from = 0): number {
    this.start = performance.now() - from * 1000;
    this.fired.clear();
    return STAGE_SECONDS;
  }

  private actor(at: V3, view: CrewView, accent: string, yaw = YAW, bubble = 1): Actor {
    const screen = new StationScreen(null, view.tag ?? '');
    const station = workstation(screen.material, accent);
    station.group.position.set(...at);
    station.group.rotation.y = yaw;
    station.group.visible = false;
    this.group.add(station.group);
    const gauge = new Tag(320, 76, 0.26);
    gauge.sprite.position.set(at[0], 2.5, at[2]);
    this.group.add(gauge.sprite);
    return { console: station.group, seat: station.seat, screen, view, gauge, at: v(at), bubble };
  }

  /** A glowing strip on the floor from `a` to `b`, which `show` fades in and out. */
  private strip(key: string, a: V3, b: V3, colour: string, width = 0.07): void {
    const from = v(a);
    const along = v(b).sub(from);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(along.length(), width).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0, depthWrite: false }));
    mesh.position.copy(from.addScaledVector(along, 0.5)).setY(0.03);
    mesh.rotation.y = -Math.atan2(along.z, along.x);
    mesh.visible = false;
    this.group.add(mesh);
    this.strips.set(key, mesh);
  }

  private beamIn(actor: Actor, now: number): void {
    actor.character = new Character(actor.view, 'keyboard', { size: actor.bubble });
    actor.seat.add(actor.character.group);
    actor.console.visible = true;
    this.beams.push(new Beam(actor.console, 'in', now));
  }

  private beamOut(actor: Actor, now: number): void {
    const { character } = actor;
    actor.character = undefined;
    this.beams.push(
      new Beam(actor.console, 'out', now, () => {
        actor.console.visible = false;
        character?.group.removeFromParent();
        character?.dispose();
      }),
    );
  }

  private setView(actor: Actor, line: string, status: AgentStatus = 'working'): void {
    if (actor.view.line === line && actor.view.status === status) return;
    actor.view = { ...actor.view, line, status };
    actor.character?.set(actor.view);
  }

  /** Each frame: the timeline at the time since `play`, the beams, the crew's poses and the labels. */
  update(now: number): void {
    const t = this.start === null ? 0 : (now - this.start) / 1000;
    const once = (key: string, at: number, run: () => void) => {
      if (t >= at && !this.fired.has(key)) {
        this.fired.add(key);
        run();
      }
    };
    for (const c of CAPTIONS) once(`say${c.at}`, c.at, () => this.say(c.title, c.text));
    once('lead', 1, () => this.beamIn(this.lead, now));
    this.helpers.forEach((a, i) => {
      once(`helper${i}`, 17 + i * 0.6, () => this.beamIn(a, now));
      once(`helper-done${i}`, 27.6 + i * 0.4, () => this.setView(a, HELPER_JOBS[i].answer, 'done'));
      once(`helper-out${i}`, 31 + i * 0.3, () => this.beamOut(a, now));
    });
    once('nest', 36, () => this.beamIn(this.nest, now));
    once('nest-split', 39.5, () => this.setView(this.nest, 'Splitting it in two'));
    this.subs.forEach((a, i) => {
      once(`sub${i}`, 40 + i * 0.5, () => this.beamIn(a, now));
      once(`sub-done${i}`, 46 + i * 0.3, () => this.setView(a, SUB_JOBS[i].answer, 'done'));
      once(`sub-out${i}`, 49.5 + i * 0.3, () => this.beamOut(a, now));
    });
    once('nest-done', 47.6, () => this.setView(this.nest, 'API: 2 issues, both minor', 'done'));
    once('nest-out', 50.2, () => this.beamOut(this.nest, now));
    WAVES.forEach((wave, w) =>
      PADS.forEach((at, i) => {
        const key = `${w}-${i}`;
        once(`pad-in${key}`, wave.start + i * WAVE.stagger, () => this.padIn(key, at, now));
        once(`pad-done${key}`, wave.start + WAVE.work + i * WAVE.stagger * 0.5, () => this.padDone(key));
        once(`pad-out${key}`, wave.start + WAVE.leave + i * WAVE.stagger, () => this.padOut(key, now));
      }),
    );
    this.lanes.forEach((a, i) => {
      once(`lane${i}`, 77 + i * 0.35, () => this.beamIn(a, now));
      once(`lane-done${i}`, 86 + i * 0.4, () => this.setView(a, `PR #${101 + i} opened`, 'done'));
      once(`lane-out${i}`, 89.5 + i * 0.25, () => this.beamOut(a, now));
    });
    for (let i = this.beams.length - 1; i >= 0; i--) if (this.beams[i].update(now)) this.beams.splice(i, 1);
    this.frame(t, now);
  }

  private padIn(key: string, at: V3, now: number): void {
    const who = helperFor(`stage-pad-${key}`);
    const view: CrewView = { name: who.name, avatar: who.avatar, status: 'working', line: '' };
    const character = new Character(view, 'standing');
    character.group.position.set(at[0], 0.08, at[2]);
    this.group.add(character.group);
    this.beams.push(new Beam(character.group, 'in', now));
    this.padders.set(key, { character, view, leaving: false });
  }

  private padDone(key: string): void {
    const p = this.padders.get(key);
    p?.character.set({ ...p.view, status: 'done' });
  }

  private padOut(key: string, now: number): void {
    const p = this.padders.get(key);
    if (!p || p.leaving) return;
    p.leaving = true;
    this.beams.push(
      new Beam(p.character.group, 'out', now, () => {
        p.character.group.removeFromParent();
        p.character.dispose();
        this.padders.delete(key);
      }),
    );
  }

  /** Everything that follows from the time alone: the camera, the gauges, the queue, the bubbles, the chips and the props. */
  private frame(t: number, now: number): void {
    this.shoot(t);
    this.soloAndHelpers(t);
    this.nested(t);
    this.workflow(t);
    this.batch(t);
    const recapping = t >= RECAP[0].at - 0.5 && t < STAGE_SECONDS - 1;
    this.recap.style.opacity = recapping ? '1' : '0';
    // rebuilt only as a row's added, so each row pops in once
    const rows = RECAP.filter((r) => t >= r.at);
    if (recapping && rows.length !== this.recap.childElementCount - 1)
      this.recap.replaceChildren(h('div', { class: 'title' }, 'Reach for…'), ...rows.map((r) => h('div', { class: 'row' }, h('b', null, r.rung), h('span', null, r.when))));
    for (const a of [this.lead, ...this.helpers, this.nest, ...this.subs, ...this.lanes]) {
      if (!a.character) continue;
      a.character.update(now / 1000, this.camera.position.distanceTo(a.console.getWorldPosition(this.tmp)));
      a.screen.maybeDraw(now, true, undefined, undefined);
    }
    // the workflow's crowd wears no bubbles: a distance of 0 fades them out
    for (const p of this.padders.values()) p.character.update(now / 1000, 0);
  }

  private soloAndHelpers(t: number): void {
    // the lead alone: a task every 1.3 s from 3.5 s, each read filling its context; then cleared for the same job with helpers
    const step = Math.floor((t - 3.5) / 1.3);
    const solo = t < 15.5;
    const leadFill = solo ? 0.06 + 0.76 * span(t, 3.5, 3.5 + SOLO_TASKS.length * 1.3) : 0.82 - 0.76 * span(t, 15.5, 16.5) + 0.08 * span(t, 27, 29.5) + 0.04 * span(t, 47.6, 49) + 0.05 * span(t, 69, 71);
    if (solo) this.setView(this.lead, step < 0 ? 'Starting on the goal' : step < SOLO_TASKS.length ? SOLO_TASKS[step] : 'Context 82% full');
    else if (t < 35) this.setView(this.lead, t < 19 ? 'Sending out three helpers' : t < 27.5 ? 'Waiting on 3 helpers' : 'Three answers back: planning');
    else if (t < 52) this.setView(this.lead, t < 48.5 ? 'Waiting on the API audit' : 'Audit back: 2 issues');
    else if (t < 76) this.setView(this.lead, t < 55 ? 'Writing a workflow script' : t < 70.5 ? `Workflow running: ${this.migrated(t)}/48` : 'Workflow done: 48 files migrated');
    else this.setView(this.lead, t < 88 ? 'Running /batch: 5 changes' : '5 pull requests to review');
    this.gauge(this.lead, leadFill, t > 2.5);
    const queueShown = t > 3.2 && t < 15.5;
    this.queue.opacity = queueShown ? 1 : 0;
    if (queueShown)
      this.queue.draw(`${step}`, (ctx, w) => {
        ctx.font = `500 40px ${LCARS_FONT}`;
        ctx.textBaseline = 'middle';
        SOLO_TASKS.forEach((task, i) => {
          const y = 8 + i * 66;
          pill(ctx, 4, y, w - 8, 56, i === step ? LCARS.orange : '#000000cc');
          ctx.fillStyle = i === step ? '#000' : i < step ? GREEN : '#a49db4';
          ctx.fillText(`${i < step ? '✓' : i === step ? '▸' : '·'} ${task}`, 26, y + 30);
        });
      });
    this.helpers.forEach((a, i) => {
      const reading = Math.floor((t - 21 - i * 0.4) / 2);
      if (t > 20.5 && t < 27.6) this.setView(a, reading < 0 ? HELPER_JOBS[i].job : HELPER_JOBS[i].reads[Math.min(reading, 2)]);
      this.gauge(a, 0.05 + 0.6 * span(t, 21, 27.5), t > 18 && t < 31);
      this.fly(`job${i}`, HELPER_JOBS[i].job, this.lead.at, a.at, span(t, 19 + i * 0.35, 20.5 + i * 0.35), LCARS.sky);
      this.fly(`answer${i}`, HELPER_JOBS[i].answer, a.at, this.lead.at, span(t, 27.6 + i * 0.4, 29.2 + i * 0.4), GREEN);
    });
  }

  private nested(t: number): void {
    this.show('nest', span(t, 37, 38) * (1 - span(t, 49.5, 50.5)));
    this.subs.forEach((a, i) => {
      this.show(`sub${i}`, span(t, 40 + i * 0.5, 41 + i * 0.5) * (1 - span(t, 49.5, 50.5)));
      this.gauge(a, 0.05 + 0.55 * span(t, 42.5, 46), t > 41 && t < 49.5);
      if (t > 42.5 && t < 46) this.setView(a, ['Read', 'Grep', 'Read'][Math.floor((t - 42.5) / 1.2) % 3] + (i ? ' orders.ts' : ' auth.ts'));
      this.fly(`subjob${i}`, SUB_JOBS[i].job, this.nest.at, a.at, span(t, 41.5 + i * 0.3, 42.8 + i * 0.3), LCARS.lilac);
      this.fly(`subanswer${i}`, SUB_JOBS[i].answer, a.at, this.nest.at, span(t, 46 + i * 0.3, 47.3 + i * 0.3), GREEN);
    });
    this.gauge(this.nest, 0.05 + 0.1 * span(t, 38, 39.5) + 0.06 * span(t, 46.5, 47.6), t > 37 && t < 50);
    this.fly('nestjob', 'audit the API', this.lead.at, this.nest.at, span(t, 37.3, 38.8), LCARS.sky);
    this.fly('nestanswer', 'API: 2 issues, both minor', this.nest.at, this.lead.at, span(t, 47.8, 49.3), GREEN);
  }

  /** How many of the workflow's 48 agents have finished at `t`. */
  private migrated(t: number): number {
    return WAVES.reduce((n, wave) => n + PADS.filter((_, i) => t >= wave.start + WAVE.work + i * WAVE.stagger * 0.5).length, 0);
  }

  private workflow(t: number): void {
    // the pads rise out of the grid, and sink back once the last wave's gone
    const up = span(t, 53, 54.5) * (1 - span(t, 72.5, 73.5));
    this.pads.forEach((pad, i) => {
      pad.visible = up > 0.01;
      pad.scale.set(1, Math.max(0.01, up), 1);
      pad.position.y = 0.04 * up;
      // lit while someone's on it
      const busy = WAVES.some((w) => t >= w.start + i * WAVE.stagger && t < w.start + WAVE.leave + i * WAVE.stagger + 1);
      (pad.material as THREE.MeshBasicMaterial).color.set(busy ? '#d6f2ff' : '#5f8fb3');
    });
    const shown = span(t, 54, 55) * (1 - span(t, 72, 73));
    this.script.opacity = shown;
    if (shown <= 0) return;
    const done = this.migrated(t);
    const running = WAVES.reduce((n, wave) => n + PADS.filter((_, i) => t >= wave.start + i * WAVE.stagger && t < wave.start + WAVE.work + i * WAVE.stagger * 0.5).length, 0);
    const queued = 48 - done - running;
    const phases = [
      { name: 'Scan the repo', total: 16, done: Math.min(16, done) },
      { name: 'Migrate files to ESM', total: 32, done: Math.max(0, Math.min(32, done - 16)) },
      { name: 'Report', total: 1, done: done >= 48 ? 1 : 0 },
    ];
    this.script.draw(`${done}|${running}`, (ctx, w, hgt) => {
      ctx.fillStyle = '#05081ae6';
      ctx.beginPath();
      ctx.roundRect(4, 4, w - 8, hgt - 8, 28);
      ctx.fill();
      ctx.strokeStyle = LCARS.sky;
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.textBaseline = 'top';
      ctx.fillStyle = LCARS.gold;
      ctx.font = `600 56px ${LCARS_FONT}`;
      ctx.fillText('WORKFLOW · migrate-to-esm.js', 40, 32);
      phases.forEach((p, i) => {
        const y = 140 + i * 120;
        ctx.fillStyle = p.done >= p.total ? GREEN : LCARS.peach;
        ctx.font = `500 44px ${LCARS_FONT}`;
        ctx.textAlign = 'left';
        ctx.fillText(`${p.done >= p.total ? '✓' : '▸'} ${p.name}`, 40, y);
        ctx.textAlign = 'right';
        ctx.fillText(`${p.done}/${p.total}`, w - 40, y);
        pill(ctx, 40, y + 56, w - 80, 22, '#ffffff22');
        if (p.done) pill(ctx, 40, y + 56, ((w - 80) * p.done) / p.total, 22, p.done >= p.total ? GREEN : LCARS.sky);
      });
      ctx.textAlign = 'left';
      ctx.fillStyle = LCARS.sky;
      ctx.font = `600 42px ${LCARS_FONT}`;
      ctx.fillText(`ON PADS ${running} · QUEUED ${queued} · DONE ${done}`, 40, hgt - 76);
    });
  }

  private batch(t: number): void {
    LANES_X.forEach((x, i) => {
      this.show(`lane${i}`, span(t, 76.5 + i * 0.2, 77.8 + i * 0.2) * (1 - span(t, 91, 92)), 0.55);
      const a = this.lanes[i];
      if (t > 79 && t < 86) this.setView(a, `${LANE_JOBS[i]} · ${['editing', 'testing', 'committing'][Math.floor((t - 79 + i * 0.7) / 2.2) % 3]}`);
      this.gauge(a, 0.05 + 0.35 * span(t, 79, 86), t > 78 && t < 89.5);
      this.fly(`pr${i}`, 'git push', v([x, 0, LANE.from]), v([x, 0, LANE.card + 0.4]), span(t, 84 + i * 0.4, 86 + i * 0.4), LCARS.gold, 0.9);
      const card = this.cards[i];
      const ready = t >= 86 + i * 0.4;
      card.opacity = span(t, 77.5 + i * 0.2, 78.5 + i * 0.2) * (1 - span(t, 91, 92));
      card.draw(`${ready}`, (ctx, w, hgt) => {
        pill(ctx, 4, 4, w - 8, hgt - 8, ready ? GREEN : '#000000cc');
        ctx.fillStyle = ready ? '#000' : '#a49db4';
        ctx.font = `600 50px ${LCARS_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(ready ? `PR #${101 + i} ✓` : `PR #${101 + i} …`, w / 2, hgt / 2 + 2);
      });
    });
  }

  private shoot(t: number): void {
    let i = 0;
    while (i < SHOTS.length - 1 && t >= SHOTS[i + 1].at) i++;
    const a = SHOTS[i];
    const b = SHOTS[Math.min(i + 1, SHOTS.length - 1)];
    const k = b === a ? 1 : span(t, a.at, b.at);
    this.camera.position.copy(this.group.localToWorld(v(a.pos).lerp(v(b.pos), k)));
    this.camera.lookAt(this.group.localToWorld(v(a.look).lerp(v(b.look), k)));
  }

  private show(key: string, o: number, max = 0.85): void {
    const strip = this.strips.get(key);
    if (!strip) return;
    strip.visible = o > 0.01;
    (strip.material as THREE.MeshBasicMaterial).opacity = o * max;
  }

  private gauge(actor: Actor, fill: number, shown: boolean): void {
    actor.gauge.opacity = shown && actor.character ? 1 : 0;
    if (shown) drawGauge(actor.gauge, fill);
  }

  /** A job or an answer in flight from `a` to `b`, `k` of the way, arcing over the floor. */
  private fly(key: string, text: string, a: THREE.Vector3, b: THREE.Vector3, k: number, colour: string, height = 1.9): void {
    let chip = this.chips.get(key);
    if (!chip) {
      chip = new Tag(640, 92, 0.3);
      this.group.add(chip.sprite);
      this.chips.set(key, chip);
    }
    const going = k > 0 && k < 1;
    chip.opacity = going ? 1 : 0;
    if (!going) return;
    drawChip(chip, text, colour);
    chip.sprite.position.copy(a).lerp(b, k).setY(height + Math.sin(k * Math.PI) * 0.6);
  }
}
