// The architecture space (README.md): a platform out in the dark, the project's whole map straight ahead and its
// other views floating round you, each a hologram you read up close with E. You come here by stepping into the
// miniature over the astrometrics table in the project's holodeck (client.ts), and leave by the arch behind you.
// One space serves every project: it shows the views of the project whose table you came through, and next to the
// whole map, what each of its goals under way does to it (slice.ts).
import * as THREE from 'three';
import { canvasTexture, Hologram, hover, makeCanvas, OVERLAY_LAYER, type Place, type PluginSpace, type ShipHost, SPACE, type Ui } from '../../plugin-api/client';
import { ARCH, HolodeckArch } from './arch';
import { openView } from './panel';
import { drawNote, drawView } from './screen';
import { sliceViews } from './slice';
import type { CartographyState, MapView, RepoMap } from './shared';
import { ARRIVAL, EXIT_ARCH, MAX_PANELS, type PanelSpot, panelSpots, PLATFORM, type Point, reachOf } from './spaceLayout';
import { CHANGES, screenVersion, spaceViews, WHOLE } from './views';

/** The canvas each view's drawn on. */
const PX = { w: 1280, h: 800 } as const;
/** How often (s) the space looks for views that changed, while you're in it. */
const CHECK_EVERY = 1;

interface Panel {
  mesh: THREE.Mesh;
  hologram: Hologram;
  texture: THREE.CanvasTexture;
  y: number;
}

const vec = (p: Point) => new THREE.Vector3(p.x, p.y, p.z);

/** A hint's name for a view. */
const titleOf = (map: RepoMap, view: MapView): string =>
  view.id === WHOLE.id ? `${map.repo}'s whole map` : view.id === CHANGES.id ? `how ${map.repo} changes` : `the map: ${view.question}`;

/** Something the space puts up: a key that changes when its drawing would, its hint's name, how it's drawn and what E on it opens. */
interface Item {
  key: string;
  title: string;
  draw: (ctx: CanvasRenderingContext2D) => void | Promise<void>;
  open: (ui: Ui) => void;
}

/**
 * What the space puts up for a project, in the order of its spots: each repo's whole map, then what each goal under way
 * does to it, then the repos' own views and how each changes.
 */
function items(repos: readonly RepoMap[], state: CartographyState | undefined, projectId: string): Item[] {
  const shown = spaceViews(repos);
  const wholes = shown.filter(({ view }) => view.id === WHOLE.id).length;
  const views = shown.map(({ map, view }): Item => ({
    key: `${map.repo}#${screenVersion(map, view)}`,
    title: titleOf(map, view),
    draw: (ctx) => drawView(ctx, PX.w, PX.h, map, view),
    open: (ui) => openView(ui, map, view),
  }));
  const slices = sliceViews(state?.slices[projectId] ?? [], repos).map(({ slice, map, view, marks, key }): Item => ({
    key,
    title: `what ${slice.title} changes`,
    draw: (ctx) => drawView(ctx, PX.w, PX.h, map, view, marks, `${slice.title} · TS-${slice.station + 1} · ${map.repo}, its lead's checkout against the default branch`),
    open: (ui) => openView(ui, map, view, marks),
  }));
  return [...views.slice(0, wholes), ...slices, ...views.slice(wholes)].slice(0, MAX_PANELS);
}

export class ArchitectureSpace {
  private readonly arch = new HolodeckArch();
  private readonly views = new THREE.Group();
  private panels: Panel[] = [];
  private readonly disposables: { dispose(): void }[] = [];
  /** The project whose views it shows, where you go back to, and what its views were drawn from. */
  private shown: { projectId: string; name: string; back: Place } | null = null;
  private drawnKey = '';
  private checked = -Infinity;
  private lastT = 0;

  constructor(
    private readonly space: PluginSpace,
    private readonly host: ShipHost,
    private readonly maps: () => CartographyState | undefined,
  ) {
    this.sky();
    this.platform();
    this.arch.group.position.copy(vec(EXIT_ARCH.at));
    host.interactive(this.arch.group, () => `Computer, exit: back to ${this.shown?.name ?? 'the bridge'}`, (ui) => this.leave(ui));
    this.space.root.add(this.arch.group, this.views);
  }

  /** Where you are, for the HUD. */
  label(): string {
    return this.shown ? `${this.shown.name} · architecture` : 'Architecture';
  }

  /** Takes the captain into the space, from `projectId`'s holodeck, to its views; `back` is where they go back to. */
  enter(ui: Ui, projectId: string, name: string, back: Place): void {
    if (this.shown?.projectId !== projectId) this.clear();
    this.shown = { projectId, name, back };
    this.checked = -Infinity;
    const look = (p: Point) => this.space.toWorld(vec(p));
    ui.dive({ label: `${name}'s architecture`, projectId, position: look(ARRIVAL.at), lookAt: look(ARRIVAL.lookAt), unlisted: true });
  }

  /** Back to the holodeck you came from; or, when the page was loaded here and there's none, to the bridge (the first place). */
  private leave(ui: Ui): void {
    const to = this.shown?.back ?? ui.places()[0];
    if (to) ui.dive(to);
  }

  update(t: number, camera: THREE.Vector3): void {
    const dt = Math.min(0.1, t - this.lastT);
    this.lastT = t;
    if (camera.distanceTo(this.space.root.position) > SPACE.radius) return;
    this.arch.update(t);
    this.panels.forEach((p, i) => {
      hover(p.mesh, p.y, t, i + 1);
      p.hologram.update(dt);
    });
    if (t - this.checked < CHECK_EVERY) return;
    this.checked = t;
    this.sync();
  }

  /** Puts up the shown project's views again when they've changed (a new map, a view added), drawing each as it comes. */
  private sync(): void {
    if (!this.shown) return;
    const state = this.maps();
    const repos = state?.maps[this.shown.projectId];
    const views = items(repos ?? [], state, this.shown.projectId);
    const key = repos ? views.map((v) => v.key).join('\n') : 'unmapped';
    if (key === this.drawnKey) return;
    this.clear();
    this.drawnKey = key;
    const spots = panelSpots(Math.max(1, views.length));
    if (!views.length) {
      const why = repos ? 'None of its repos has a model yet: each keeps one in .focus/cartography.yaml.' : 'It hasn’t been mapped yet: it will be in a moment.';
      this.put(spots[0], `${this.shown.name} has no map yet`, null, (ctx) => drawNote(ctx, PX.w, PX.h, `${this.shown?.name ?? 'This project'} has no map yet`, why));
      return;
    }
    views.forEach((v, i) => this.put(spots[i], v.title, v.open, v.draw));
  }

  /** A view's hologram at `spot`, drawn by `draw`; E on it does `use`. */
  private put(spot: PanelSpot, title: string, use: ((ui: Ui) => void) | null, draw: (ctx: CanvasRenderingContext2D) => void | Promise<void>): void {
    const { canvas, ctx } = makeCanvas(PX.w, PX.h);
    const texture = canvasTexture(canvas);
    const hologram = new Hologram(texture, PX.w / PX.h);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(spot.width, spot.width / (PX.w / PX.h)), hologram.material);
    mesh.position.copy(vec(spot.at));
    mesh.rotation.y = spot.yaw;
    // drawn over the outlines (frame.ts), like the holodeck's screens
    mesh.layers.set(OVERLAY_LAYER);
    mesh.userData.aim = (on: boolean) => (hologram.aimed = on);
    if (use) this.host.interactive(mesh, () => `Look at ${title}`, use, reachOf(spot));
    this.views.add(mesh);
    const panel: Panel = { mesh, hologram, texture, y: spot.at.y };
    this.panels.push(panel);
    void Promise.resolve(draw(ctx))
      .then(() => (texture.needsUpdate = true))
      .catch((err: unknown) => console.error(`cartography's view ${title}:`, err));
  }

  private clear(): void {
    for (const p of this.panels) {
      this.views.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.hologram.dispose();
      p.texture.dispose();
    }
    this.panels = [];
    this.drawnKey = '';
  }

  /** The dark round it: a sphere of stars, far enough out that you never reach it. */
  private sky(): void {
    const r = SPACE.radius * 0.8;
    const dark = new THREE.Mesh(this.own(new THREE.SphereGeometry(r, 32, 16)), this.own(new THREE.MeshBasicMaterial({ color: '#03040c', side: THREE.BackSide, depthWrite: false })));
    dark.renderOrder = -1;
    const n = 1800;
    const at = new Float32Array(n * 3);
    // the same stars every time: a seeded walk rather than Math.random
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize().multiplyScalar(r * 0.95);
      at.set([v.x, v.y, v.z], i * 3);
    }
    const geometry = this.own(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.BufferAttribute(at, 3));
    const stars = new THREE.Points(geometry, this.own(new THREE.PointsMaterial({ color: '#c8d2ff', size: 1.6, sizeAttenuation: false, toneMapped: false })));
    this.space.root.add(dark, stars);
  }

  /** The platform you stand on, its rim lit, and a ring of walls you can't see so you don't step off it. */
  private platform(): void {
    const deck = new THREE.Mesh(this.own(new THREE.CylinderGeometry(PLATFORM.radius, PLATFORM.radius * 0.9, 0.3, 64)), this.own(new THREE.MeshStandardMaterial({ color: '#1b2030', roughness: 0.5, metalness: 0.5 })));
    deck.position.y = -0.15;
    const rim = new THREE.Mesh(
      this.own(new THREE.RingGeometry(PLATFORM.radius - 0.12, PLATFORM.radius - 0.04, 96)),
      this.own(new THREE.MeshBasicMaterial({ color: '#ff9900', toneMapped: false })),
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.003;
    this.space.root.add(deck, rim);
    const n = 24;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const p = this.space.toWorld(new THREE.Vector3(Math.cos(a) * (PLATFORM.radius + 0.2), 0, Math.sin(a) * (PLATFORM.radius + 0.2)));
      this.host.collide({ minX: p.x - 0.45, maxX: p.x + 0.45, minZ: p.z - 0.45, maxZ: p.z + 0.45 });
    }
    // and the arch at its back, so you walk up to it rather than through it
    const arch = this.space.toWorld(vec(EXIT_ARCH.at));
    const half = ARCH.width / 2 + ARCH.pillar;
    this.host.collide({ minX: arch.x - half, maxX: arch.x + half, minZ: arch.z - ARCH.depth / 2, maxZ: arch.z + ARCH.depth / 2 });
  }

  private own<T extends { dispose(): void }>(thing: T): T {
    this.disposables.push(thing);
    return thing;
  }

  dispose(): void {
    this.clear();
    this.arch.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
