import * as THREE from 'three';
import type { StudioTake } from '../../../shared/types';
import { TAKE_PARAMS, takeBody, takeHelpers } from '../../../shared/takeScript';
import { makeCanvas } from './canvas';
import { modelScene } from './modelScene';
import { LCARS, LCARS_FONT } from './starship';
import { SCENE_STAGE, sheetMoments } from './studio';
import { TakeKit } from './takeKit';

// A scene's contact sheet: the scene at a few moments through it (studio.ts: sheetMoments), each from a little further
// round it, as the captain would see it walking round, in one picture the room sends the office, so the computer can
// look at what it made before the captain does (docs/studio.md). It runs the take's script afresh, in a scene of its own, on a renderer of its own,
// so the room's frame and the take playing on its floor are left as they were.

type Render = (t: number) => void;

/** Runs a take's script with `kit` and the helpers, and hands back its render(t). */
export function runTake(take: StudioTake, kit: TakeKit): Render {
  // a system model is drawn by the holodeck's own renderer, the same way every time
  if (take.model) return modelScene(take.model, kit, take.phases);
  // the computer's own script, run in the captain's browser like the explainers it shows on a station's screen
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const made = new Function(...TAKE_PARAMS, takeBody(take.script)) as (...args: unknown[]) => Render | undefined;
  const helpers: Record<string, unknown> = { kit, THREE, ...takeHelpers(take.phases) };
  const render = made(...TAKE_PARAMS.map((name) => helpers[name]));
  if (!render) throw new Error('The script never defined render(t)');
  return render;
}

/** Each moment's picture, and the sheet of them three by two. */
const TILE = { w: 512, h: 320 };
const COLUMNS = 3;
/** Where the captain looks at a scene from: out beyond its stage, a little above eye height, swinging round from its left to its right through the moments. */
const VIEW = { distance: 13, height: 4.2, look: new THREE.Vector3(0, 1.6, 0), sweep: THREE.MathUtils.degToRad(100) };

let renderer: THREE.WebGLRenderer | null = null;

/**
 * Runs `take` afresh in a scene of its own on the sheet's renderer, sized `w` × `h`, and hands `draw` the renderer, a
 * camera, and a function that draws the scene at a moment from an angle round it (radians, 0 from its front); what
 * `draw` returns, or undefined if it can't be drawn (no WebGL, or the script throws).
 */
function withScene<T>(take: StudioTake, w: number, h: number, draw: (canvas: HTMLCanvasElement, shoot: (t: number, yaw: number) => void) => T): T | undefined {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  const kit = new TakeKit(root);
  try {
    renderer ??= new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    const gl = renderer;
    gl.setPixelRatio(1);
    gl.setSize(w, h, false);
    gl.outputColorSpace = THREE.SRGBColorSpace;
    stage(scene);
    scene.add(root);
    const render = runTake(take, kit);
    const camera = new THREE.PerspectiveCamera(52, w / h, 0.1, 100);
    camera.layers.enableAll();
    return draw(gl.domElement, (t, yaw) => {
      camera.position.set(Math.sin(yaw) * VIEW.distance, VIEW.height, Math.cos(yaw) * VIEW.distance);
      camera.lookAt(VIEW.look);
      render(t);
      kit.update(t, VIEW.distance);
      gl.render(scene, camera);
    });
  } catch {
    return undefined;
  } finally {
    // the kit's own, as the room's takes are disposed (the crew's share the room's materials, so nothing else is)
    kit.dispose();
    for (const own of scene.children) if (own instanceof THREE.Mesh || own instanceof THREE.LineSegments) {
      own.geometry.dispose();
      (own.material as THREE.Material).dispose();
    }
  }
}

/** A JPEG data URL of the scene `take` at its sheet's moments, or undefined if it can't be drawn (no WebGL, or the script throws). */
export function contactSheet(take: StudioTake): string | undefined {
  const moments = sheetMoments(take.seconds, take.phases);
  return withScene(take, TILE.w, TILE.h, (frame, shoot) => {
    const { canvas, ctx } = makeCanvas(TILE.w * COLUMNS, TILE.h * Math.ceil(moments.length / COLUMNS));
    moments.forEach(({ t, label }, i) => {
      shoot(t, moments.length > 1 ? -VIEW.sweep / 2 + (VIEW.sweep * i) / (moments.length - 1) : 0);
      const x = (i % COLUMNS) * TILE.w;
      const y = Math.floor(i / COLUMNS) * TILE.h;
      ctx.drawImage(frame, x, y);
      caption(ctx, x, y, `${t.toFixed(1)}s${label ? ` · ${label}` : ''}`);
    });
    return canvas.toDataURL('image/jpeg', 0.8);
  });
}

/** Each scene version's thumbnail, once drawn, by id@version. */
const thumbs = new Map<string, HTMLCanvasElement | null>();

/**
 * A picture of the scene `take` for the shelf: three quarters of the way through it, from a little to its right, `w` ×
 * `h`, drawn once per version (null if it can't be drawn).
 */
export function sceneThumbnail(take: StudioTake, w = 480, h = 300): HTMLCanvasElement | null {
  const key = `${take.id}@${take.version}`;
  const known = thumbs.get(key);
  if (known !== undefined) return known;
  const drawn = withScene(take, w, h, (frame, shoot) => {
    shoot(take.seconds * 0.75, 0.35);
    const { canvas, ctx } = makeCanvas(w, h);
    ctx.drawImage(frame, 0, 0);
    return canvas;
  }) ?? null;
  thumbs.set(key, drawn);
  return drawn;
}

/** The holodeck round it: navy, the yellow grid, the scene's round stage, and light like the room's. */
function stage(scene: THREE.Scene): void {
  scene.background = new THREE.Color('#141a33');
  const grid = new THREE.GridHelper(34, 34, LCARS.gold, LCARS.gold);
  grid.material.transparent = true;
  grid.material.opacity = 0.5;
  scene.add(grid);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(SCENE_STAGE.radius, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#1b2a55' }));
  floor.position.y = 0.005;
  scene.add(floor);
  scene.add(new THREE.HemisphereLight('#ffffff', '#d9c7a8', 1.9));
  const sun = new THREE.DirectionalLight('#fff4e0', 1.3);
  sun.position.set(3, 8, 6);
  scene.add(sun, new THREE.AmbientLight('#ffffff', 0.35));
}

/** The moment's time (and what lands then) in its corner. */
function caption(ctx: CanvasRenderingContext2D, x: number, y: number, text: string): void {
  ctx.font = `600 22px ${LCARS_FONT}`;
  const w = ctx.measureText(text).width + 28;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(x + 10, y + 10, w, 40);
  ctx.fillStyle = LCARS.gold;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 24, y + 31);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, TILE.w, TILE.h);
}
