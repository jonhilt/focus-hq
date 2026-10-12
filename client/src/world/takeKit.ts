import * as THREE from 'three';
import { helperFor } from '../../../shared/crew';
import type { AgentStatus } from '../../../shared/types';
import { canvasTexture, makeCanvas, wrap } from './canvas';
import { Character } from './character';
import { OVERLAY_LAYER } from './frame';
import { toon } from './materials';
import { LCARS, LCARS_FONT, workstation } from './starship';
import { StationScreen } from './screen';

// The kit a studio take is built from (takes.ts): the studio session's script makes its cast with it once, then sets the
// whole scene from t in render(t). Everything it makes is an ordinary THREE.Object3D in the take's frame (metres: +x to
// the audience's right, +y up, +z towards the audience, the middle of the take's floor at the origin), so the script can
// move, turn, scale and hide it as it likes; a few have a setter or two besides. The kit keeps what it made, to dispose of
// it when the take's replaced.

/** The colours a script can name, as the explainers' are. */
export const KIT_COLOURS: Record<string, string> = {
  orange: LCARS.orange,
  gold: LCARS.gold,
  peach: LCARS.peach,
  lilac: LCARS.lilac,
  peri: LCARS.periwinkle,
  sky: LCARS.sky,
  green: '#99cc66',
  red: '#ff5c5c',
  text: '#e8fbff',
  muted: '#8fa3b8',
};

type V3 = [number, number, number];
const colour = (c: string | undefined, fallback: string) => KIT_COLOURS[c ?? ''] ?? c ?? fallback;
const vec = (p: V3 | undefined) => new THREE.Vector3(...(p ?? [0, 0, 0]));

/** A label floating in the take: always faces you, redrawn only when its text or colour changes. */
export class KitLabel extends THREE.Sprite {
  private readonly canvas = makeCanvas(1024, 256);
  private readonly tex: THREE.CanvasTexture;
  private drawn = '';
  private _text: string;
  private _colour: string;

  constructor(text: string, colour: string, height: number) {
    super();
    this.tex = canvasTexture(this.canvas.canvas);
    this.material = new THREE.SpriteMaterial({ map: this.tex, depthWrite: false, transparent: true, toneMapped: false });
    this.scale.set(height * 4, height, 1);
    this.layers.set(OVERLAY_LAYER);
    this.renderOrder = 10;
    this._text = text;
    this._colour = colour;
    this.redraw();
  }

  get text(): string {
    return this._text;
  }

  set text(text: string) {
    this._text = text;
    this.redraw();
  }

  set colour(c: string) {
    this._colour = colour(c, this._colour);
    this.redraw();
  }

  set opacity(o: number) {
    this.material.opacity = o;
  }

  private redraw(): void {
    const key = `${this._text}|${this._colour}`;
    if (key === this.drawn) return;
    this.drawn = key;
    const { ctx, canvas } = this.canvas;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = `600 84px ${LCARS_FONT}`;
    const lines = wrap(ctx, this._text.toUpperCase(), canvas.width - 80, 2);
    const w = Math.min(canvas.width, Math.max(...lines.map((l) => ctx.measureText(l).width)) + 80);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
    ctx.beginPath();
    ctx.roundRect((canvas.width - w) / 2, 20, w, canvas.height - 40, 40);
    ctx.fill();
    ctx.fillStyle = this._colour;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((l, i) => ctx.fillText(l, canvas.width / 2, canvas.height / 2 + (i - (lines.length - 1) / 2) * 90));
    this.tex.needsUpdate = true;
  }

  dispose(): void {
    this.tex.dispose();
    this.material.dispose();
  }
}

/** A crew member: standing, or seated at a console. `say` sets their bubble's line, `status` their pose. */
export class KitCrew extends THREE.Group {
  readonly character: Character;
  private view: ConstructorParameters<typeof Character>[0];

  constructor(name: string, line: string, seated: THREE.Group | null) {
    super();
    const who = helperFor(`studio-${name}`);
    this.view = { name, avatar: who.avatar, status: 'working', line };
    this.character = new Character(this.view, seated ? 'keyboard' : 'standing', { size: 0.8 });
    (seated ?? this).add(this.character.group);
  }

  say(line: string): void {
    if (line === this.view.line) return;
    this.view = { ...this.view, line };
    this.character.set(this.view);
  }

  set status(status: AgentStatus) {
    if (status === this.view.status) return;
    this.view = { ...this.view, status };
    this.character.set(this.view);
  }
}

/** The kit for one take: what its script makes things with, and what it made. */
export class TakeKit {
  readonly colours = KIT_COLOURS;
  private readonly made: { dispose(): void }[] = [];
  private readonly crew: KitCrew[] = [];
  private readonly beams = new Map<THREE.Object3D, THREE.Mesh>();

  constructor(private readonly root: THREE.Group) {}

  private place<T extends THREE.Object3D>(obj: T, at?: V3, face?: number): T {
    obj.position.copy(vec(at));
    if (face !== undefined) obj.rotation.y = face;
    this.root.add(obj);
    return obj;
  }

  private material(c: string | undefined, fallback: string, glow?: boolean): THREE.Material {
    const m = glow ? new THREE.MeshBasicMaterial({ color: colour(c, fallback), toneMapped: false, transparent: true }) : toon(colour(c, fallback));
    this.made.push(m);
    return m;
  }

  private geometry<G extends THREE.BufferGeometry>(g: G): G {
    this.made.push(g);
    return g;
  }

  /** Puts a THREE object the script made itself in the take (its geometry and materials are the script's to keep). */
  add<T extends THREE.Object3D>(obj: T): T {
    this.root.add(obj);
    return obj;
  }

  /** A box `size` [w, h, d] standing on its base at `at`. */
  box(o: { size?: V3; at?: V3; colour?: string; glow?: boolean; face?: number } = {}): THREE.Mesh {
    const [w, h, d] = o.size ?? [0.5, 0.5, 0.5];
    const mesh = new THREE.Mesh(this.geometry(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0)), this.material(o.colour, LCARS.peach, o.glow));
    return this.place(mesh, o.at, o.face);
  }

  /** A ball of radius `r` centred on `at`; `glow` makes it shine (unlit). */
  ball(o: { r?: number; at?: V3; colour?: string; glow?: boolean } = {}): THREE.Mesh {
    const mesh = new THREE.Mesh(this.geometry(new THREE.SphereGeometry(o.r ?? 0.25, 24, 16)), this.material(o.colour, LCARS.sky, o.glow));
    return this.place(mesh, o.at ?? [0, o.r ?? 0.25, 0]);
  }

  /** A crew member standing at `at`, facing `face` (radians, 0 towards the audience), with a bubble saying `line`. */
  person(o: { name?: string; line?: string; at?: V3; face?: number } = {}): KitCrew {
    const c = new KitCrew(o.name ?? 'Crew', o.line ?? '', null);
    this.crew.push(c);
    return this.place(c, o.at, o.face ?? 0);
  }

  /** A console with a crew member seated at it, at `at`, turned `face`; the console's screen says `screen`. */
  station(o: { name?: string; line?: string; at?: V3; face?: number; colour?: string; screen?: string } = {}): KitCrew {
    const screen = new StationScreen(null, o.screen ?? '');
    this.made.push(screen);
    const ws = workstation(screen.material, colour(o.colour, LCARS.orange));
    const c = new KitCrew(o.name ?? 'Crew', o.line ?? '', ws.seat);
    c.add(ws.group);
    this.crew.push(c);
    return this.place(c, o.at, o.face ?? 0);
  }

  /** A transporter pad on the floor at `at`. */
  pad(o: { at?: V3; colour?: string } = {}): THREE.Mesh {
    const mesh = new THREE.Mesh(this.geometry(new THREE.CylinderGeometry(0.42, 0.46, 0.08, 32).translate(0, 0.04, 0)), this.material(o.colour, '#5f8fb3', true));
    return this.place(mesh, o.at);
  }

  /** Words floating in the take, `size` metres high (always facing you); set `.text` to change them. */
  label(text: string, o: { at?: V3; colour?: string; size?: number } = {}): KitLabel {
    const l = new KitLabel(text, colour(o.colour, KIT_COLOURS.text), o.size ?? 0.35);
    this.made.push(l);
    return this.place(l, o.at ?? [0, 2, 0]);
  }

  /** A glowing strip along the floor (or through the air) from `from` to `to`; set `.scale.x` (0 → 1) to draw part of it. */
  line(from: V3, to: V3, o: { colour?: string; width?: number } = {}): THREE.Mesh {
    const a = vec(from);
    const along = vec(to).sub(a);
    const g = this.geometry(new THREE.BoxGeometry(along.length(), o.width ?? 0.06, o.width ?? 0.06).translate(along.length() / 2, 0, 0));
    const mesh = new THREE.Mesh(g, this.material(o.colour, LCARS.sky, true));
    mesh.position.copy(a).setY(Math.max(a.y, 0.03));
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), along.clone().normalize());
    this.root.add(mesh);
    return mesh;
  }

  /**
   * Beams `obj` in as `k` goes from 0 to 1 (out as it goes back): a column of light rises round it and it shimmers into
   * being. At 0 it's gone, at 1 it's simply there.
   */
  beam(obj: THREE.Object3D, k: number): void {
    let column = this.beams.get(obj);
    if (!column) {
      const m = new THREE.MeshBasicMaterial({ color: '#bfe9ff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
      column = new THREE.Mesh(this.geometry(new THREE.CylinderGeometry(0.5, 0.5, 2.4, 24, 1, true).translate(0, 1.2, 0)), m);
      this.made.push(m);
      this.root.add(column);
      this.beams.set(obj, column);
    }
    const shown = THREE.MathUtils.clamp(k, 0, 1);
    column.position.copy(obj.position);
    column.visible = shown > 0 && shown < 1;
    (column.material as THREE.MeshBasicMaterial).opacity = Math.sin(shown * Math.PI) * 0.55;
    obj.visible = shown > 0.35;
    // a flicker while it forms
    const forming = shown < 1 ? 0.6 + 0.4 * Math.sin(shown * 60) : 1;
    obj.scale.setScalar(shown < 1 ? (0.85 + 0.15 * shown) * forming : 1);
  }

  /** Moves the crew's animation on (bubbles and poses), seen from `eye` metres away. */
  update(t: number, eye: number): void {
    for (const c of this.crew) c.character.update(t, eye);
  }

  dispose(): void {
    for (const m of this.made) m.dispose();
    this.root.clear();
  }
}

/** Eases from 0 to 1 between `a` and `b` seconds, as the explainers' p() does. */
export const ease = (t: number, a: number, b: number): number => {
  const k = THREE.MathUtils.clamp((t - a) / (b - a || 1), 0, 1);
  return k * k * (3 - 2 * k);
};
