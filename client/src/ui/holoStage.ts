import * as THREE from 'three';
import { helperFor } from '../../../shared/crew';
import type { AgentStatus } from '../../../shared/types';
import { Character, type CrewView } from '../world/character';
import type { VacantHall } from '../world/room';
import { StationScreen } from '../world/screen';
import { LCARS, workstation } from '../world/starship';
import { Beam } from '../world/transporter';
import { h } from './dom';

// The studio's holodeck stage (?studio=1&stage=delegation, docs/studio.md): an empty holodeck where only what a scene
// needs beams in, played from a timeline rather than demo mode, so it's the same every time and can be timed to a
// narration. A spike: one scene, the first two rungs of "how Claude delegates" (one session alone, then helpers).

/** A crew member at a console on the stage, and the context bar over their head. */
interface Actor {
  console: THREE.Group;
  seat: THREE.Group;
  screen: StationScreen;
  character?: Character;
  view: CrewView;
  bar: HTMLElement;
  fill: HTMLElement;
}

/** Where things stand on the stage (its own frame, metres; +X towards the camera's side), and which way they face. */
const LEAD = { at: new THREE.Vector3(1.0, 0, -2.6), yaw: -1.9 };
const HELPERS = [
  { at: new THREE.Vector3(-1.6, 0, -0.6), yaw: -1.7 },
  { at: new THREE.Vector3(-2.4, 0, 1.7), yaw: -1.9 },
  { at: new THREE.Vector3(-1.2, 0, 3.9), yaw: -2.2 },
];
const SOLO_TASKS = ['Read web/src/App.tsx', 'Read web/src/store/cart.ts', 'Read web/src/Header.tsx', 'Read api/src/routes.ts', 'Read api/src/orders.ts', 'Search "saved items"', 'Read api/src/auth.ts'];
const HELPER_JOBS = [
  { job: 'map ./web', reads: ['Read App.tsx', 'Read store/cart.ts', 'Read Header.tsx'], answer: 'web: fits in Header.tsx' },
  { job: 'map ./api', reads: ['Read routes.ts', 'Read orders.ts', 'Read auth.ts'], answer: 'api: add routes/saved.ts' },
  { job: 'find the tests', reads: ['Glob **/*.test.ts', 'Read cart.test.ts', 'Read orders.test.ts'], answer: 'tests: cart.test.ts covers it' },
];

/** Camera keyframes: where it is and what it looks at, `at` seconds in; it eases from one to the next. */
const SHOTS: { at: number; pos: [number, number, number]; look: [number, number, number] }[] = [
  { at: 0, pos: [8.5, 2.6, 0.5], look: [1, 1, -2.6] },
  { at: 3, pos: [4.6, 1.8, -0.7], look: [0.8, 1.0, -2.6] },
  { at: 15.5, pos: [4.6, 1.8, -0.7], look: [0.8, 1.0, -2.6] },
  { at: 18.5, pos: [8.4, 3.8, 0.4], look: [-0.6, 1.0, 0.5] },
  { at: 29.5, pos: [8.4, 3.8, 0.4], look: [-0.6, 1.0, 0.5] },
  { at: 32.5, pos: [5.4, 2.2, -1.0], look: [0.6, 1.1, -2.6] },
];

/** The captions, as the timeline reaches them. */
const CAPTIONS: { at: number; title?: string; text?: string }[] = [
  { at: 0.5, title: 'How Claude delegates', text: 'Computer: show me how Claude gets work done.' },
  { at: 3.2, title: '1 · On its own', text: 'One session does everything itself, one step at a time.' },
  { at: 11, title: '1 · On its own', text: 'Every file it reads stays in its context window. It fills up.' },
  { at: 16, title: '2 · Subagents', text: 'Same job, with helpers: each one reads in a fresh context of its own.' },
  { at: 26.5, title: '2 · Subagents', text: 'Only their answers come back, so the lead stays light.' },
  { at: 34, title: undefined },
];

export const STAGE_SECONDS = 35;

/** The stage's green: answers coming back, and a context with room to spare. */
const GREEN = '#99cc66';

const ease = (k: number) => k * k * (3 - 2 * k);
const span = (t: number, a: number, b: number) => ease(Math.min(1, Math.max(0, (t - a) / (b - a))));

export class HoloStage {
  private readonly group = new THREE.Group();
  private readonly overlay = h('div', { class: 'stage-overlay' });
  private readonly queue = h('div', { class: 'stage-queue' });
  private readonly chips: HTMLElement[] = [];
  private readonly lead: Actor;
  private readonly helpers: Actor[];
  private readonly beams: Beam[] = [];
  private readonly fired = new Set<string>();
  private start = -1;
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
    this.overlay.append(this.queue);
    this.lead = this.actor(LEAD, { name: 'Claude', avatar: helperFor('stage-lead').avatar, status: 'working', line: 'Starting on the goal', tag: 'LEAD · OPUS' }, LCARS.orange);
    this.helpers = HELPERS.map((spot, i) => {
      const crew = helperFor(`stage-helper-${i}`);
      return this.actor(spot, { name: crew.name, avatar: crew.avatar, status: 'working', line: HELPER_JOBS[i].job, tag: 'EXPLORE · HAIKU' }, [LCARS.sky, LCARS.lilac, LCARS.periwinkle][i]);
    });
    for (let i = 0; i < HELPER_JOBS.length * 2; i++) this.overlay.append((this.chips[i] = h('div', { class: 'stage-chip' })));
    this.frame(0);
  }

  /** Starts the timeline from the top; how long it runs (seconds). */
  play(): number {
    this.start = performance.now();
    this.fired.clear();
    return STAGE_SECONDS;
  }

  private actor(spot: { at: THREE.Vector3; yaw: number }, view: CrewView, accent: string): Actor {
    const screen = new StationScreen(null, view.tag ?? '');
    const station = workstation(screen.material, accent);
    station.group.position.copy(spot.at);
    station.group.rotation.y = spot.yaw;
    station.group.visible = false;
    this.group.add(station.group);
    const fill = h('i');
    const bar = h('div', { class: 'stage-bar' }, fill, h('span', null, 'context'));
    this.overlay.append(bar);
    return { console: station.group, seat: station.seat, screen, view, bar, fill };
  }

  private beamIn(actor: Actor, now: number, withConsole: boolean): void {
    if (withConsole) {
      actor.console.visible = true;
      this.beams.push(new Beam(actor.console, 'in', now));
    }
    actor.character = new Character(actor.view);
    actor.seat.add(actor.character.group);
    if (!withConsole) this.beams.push(new Beam(actor.character.group, 'in', now));
  }

  private beamOut(actor: Actor, now: number): void {
    const { character } = actor;
    actor.character = undefined;
    this.beams.push(new Beam(actor.console, 'out', now, () => (actor.console.visible = false)));
    if (character) this.beams.push(new Beam(character.group, 'out', now, () => (character.group.removeFromParent(), character.dispose())));
  }

  private setView(actor: Actor, line: string, status: AgentStatus = 'working'): void {
    if (actor.view.line === line && actor.view.status === status) return;
    actor.view = { ...actor.view, line, status };
    actor.character?.set(actor.view);
  }

  /** Each frame: the timeline at the time since `play`, the beams, the crew's poses and the overlay. */
  update(now: number): void {
    const t = this.start < 0 ? 0 : (now - this.start) / 1000;
    const once = (key: string, at: number, run: () => void) => {
      if (t >= at && !this.fired.has(key)) {
        this.fired.add(key);
        run();
      }
    };
    for (const c of CAPTIONS) once(`say${c.at}`, c.at, () => this.say(c.title, c.text));
    once('lead', 1, () => this.beamIn(this.lead, now, true));
    this.helpers.forEach((a, i) => {
      once(`helper${i}`, 17 + i * 0.6, () => this.beamIn(a, now, true));
      once(`helper-done${i}`, 27.6 + i * 0.4, () => this.setView(a, HELPER_JOBS[i].answer, 'done'));
      once(`helper-out${i}`, 31 + i * 0.3, () => this.beamOut(a, now));
    });
    for (let i = this.beams.length - 1; i >= 0; i--) if (this.beams[i].update(now)) this.beams.splice(i, 1);
    this.frame(t);
    for (const a of [this.lead, ...this.helpers]) {
      a.character?.update(now / 1000, this.camera.position.distanceTo(a.console.getWorldPosition(this.tmp)));
      a.screen.maybeDraw(now, true, undefined, undefined);
    }
  }

  /** Everything that follows from the time alone: the camera, the bars, the task queue, the bubbles and the chips. */
  private frame(t: number): void {
    this.shoot(t);
    // the lead alone: a task every 1.3 s from 3.5 s, each read filling its context; then cleared for the same job with helpers
    const step = Math.floor((t - 3.5) / 1.3);
    const solo = t < 15.5;
    const leadFill = solo ? 0.06 + 0.76 * span(t, 3.5, 3.5 + SOLO_TASKS.length * 1.3) : 0.82 - 0.76 * span(t, 15.5, 16.5) + 0.08 * span(t, 27, 29.5);
    if (solo) this.setView(this.lead, step < 0 ? 'Starting on the goal' : step < SOLO_TASKS.length ? SOLO_TASKS[step] : 'Context 82% full', 'working');
    else this.setView(this.lead, t < 19 ? 'Sending out three helpers' : t < 27.5 ? 'Waiting on 3 helpers' : 'Three answers back: planning', 'working');
    this.queue.replaceChildren(...(t > 3.2 && t < 15.5 ? SOLO_TASKS.map((task, i) => h('div', { class: i < step ? 'done' : i === step ? 'now' : '' }, `${i < step ? '✓' : i === step ? '▸' : '·'} ${task}`)) : []));
    this.place(this.queue, this.lead, new THREE.Vector3(0, 1.3, -1.4), 'left');
    this.bar(this.lead, leadFill, t > 2.5);
    this.helpers.forEach((a, i) => {
      const reading = Math.floor((t - 21 - i * 0.4) / 2);
      if (t > 20.5 && t < 27.6) this.setView(a, reading < 0 ? HELPER_JOBS[i].job : HELPER_JOBS[i].reads[Math.min(reading, 2)]);
      this.bar(a, 0.05 + 0.6 * span(t, 21, 27.5) - 0.65 * span(t, 30.5, 31.5), t > 18 && t < 31.5);
      // the job flies out to the helper, the answer flies back
      this.fly(this.chips[i * 2], HELPER_JOBS[i].job, this.lead, a, span(t, 19 + i * 0.35, 20.5 + i * 0.35), LCARS.sky);
      this.fly(this.chips[i * 2 + 1], HELPER_JOBS[i].answer, a, this.lead, span(t, 27.6 + i * 0.4, 29.2 + i * 0.4), GREEN);
    });
  }

  private shoot(t: number): void {
    let i = 0;
    while (i < SHOTS.length - 1 && t >= SHOTS[i + 1].at) i++;
    const a = SHOTS[i];
    const b = SHOTS[Math.min(i + 1, SHOTS.length - 1)];
    const k = b === a ? 1 : span(t, a.at, b.at);
    const pos = new THREE.Vector3(...a.pos).lerp(new THREE.Vector3(...b.pos), k);
    const look = new THREE.Vector3(...a.look).lerp(new THREE.Vector3(...b.look), k);
    this.camera.position.copy(this.group.localToWorld(pos));
    this.camera.lookAt(this.group.localToWorld(look));
  }

  /** Puts a DOM element over a point `off` from an actor's seat (stage frame), or hides it when that's off screen. */
  private place(el: HTMLElement, actor: Actor, off: THREE.Vector3, anchor: 'centre' | 'left' = 'centre'): boolean {
    const p = this.group.localToWorld(actor.console.position.clone().add(off)).project(this.camera);
    const on = p.z < 1 && Math.abs(p.x) < 1.2 && Math.abs(p.y) < 1.2;
    el.style.display = on ? '' : 'none';
    if (on) el.style.transform = `translate(${((p.x + 1) / 2) * innerWidth}px, ${((1 - p.y) / 2) * innerHeight}px) translate(${anchor === 'left' ? '0' : '-50%'}, -50%)`;
    return on;
  }

  private bar(actor: Actor, fill: number, shown: boolean): void {
    actor.bar.style.opacity = shown && actor.character ? '1' : '0';
    actor.fill.style.width = `${Math.round(Math.max(0, Math.min(1, fill)) * 100)}%`;
    actor.fill.style.background = fill > 0.7 ? LCARS.red : fill > 0.4 ? LCARS.gold : GREEN;
    this.place(actor.bar, actor, new THREE.Vector3(0, 2.38, 0));
  }

  private fly(chip: HTMLElement, text: string, from: Actor, to: Actor, k: number, colour: string): void {
    const going = k > 0 && k < 1;
    chip.style.opacity = going ? '1' : '0';
    if (!going) return;
    chip.textContent = text;
    chip.style.background = colour;
    const a = from.console.position.clone().setY(1.9);
    const b = to.console.position.clone().setY(1.9);
    const at = a.lerp(b, k).sub(from.console.position);
    this.place(chip, from, at);
  }
}
