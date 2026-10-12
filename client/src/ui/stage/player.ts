import * as THREE from 'three';
import { helperFor } from '../../../../shared/crew';
import { lerpPose, type Pose, solveFraming } from '../../../../shared/framing';
import { type Act, type Framing, type Timeline, trackAt, type V3 } from '../../../../shared/stagePlan';
import type { AgentStatus } from '../../../../shared/types';
import { Character, type CrewView } from '../../world/character';
import type { VacantHall } from '../../world/room';
import { LCARS, stationSeat } from '../../world/starship';
import { Beam } from '../../world/transporter';
import { h } from '../dom';
import { drawChip, drawPanel, Gauge, GREEN, Tag } from './props';

// The studio's holodeck stage (?studio=1&stage=<plan>, docs/studio.md): plays a shot plan (scenes/*.plan.yaml, the
// format in studio/director.md) on an empty holodeck. The cast beams in as the acts say, the camera is solved from each
// shot's framing every frame, and shots hand over by cut, move, dip or grid wipe. Everything is placed in the plan's
// stage frame: metres from the middle of the hall floor, +x screen-right, +z towards the audience (and the hall door).

const v3 = (p: unknown, fallback: V3 = [0, 0, 0]): V3 => (Array.isArray(p) && p.length === 3 ? (p as V3) : fallback);
const list = <T>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x]);
const num = (x: unknown, fallback: number) => (typeof x === 'number' ? x : fallback);
const str = (x: unknown, fallback = '') => (typeof x === 'string' ? x : typeof x === 'number' ? String(x) : fallback);
const rad = (deg: number) => (deg * Math.PI) / 180;
const ACCENT: Record<string, string> = { orange: LCARS.orange, sky: LCARS.sky, lilac: LCARS.lilac, periwinkle: LCARS.periwinkle, gold: LCARS.gold, peach: LCARS.peach, red: LCARS.red, green: GREEN };
/** How long a job or an answer takes to fly between two crew. */
const FLIGHT = 1.1;
const BEAM_S = 2.6;

/** Which way someone faces: right or left on screen, turned `turn` degrees towards the audience. As a yaw for a group whose front is +x. */
const facing = (faces: unknown, turn: unknown) => (faces === 'left' ? Math.PI + rad(num(turn, 30)) : -rad(num(turn, 30)));

/** A crew member in a bridge seat with a PADD (no console in front, so the camera can see their face), and their gauge. */
interface Crew {
  kind: 'crew';
  at: V3;
  /** What beams in and out: the seat, and whoever sits in it. */
  console: THREE.Group;
  seat: THREE.Group;
  character?: Character;
  view: CrewView;
  gauge?: Gauge;
  bubble: number;
}

interface Pad {
  at: V3;
  mesh: THREE.Mesh;
  character?: Character;
  view?: CrewView;
  /** In the cycle: when its occupant finishes, leaves, and the pad is free again (stage seconds). */
  doneAt?: number;
  leaveAt?: number;
  freeAt?: number;
}

interface Lane {
  crew: Crew;
  pr: Tag;
  tree: Tag;
  strip: THREE.Mesh;
  number: number;
}

type Prop =
  | Crew
  | { kind: 'gauge'; gauge: Gauge; at: V3 }
  | { kind: 'list'; tag: Tag; at: V3; items: string[]; step: number; tickFrom?: number; every?: number; style?: string }
  | { kind: 'slate'; tag: Tag; at: V3; title: string; lines: string[] }
  | { kind: 'pads'; pads: Pad[]; centre: V3; counter: Tag; template?: string; cycle?: { until: number; started: number; done: number; work: [number, number] } }
  | { kind: 'lanes'; lanes: Lane[]; centre: V3; counter: Tag }
  | { kind: 'card'; el: HTMLElement; title: string; rows: [string, string][]; shown: number }
  | { kind: 'label'; tag: Tag; at: V3; text: string };

/** Something the frame keeps moving: a fill, a chip in flight, a fade, a glow. */
type Tween =
  | { kind: 'fill'; gauge: Gauge; from: number; to: number; start: number; over: number }
  | { kind: 'chip'; tag: Tag; from: V3; to: V3; start: number; over: number; lift: number }
  | { kind: 'fade'; set: (o: number) => void; from: number; to: number; start: number; over: number }
  | { kind: 'glow'; pulse: (k: number) => void; start: number; over: number };

export class HoloStage {
  /** The stage frame, turned so the hall's door is behind the audience. */
  private readonly group = new THREE.Group();
  private readonly overlay = h('div', { class: 'stage-overlay' });
  private readonly curtain = h('div', { class: 'stage-wipe' }, h('div', { class: 'stage-wipe-title' }));
  private readonly dip = h('div', { class: 'stage-dip' });
  private readonly subtitle = h('div', { class: 'stage-subtitle' });
  private readonly chapter = h('div', { class: 'stage-chapter' });
  private readonly props = new Map<string, Prop>();
  private readonly beams: Beam[] = [];
  private tweens: Tween[] = [];
  private pending: { at: number; run: () => void }[] = [];
  private readonly chips: Tag[] = [];
  private next = 0;
  private start: number | null = null;
  private readonly poses = new WeakMap<Framing, Pose>();
  /** Acts the stage doesn't know yet, as `act` or `act on target`: the recorder lists them. */
  readonly unsupported = new Set<string>();
  private readonly tmp = new THREE.Vector3();

  constructor(
    hall: VacantHall,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly timeline: Timeline,
  ) {
    for (const prop of hall.props) prop.visible = false;
    this.group.rotation.y = -Math.PI / 2;
    hall.group.add(this.group);
    document.body.append(this.overlay);
    this.overlay.append(this.subtitle, this.chapter, this.dip, this.curtain);
    for (const [name, spec] of Object.entries(timeline.cast)) this.cast(name, spec);
    this.frame(0, performance.now());
  }

  /** How long the timeline runs (seconds). */
  get duration(): number {
    return this.timeline.duration;
  }

  /** Plays from the top, or `from` seconds in (to look at one part while working on it; what came before lands at once). */
  play(from = 0): number {
    this.start = performance.now() - from * 1000;
    return this.timeline.duration;
  }

  // ------------------------------------------------------------------ the cast

  private add(object: THREE.Object3D, at: V3): void {
    object.position.set(...at);
    this.group.add(object);
  }

  private crew(name: string, spec: Record<string, unknown>, at: V3, yaw: number): Crew {
    const who = helperFor(`stage-${this.timeline.episode}-${name}`);
    const view: CrewView = { name: str(spec.name, who.name), avatar: who.avatar, status: 'working', line: str(spec.line), tag: str(spec.tag) || undefined };
    const seat = stationSeat(ACCENT[str(spec.accent, 'sky')] ?? LCARS.sky);
    const group = new THREE.Group();
    group.add(seat);
    group.rotation.y = yaw;
    group.visible = false;
    this.add(group, at);
    const crew: Crew = { kind: 'crew', at, console: group, seat, view, bubble: num(spec.bubble, 1) };
    if (spec.gauge) {
      // beside them on the side they face away from, a step upstage: never between them and a camera in front
      const side = Math.cos(yaw) >= 0 ? -1 : 1;
      const where: V3 = [at[0] + side * 1.0, 0, at[2] - 0.2];
      const gauge = new Gauge(num(spec.gaugeHeight, 1.4));
      this.add(gauge.group, where);
      crew.gauge = gauge;
      this.props.set(`${name}.gauge`, { kind: 'gauge', gauge, at: where });
    }
    return crew;
  }

  private cast(name: string, spec: Record<string, unknown>): void {
    const at = v3(spec.at);
    switch (spec.kind) {
      case 'crew':
        this.props.set(name, this.crew(name, spec, at, facing(spec.faces, spec.turn)));
        return;
      case 'gauge': {
        const gauge = new Gauge(num(spec.height, 1.8));
        this.add(gauge.group, at);
        this.props.set(name, { kind: 'gauge', gauge, at });
        const of = this.props.get(str(spec.of));
        if (of?.kind === 'crew') of.gauge = gauge;
        return;
      }
      case 'list': {
        const items = Array.isArray(spec.items) ? spec.items.map((x) => str(x)) : Array.from({ length: num(spec.items, 5) }, (_, i) => `Step ${i + 1}`);
        const tag = new Tag(620, 120 + Math.max(4, items.length) * 70, 0.32 + Math.max(4, items.length) * 0.18);
        this.add(tag.sprite, at);
        this.props.set(name, { kind: 'list', tag, at, items, step: -1, style: str(spec.style) });
        return;
      }
      case 'slate': {
        const tag = new Tag(1000, 560, 1.7);
        this.add(tag.sprite, at);
        const lines = list(spec.text as string | string[]).map((x) => str(x));
        this.props.set(name, { kind: 'slate', tag, at, title: str(spec.title, 'WORKFLOW SCRIPT'), lines });
        return;
      }
      case 'label': {
        const tag = new Tag(720, 110, num(spec.height, 0.3));
        this.add(tag.sprite, at);
        this.props.set(name, { kind: 'label', tag, at, text: str(spec.text) });
        return;
      }
      case 'pad':
        return this.castPads(name, spec, at);
      case 'lane':
        return this.castLanes(name, spec);
      case 'card': {
        const el = h('div', { class: 'stage-recap' });
        this.overlay.append(el);
        const rows = (Array.isArray(spec.rows) ? spec.rows : []).map((r): [string, string] => (Array.isArray(r) ? [str(r[0]), str(r[1])] : [str(r), '']));
        this.props.set(name, { kind: 'card', el, title: str(spec.title), rows, shown: 0 });
        return;
      }
      default:
        this.unsupported.add(`cast kind ${str(spec.kind, '?')} (${name})`);
    }
  }

  private castPads(name: string, spec: Record<string, unknown>, at: V3): void {
    const [cols, rows] = Array.isArray(spec.grid) ? (spec.grid as [number, number]) : [4, 4];
    const spacing = num(spec.spacing, 1.1);
    const pads: Pad[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const p: V3 = [at[0] + (c - (cols - 1) / 2) * spacing, 0, at[2] + (r - (rows - 1) / 2) * spacing];
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.44, 0.08, 32), new THREE.MeshBasicMaterial({ color: '#5f8fb3' }));
        mesh.visible = false;
        this.add(mesh, [p[0], 0.04, p[2]]);
        pads.push({ at: p, mesh });
      }
    }
    const counter = new Tag(900, 110, 0.42);
    this.add(counter.sprite, [at[0], 2.7, at[2] - (rows / 2) * spacing]);
    this.props.set(name, { kind: 'pads', pads, centre: at, counter });
  }

  private castLanes(name: string, spec: Record<string, unknown>): void {
    const from = v3(spec.from, [-2, 0, -3]);
    const to = v3(spec.to, [5, 0, 3]);
    const count = num(spec.count, 5);
    const lanes: Lane[] = [];
    for (let i = 0; i < count; i++) {
      const z = count === 1 ? from[2] : from[2] + ((to[2] - from[2]) * i) / (count - 1);
      const crew = this.crew(`${name}.${i + 1}`, { tag: `WORKTREE ${i + 1}`, accent: 'gold', bubble: 0 }, [from[0], 0, z], facing('right', 20));
      const pr = new Tag(420, 140, 0.42);
      this.add(pr.sprite, [to[0], 1.0, z]);
      const tree = new Tag(420, 100, 0.26);
      this.add(tree.sprite, [from[0] - 0.9, 1.9, z]);
      const length = to[0] - from[0] - 1.3;
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(length, 0.45).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: LCARS.gold, transparent: true, opacity: 0, depthWrite: false }));
      strip.visible = false;
      this.add(strip, [from[0] + 0.9 + length / 2, 0.03, z]);
      lanes.push({ crew, pr, tree, strip, number: num(spec.firstPr, 412) + i });
    }
    const counter = new Tag(900, 110, 0.42);
    this.add(counter.sprite, [(from[0] + to[0]) / 2, 2.4, from[2] - 0.8]);
    this.props.set(name, { kind: 'lanes', lanes, centre: [(from[0] + to[0]) / 2, 0, (from[2] + to[2]) / 2], counter });
  }

  /** What a name in the plan means: one prop, a part of one (`pads.6`, `lanes.3.pr`) or a group (`pads.2-4`, `lanes.console`). */
  private resolve(name: string): { prop: Prop; part?: string; index?: number }[] {
    const direct = this.props.get(name);
    if (direct) return [{ prop: direct }];
    const [head, a, b] = name.split('.');
    const prop = this.props.get(head);
    if (!prop) {
      // a part of a cast member, like lead.bubble or lead.gauge.ghost
      const owner = this.props.get(`${head}.${a}`);
      return owner ? [{ prop: owner, part: b }] : [];
    }
    if (prop.kind === 'pads') {
      const range = /^(\d+)(?:-(\d+))?$/.exec(a ?? '');
      if (!range) return [{ prop, part: a }];
      const lo = Number(range[1]);
      const hi = Number(range[2] ?? range[1]);
      return Array.from({ length: hi - lo + 1 }, (_, i) => ({ prop, index: lo - 1 + i })).filter((r) => r.index < prop.pads.length);
    }
    if (prop.kind === 'lanes') {
      if (/^\d+$/.test(a ?? '')) return [{ prop, index: Number(a) - 1, part: b ?? 'console' }];
      return prop.lanes.map((_, index) => ({ prop, index, part: a === 'heads' ? 'console' : a }));
    }
    if (prop.kind === 'card' && /^\d+$/.test(a ?? '')) return [{ prop, index: Number(a) - 1 }];
    return [{ prop, part: a }];
  }

  /** Where a name is, for the camera and for chips: a crew member's head, a prop's middle. */
  private where = (name: string): V3 | undefined => {
    if (name === 'hall') return [0, 1, 0];
    const found = this.resolve(name);
    if (!found.length) return undefined;
    const points = found.map(({ prop, index, part }) => this.point(prop, index, part));
    const n = points.length;
    return points.reduce<V3>((s, p) => [s[0] + p[0] / n, s[1] + p[1] / n, s[2] + p[2] / n], [0, 0, 0]);
  };

  private point(prop: Prop, index?: number, part?: string): V3 {
    switch (prop.kind) {
      case 'crew':
        return [prop.at[0], 1.15, prop.at[2]];
      case 'gauge':
        // the middle of the column and its readout
        return [prop.at[0], 1.25, prop.at[2]];
      case 'pads':
        // a standing crew member's head is higher than a seated one's
        return index === undefined ? [prop.centre[0], 0.9, prop.centre[2]] : [prop.pads[index].at[0], 1.45, prop.pads[index].at[2]];
      case 'lanes': {
        if (index === undefined) return [prop.centre[0], 0.6, prop.centre[2]];
        const lane = prop.lanes[index];
        if (part === 'pr') return lane.pr.sprite.position.toArray();
        if (part === 'tree') return lane.tree.sprite.position.toArray();
        return [lane.crew.at[0], 1.15, lane.crew.at[2]];
      }
      case 'card':
        return [0, 1, 0];
      default:
        return prop.at;
    }
  }

  // ------------------------------------------------------------------ acts

  /** Runs an act on its target now (`t` stage seconds, `now` the clock), spreading a group's members by its gap. */
  private run(act: Act, t: number, now: number): void {
    if (act.act === 'title') return this.title(str(act.params.text), t);
    if (act.act === 'send') return this.send(act, t);
    const found = act.target ? this.resolve(act.target) : [];
    if (act.target && !found.length) return void this.unsupported.add(`${act.act} on ${act.target} (not in the cast)`);
    const gap = num(act.params.gap, 0);
    found.forEach((f, i) => {
      if (i && gap) this.pending.push({ at: t + i * gap, run: () => this.apply(act, f, t + i * gap, performance.now()) });
      else this.apply(act, f, t, now);
    });
  }

  private apply(act: Act, { prop, index, part }: { prop: Prop; index?: number; part?: string }, t: number, now: number): void {
    const p = act.params;
    const crew = this.crewOf(prop, index);
    switch (act.act) {
      case 'beam-in':
        if (prop.kind === 'pads' && index !== undefined) return this.padIn(prop.pads[index], now);
        if (prop.kind === 'lanes' && index !== undefined && part === 'tree') return this.fade(prop.lanes[index], 1, t);
        if (crew) return this.beamIn(crew, now);
        break;
      case 'beam-out':
        if (prop.kind === 'pads' && index !== undefined) return this.padOut(prop.pads[index], now);
        if (crew) return this.beamOut(crew, now);
        break;
      case 'say': {
        const lines = list(p.line as string | string[]).map((x) => str(x));
        const every = num(p.every, 0.8);
        lines.forEach((line, i) => this.pending.push({ at: t + i * every, run: () => crew && this.setView(crew, line) }));
        return;
      }
      case 'status':
        if (prop.kind === 'pads' && index !== undefined) {
          const pad = prop.pads[index];
          if (pad.character && pad.view) pad.character.set((pad.view = { ...pad.view, status: str(p.to) === 'done' ? 'done' : 'working' }));
          return;
        }
        if (crew) return this.setView(crew, crew.view.line, str(p.to) === 'done' ? 'done' : 'working');
        break;
      case 'fill': {
        const gauge = this.gaugeOf(prop);
        if (gauge) return void this.tweens.push({ kind: 'fill', gauge, from: gauge.level, to: num(p.to, 0), start: t, over: num(p.over, 1) });
        break;
      }
      case 'show':
      case 'hide':
        return this.show(prop, index, part, act.act === 'show', p, t);
      case 'tick':
        if (prop.kind === 'list') {
          prop.tickFrom = t;
          prop.every = num(p.every, 1);
          return;
        }
        break;
      case 'label':
      case 'count':
      case 'morph': {
        const text = str(p.text) || str(p.into);
        if (act.act === 'morph' && !text) {
          // a list that splits into jobs: it goes, and the sends carry on from there
          if (prop.kind === 'list') return this.show(prop, index, part, false, p, t);
          break;
        }
        return this.label(prop, part, text);
      }
      case 'glow':
      case 'dim':
      case 'undim': {
        const pulse = this.pulseOf(prop, index, part);
        if (act.act === 'glow' && str(p.label)) this.label(prop, part, str(p.label));
        if (act.act === 'glow' && pulse) return void this.tweens.push({ kind: 'glow', pulse, start: t, over: num(p.over, 1) });
        // dimming isn't in yet: the shot still reads without it
        return void this.unsupported.add(`${act.act} on ${act.target}`);
      }
      case 'cycle':
        if (prop.kind === 'pads') {
          const work: [number, number] = Array.isArray(p.work) ? (p.work as [number, number]) : [1, 2];
          prop.cycle = { until: num(p.until, 50), started: prop.pads.filter((x) => x.character).length, done: 0, work };
          prop.pads.forEach((pad, i) => pad.character && (pad.doneAt = t + this.work(prop, i, 0)));
          return;
        }
        break;
      case 'progress':
        if (prop.kind === 'lanes') {
          // side by side lanes don't have room for bubbles: each worktree's marker says how its change is going
          prop.lanes.forEach((lane, i) =>
            ['editing', 'testing', 'tests pass'].forEach((step, k) =>
              this.pending.push({ at: t + k * 1.4 + i * 0.25, run: () => drawChip(lane.tree, `worktree ${lane.number - 411} · ${step}`, k === 2 ? GREEN : LCARS.gold) }),
            ),
          );
          return;
        }
        break;
    }
    this.unsupported.add(`${act.act} on ${act.target ?? 'nothing'}`);
  }

  private crewOf(prop: Prop, index?: number): Crew | undefined {
    if (prop.kind === 'crew') return prop;
    if (prop.kind === 'lanes' && index !== undefined) return prop.lanes[index].crew;
    return undefined;
  }

  private gaugeOf(prop: Prop): Gauge | undefined {
    return prop.kind === 'gauge' ? prop.gauge : prop.kind === 'crew' ? prop.gauge : undefined;
  }

  private pulseOf(prop: Prop, index?: number, part?: string): ((k: number) => void) | undefined {
    if (prop.kind === 'gauge') return (k) => prop.gauge.pulse(k);
    if (prop.kind === 'crew' && prop.gauge) return (k) => prop.gauge!.pulse(k);
    if (prop.kind === 'lanes' && index !== undefined) return (k) => (part === 'pr' ? prop.lanes[index].pr : prop.lanes[index].tree).pulse(k);
    if (prop.kind === 'slate' || prop.kind === 'list' || prop.kind === 'label') return (k) => prop.tag.pulse(k);
    if (prop.kind === 'card' && index !== undefined) return () => this.revealRow(prop, index + 1);
    return undefined;
  }

  private show(prop: Prop, index: number | undefined, part: string | undefined, on: boolean, p: Record<string, unknown>, t: number): void {
    const o = on ? 1 : 0;
    switch (prop.kind) {
      case 'gauge':
      case 'crew': {
        const gauge = this.gaugeOf(prop);
        if (!gauge) break;
        if (part === 'ghost') return gauge.setGhost(on ? num(p.to, gauge.level) : null, str(p.label));
        if (on && typeof p.fill === 'number') gauge.set(p.fill);
        return void this.tweens.push({ kind: 'fade', set: (k) => gauge.setShown(k), from: on ? 0 : 1, to: o, start: t, over: 0.5 });
      }
      case 'list':
        if (Array.isArray(p.items)) prop.items = p.items.map((x) => str(x));
        if (on) prop.step = -1;
        return void this.tweens.push({ kind: 'fade', set: (k) => (prop.tag.opacity = k), from: on ? 0 : 1, to: o, start: t, over: 0.4 });
      case 'slate':
      case 'label':
        return void this.tweens.push({ kind: 'fade', set: (k) => (prop.tag.opacity = k), from: on ? 0 : 1, to: o, start: t, over: 0.5 });
      case 'pads':
        // the pads rise out of the grid
        return void this.tweens.push({
          kind: 'fade',
          set: (k) => prop.pads.forEach((pad) => ((pad.mesh.visible = k > 0.01), pad.mesh.scale.set(1, Math.max(0.01, k), 1))),
          from: on ? 0 : 1,
          to: o,
          start: t,
          over: 1,
        });
      case 'lanes': {
        const lanes = index === undefined ? prop.lanes : [prop.lanes[index]];
        if (part === 'pr') {
          lanes.forEach((lane) => {
            drawChip(lane.pr, `PR #${lane.number} ✓`, GREEN);
            this.tweens.push({ kind: 'fade', set: (k) => (lane.pr.opacity = k), from: on ? 0 : 1, to: o, start: t, over: 0.4 });
          });
          return;
        }
        lanes.forEach((lane) => this.fade(lane, o, t));
        return;
      }
      case 'card':
        if (index !== undefined) return this.revealRow(prop, index + 1);
        prop.el.style.opacity = String(o);
        if (on) this.revealRow(prop, Math.max(prop.shown, num(p.rows, 0)));
        return;
    }
  }

  /** A lane's worktree marker and its strip on the floor. */
  private fade(lane: Lane, o: number, t: number): void {
    drawChip(lane.tree, `worktree ${lane.number - 411}`, LCARS.gold);
    this.tweens.push({
      kind: 'fade',
      set: (k) => {
        lane.tree.opacity = k;
        lane.strip.visible = k > 0.01;
        (lane.strip.material as THREE.MeshBasicMaterial).opacity = 0.5 * k;
      },
      from: 1 - o,
      to: o,
      start: t,
      over: 0.6,
    });
  }

  private label(prop: Prop, part: string | undefined, text: string): void {
    switch (prop.kind) {
      case 'slate':
        if (part === 'results' || part === undefined) prop.lines = [...prop.lines.filter((l) => !l.startsWith('→')), `→ ${text}`];
        return;
      case 'label':
        prop.text = text;
        return;
      case 'pads':
      case 'lanes':
        if (prop.kind === 'pads') prop.template = text;
        else drawChip(prop.counter, text, LCARS.sky);
        prop.counter.opacity = 1;
        return;
      case 'list':
        prop.items = [text];
        return;
      case 'gauge':
      case 'crew': {
        const gauge = this.gaugeOf(prop);
        if (gauge) gauge.setGhost(gauge.level, text);
        return;
      }
    }
    this.unsupported.add(`label on ${prop.kind}`);
  }

  private revealRow(card: Extract<Prop, { kind: 'card' }>, rows: number): void {
    card.el.style.opacity = '1';
    if (rows === card.shown) return;
    card.shown = Math.min(card.rows.length, rows);
    card.el.replaceChildren(h('div', { class: 'title' }, card.title), ...card.rows.slice(0, card.shown).map(([a, b]) => h('div', { class: 'row' }, h('b', null, a), h('span', null, b))));
  }

  /** Chips flying from each `from` to each `to`, the jobs low and the answers high. */
  private send(act: Act, t: number): void {
    const p = act.params;
    const froms = list(p.from as string | string[]).flatMap((n) => this.points(n));
    const tos = list(p.to as string | string[]).flatMap((n) => this.points(n));
    const texts = list(p.text as string | string[]).map((x) => str(x));
    const high = str(p.lane) === 'high';
    const pairs = Math.max(froms.length, tos.length);
    const gap = num(p.gap, 0.25);
    for (let i = 0; i < pairs; i++) {
      const from = froms[Math.min(i, froms.length - 1)];
      const to = tos[Math.min(i, tos.length - 1)];
      if (!from || !to) continue;
      const tag = this.chips.find((c) => !c.sprite.visible && !this.tweens.some((w) => w.kind === 'chip' && w.tag === c)) ?? this.newChip();
      drawChip(tag, texts[i] ?? texts[0] ?? '•••', high ? GREEN : LCARS.sky);
      const at = t + i * gap;
      this.tweens.push({ kind: 'chip', tag, from: [from[0], high ? 2.5 : 1.55, from[2]], to: [to[0], high ? 2.5 : 1.55, to[2]], start: at, over: num(p.over, FLIGHT), lift: high ? 0.5 : 0.35 });
    }
  }

  private points(name: string): V3[] {
    return this.resolve(name).map(({ prop, index, part }) => this.point(prop, index, part));
  }

  private newChip(): Tag {
    const tag = new Tag(640, 92, 0.3);
    this.group.add(tag.sprite);
    this.chips.push(tag);
    return tag;
  }

  private title(text: string, t: number): void {
    this.chapter.textContent = text;
    this.chapter.style.opacity = '1';
    this.pending.push({ at: t + 2.6, run: () => (this.chapter.style.opacity = '0') });
  }

  // ------------------------------------------------------------------ crew and pads

  private beamIn(crew: Crew, now: number): void {
    if (crew.character) return;
    crew.character = new Character(crew.view, 'padd', { size: crew.bubble });
    crew.seat.add(crew.character.group);
    crew.console.visible = true;
    this.beams.push(new Beam(crew.console, 'in', now));
    if (crew.gauge) {
      const gauge = crew.gauge;
      this.tweens.push({ kind: 'fade', set: (k) => gauge.setShown(k), from: 0, to: 1, start: (now - this.start!) / 1000 + 1.2, over: 0.6 });
    }
  }

  private beamOut(crew: Crew, now: number): void {
    const { character } = crew;
    if (!character) return;
    crew.character = undefined;
    this.beams.push(
      new Beam(crew.console, 'out', now, () => {
        crew.console.visible = false;
        character.group.removeFromParent();
        character.dispose();
      }),
    );
    if (crew.gauge) {
      const gauge = crew.gauge;
      this.tweens.push({ kind: 'fade', set: (k) => gauge.setShown(k), from: 1, to: 0, start: (now - this.start!) / 1000, over: 1.2 });
    }
  }

  private setView(crew: Crew, line: string, status: AgentStatus = crew.view.status): void {
    if (crew.view.line === line && crew.view.status === status) return;
    crew.view = { ...crew.view, line, status };
    crew.character?.set(crew.view);
  }

  private padIn(pad: Pad, now: number): void {
    if (pad.character) return;
    pad.mesh.visible = true;
    pad.mesh.scale.y = 1;
    const who = helperFor(`stage-pad-${pad.at.join(',')}-${now.toFixed(0)}`);
    pad.view = { name: who.name, avatar: who.avatar, status: 'working', line: '' };
    pad.character = new Character(pad.view, 'standing');
    pad.character.group.position.set(pad.at[0], 0.08, pad.at[2]);
    pad.character.group.rotation.y = facing('left', 25);
    this.group.add(pad.character.group);
    this.beams.push(new Beam(pad.character.group, 'in', now));
  }

  private padOut(pad: Pad, now: number): void {
    const { character } = pad;
    if (!character) return;
    pad.character = undefined;
    this.beams.push(
      new Beam(character.group, 'out', now, () => {
        character.group.removeFromParent();
        character.dispose();
      }),
    );
  }

  /** How long the `n`th agent on pad `i` works, from the cycle's range: the same every run. */
  private work(pads: Extract<Prop, { kind: 'pads' }>, i: number, n: number): number {
    const [lo, hi] = pads.cycle?.work ?? [1, 2];
    const r = (Math.sin((i + 1) * 12.9898 + (n + 1) * 78.233) * 43758.5453) % 1;
    return lo + Math.abs(r) * (hi - lo);
  }

  /** A cycle's waves: each pad's agent finishes, beams off, and the next steps on, until the cycle's total has run. */
  private cycle(pads: Extract<Prop, { kind: 'pads' }>, t: number, now: number): void {
    const c = pads.cycle;
    if (!c) return;
    pads.pads.forEach((pad, i) => {
      if (pad.character && pad.doneAt !== undefined && t >= pad.doneAt && pad.view?.status !== 'done') {
        pad.character.set((pad.view = { ...pad.view!, status: 'done' }));
        c.done++;
        pad.leaveAt = t + 0.5;
      } else if (pad.character && pad.leaveAt !== undefined && t >= pad.leaveAt) {
        this.padOut(pad, now);
        pad.leaveAt = undefined;
        pad.freeAt = t + BEAM_S * 0.6;
      } else if (!pad.character && pad.freeAt !== undefined && t >= pad.freeAt && c.started < c.until) {
        this.padIn(pad, now);
        c.started++;
        pad.freeAt = undefined;
        pad.doneAt = t + BEAM_S * 0.6 + this.work(pads, i, c.started);
      }
    });
  }

  // ------------------------------------------------------------------ each frame

  /** Each frame: the acts that have come, the tweens, the beams, the crew's poses, the camera and the transitions. */
  update(now: number): void {
    const t = this.start === null ? 0 : (now - this.start) / 1000;
    if (this.start !== null) {
      const acts = this.timeline.acts;
      while (this.next < acts.length && acts[this.next].at <= t) this.run(acts[this.next++], t, now);
      const due = this.pending.filter((p) => p.at <= t);
      this.pending = this.pending.filter((p) => p.at > t);
      for (const p of due) p.run();
    }
    for (let i = this.beams.length - 1; i >= 0; i--) if (this.beams[i].update(now)) this.beams.splice(i, 1);
    this.frame(t, now);
  }

  private frame(t: number, now: number): void {
    this.tweens = this.tweens.filter((w) => {
      const k = Math.min(1, Math.max(0, (t - w.start) / Math.max(0.001, w.over)));
      if (t < w.start && w.kind !== 'chip') return true;
      const e = k * k * (3 - 2 * k);
      switch (w.kind) {
        case 'fill':
          w.gauge.set(w.from + (w.to - w.from) * e);
          break;
        case 'fade':
          w.set(w.from + (w.to - w.from) * e);
          break;
        case 'glow':
          w.pulse(k);
          break;
        case 'chip': {
          const going = t >= w.start && k < 1;
          w.tag.opacity = going ? 1 : 0;
          if (going) w.tag.sprite.position.set(w.from[0] + (w.to[0] - w.from[0]) * e, w.from[1] + (w.to[1] - w.from[1]) * e + Math.sin(e * Math.PI) * w.lift, w.from[2] + (w.to[2] - w.from[2]) * e);
          if (k >= 1) w.tag.opacity = 0;
          break;
        }
      }
      return k < 1;
    });
    for (const prop of this.props.values()) {
      if (prop.kind === 'crew' && prop.character) {
        prop.character.update(now / 1000, this.camera.position.distanceTo(prop.console.getWorldPosition(this.tmp)));
      } else if (prop.kind === 'lanes') {
        for (const lane of prop.lanes) if (lane.crew.character) lane.crew.character.update(now / 1000, this.camera.position.distanceTo(lane.crew.console.getWorldPosition(this.tmp)));
      } else if (prop.kind === 'pads') {
        this.cycle(prop, t, now);
        // the crowd on the pads wears no bubbles: a distance of 0 fades them out
        for (const pad of prop.pads) {
          pad.character?.update(now / 1000, 0);
          (pad.mesh.material as THREE.MeshBasicMaterial).color.set(pad.character ? '#d6f2ff' : '#5f8fb3');
        }
        if (prop.template) {
          const running = prop.pads.filter((p) => p.character && p.view?.status !== 'done').length;
          const c = prop.cycle;
          const done = c?.done ?? 0;
          const queued = c ? Math.max(0, c.until - c.started) : 0;
          drawChip(prop.counter, prop.template.replace('{running}', String(running)).replace('{queued}', String(queued)).replace('{done}', String(done)), LCARS.sky);
        }
      } else if (prop.kind === 'list') {
        if (prop.tickFrom !== undefined && prop.every) prop.step = Math.min(prop.items.length, Math.floor((t - prop.tickFrom) / prop.every));
        drawPanel(prop.tag, prop.style === 'cards' ? '' : 'TASKS', prop.items.map((item, i) => ({ text: `${i < prop.step ? '✓' : i === prop.step ? '▸' : '·'} ${item}`, on: i === prop.step, colour: i < prop.step ? GREEN : undefined })));
      } else if (prop.kind === 'slate') {
        drawPanel(prop.tag, prop.title, prop.lines.map((l) => ({ text: l, colour: l.startsWith('→') ? GREEN : undefined })));
      } else if (prop.kind === 'label') {
        drawChip(prop.tag, prop.text, LCARS.sky);
      }
    }
    this.shoot(t);
    this.transitions(t);
    this.caption(t);
  }

  private pose(f: Framing): Pose {
    let pose = this.poses.get(f);
    if (!pose) this.poses.set(f, (pose = solveFraming(f, this.where, innerWidth / innerHeight)));
    return pose;
  }

  /** The camera from the shot the time is in, carried on into the next one where its shot hands over by a move. */
  private shoot(t: number): void {
    const shots = this.timeline.shots;
    const i = Math.max(0, shots.findIndex((s) => t < s.end));
    const shot = t >= this.timeline.duration ? shots[shots.length - 1] : shots[i];
    const { from, to, k } = trackAt(shot.keys, t);
    let pose = lerpPose(this.pose(from), this.pose(to), k);
    const next = shots[shots.indexOf(shot) + 1];
    if (next && shot.out.kind === 'move') {
      const over = shot.out.over ?? 1.2;
      const m = (t - (shot.end - over)) / over;
      if (m > 0) pose = lerpPose(pose, this.pose(next.keys[0].framing), m * m * (3 - 2 * m));
    }
    this.camera.position.copy(this.group.localToWorld(new THREE.Vector3(...pose.pos)));
    this.camera.lookAt(this.group.localToWorld(new THREE.Vector3(...pose.look)));
    if (Math.abs(this.camera.fov - pose.fov) > 0.01) {
      this.camera.fov = pose.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** The grid wipe's band and chapter card, and a dip through dark, either side of a shot's end. */
  private transitions(t: number): void {
    let wipe = 0;
    let dip = 0;
    let title = '';
    for (const [i, shot] of this.timeline.shots.entries()) {
      const over = shot.out.over ?? (shot.out.kind === 'grid-wipe' ? 0.8 : 0.5);
      const d = (t - shot.end) / (over / 2);
      if (Math.abs(d) >= 1) continue;
      if (shot.out.kind === 'grid-wipe') {
        wipe = d;
        title = shot.out.title ?? '';
        // the stage is dressed afresh behind the band
        if (d >= 0 && !this.resetDone.has(i)) {
          this.resetDone.add(i);
          for (const name of shot.out.resets ?? []) for (const { prop } of this.resolve(name)) this.reset(prop);
        }
      } else if (shot.out.kind === 'dissolve') dip = 1 - Math.abs(d);
    }
    // the band sweeps in from the left to cover the screen at the cut, then off to the right
    this.curtain.style.opacity = wipe ? '1' : '0';
    this.curtain.style.clipPath = wipe < 0 ? `inset(0 ${(-wipe * 100).toFixed(1)}% 0 0)` : `inset(0 0 0 ${(wipe * 100).toFixed(1)}%)`;
    (this.curtain.firstChild as HTMLElement).textContent = title;
    this.dip.style.opacity = String(dip);
  }

  private readonly resetDone = new Set<number>();

  /** Puts a prop back as it started, behind a grid wipe: no one on it, nothing shown. */
  private reset(prop: Prop): void {
    switch (prop.kind) {
      case 'crew': {
        const { character } = prop;
        prop.character = undefined;
        prop.console.visible = false;
        character?.group.removeFromParent();
        character?.dispose();
        prop.gauge?.setShown(0);
        break;
      }
      case 'gauge':
        prop.gauge.set(0);
        prop.gauge.setGhost(null);
        prop.gauge.setShown(0);
        break;
      case 'list':
        prop.step = -1;
        prop.tickFrom = undefined;
        prop.tag.opacity = 0;
        break;
      case 'slate':
      case 'label':
        prop.tag.opacity = 0;
        break;
      case 'pads':
        prop.cycle = undefined;
        prop.template = undefined;
        prop.counter.opacity = 0;
        for (const pad of prop.pads) {
          pad.character?.group.removeFromParent();
          pad.character?.dispose();
          pad.character = undefined;
          pad.mesh.visible = false;
        }
        break;
      case 'lanes':
        prop.counter.opacity = 0;
        for (const lane of prop.lanes) {
          for (const tag of [lane.pr, lane.tree]) tag.opacity = 0;
          lane.strip.visible = false;
          this.reset(lane.crew);
        }
        break;
      case 'card':
        prop.el.style.opacity = '0';
        break;
    }
    // whatever was still moving it stops
    this.tweens = this.tweens.filter((w) => !(w.kind === 'fill' && this.gaugeOf(prop) === w.gauge));
  }

  /** Without a narration yet, the beats' words as subtitles, so the timing can be watched. */
  private caption(t: number): void {
    if (!this.timeline.captions) return;
    const beat = [...this.timeline.beats].reverse().find((b) => t >= b.at && t < (b.end ?? Infinity));
    this.subtitle.textContent = beat && this.start !== null ? beat.text : '';
    this.subtitle.style.opacity = this.subtitle.textContent ? '1' : '0';
  }
}
