import * as THREE from 'three';
import { dataView, type Drawing, type ModelFocus, sequenceView, structureView } from '../../../shared/modelDrawing';
import type { TakePhases } from '../../../shared/takeScript';
import type { SystemModel } from '../../../shared/types';
import { interactive } from './builder';
import { canvasTexture, makeCanvas } from './canvas';
import { paintDrawing } from './drawingCanvas';
import { OVERLAY_LAYER } from './frame';
import { Hologram } from './hologram';
import type { TakeKit } from './takeKit';

// A system model in the studio (docs/studio.md), drawn flat on three hologram boards standing round the middle of the
// hall, each a view of the same model (shared/modelDrawing.ts): its structure in the middle, the scenario as a sequence
// diagram on the right, and what moves at each step on the left. The scenario steps across all three together, in time
// with the scene's clock, so it plays, pauses and scrubs like any scene. E on a board opens the model up close
// (ui/modelPanel.ts), where a part can be picked to see its source.

type Render = (t: number) => void;
type View = (m: SystemModel, focus: ModelFocus) => Drawing;

/** Each board: its view, how wide it stands (m), where (the scene's frame: +z towards the entrance), and its turn towards the middle. */
const BOARDS: { view: View; width: number; at: [number, number]; turn: number; tint: string }[] = [
  { view: structureView, width: 6.4, at: [0, -0.4], turn: 0, tint: '#ffcc66' },
  { view: sequenceView, width: 4.8, at: [5.2, 1.2], turn: -0.75, tint: '#99ccff' },
  { view: dataView, width: 3.6, at: [-4.9, 1.2], turn: 0.75, tint: '#99ccff' },
];
/** How high a board's foot stands off the floor, and how sharp its picture is (canvas pixels per drawing unit). */
const FOOT = 0.7;
const SHARP = 1.25;

class Board {
  readonly mesh: THREE.Mesh;
  private readonly hologram: Hologram;
  private readonly texture: THREE.CanvasTexture;
  private readonly c: ReturnType<typeof makeCanvas>;
  private readonly width: number;

  constructor(private readonly view: View, private readonly model: SystemModel, width: number, tint: string, kit: TakeKit) {
    const first = view(model, {});
    this.width = width;
    this.c = makeCanvas(Math.round(first.w * SHARP), Math.round(first.h * SHARP));
    this.texture = kit.keep(canvasTexture(this.c.canvas));
    this.hologram = kit.keep(new Hologram(this.texture, first.w / first.h));
    this.hologram.tint.set(tint);
    this.mesh = new THREE.Mesh(kit.keep(new THREE.PlaneGeometry(1, 1)), this.hologram.material);
    this.mesh.layers.set(OVERLAY_LAYER);
    // solid, not glass: a diagram has to read without the hall (or the far wall's sign) showing through it
    this.hologram.aimed = true;
    interactive(this.mesh, { kind: 'studio-model' }, () => 'Open the model up close', 20);
    this.draw({});
  }

  /** Draws its view at `focus`, sized to what it draws (a longer scenario makes a taller sequence). */
  draw(focus: ModelFocus): void {
    const d = this.view(this.model, focus);
    const w = Math.round(d.w * SHARP);
    const h = Math.round(d.h * SHARP);
    if (this.c.canvas.width !== w || this.c.canvas.height !== h) Object.assign(this.c.canvas, { width: w, height: h });
    paintDrawing(this.c.ctx, d, SHARP);
    this.texture.needsUpdate = true;
    const tall = (this.width * d.h) / d.w;
    this.mesh.scale.set(this.width, tall, 1);
    this.mesh.position.y = FOOT + tall / 2;
  }

  update(dt: number): void {
    this.hologram.update(dt);
  }
}

/** Builds `model`'s boards with `kit`, and hands back its render(t): the scenario's steps timed by `phases` (s1, s2…). */
export function modelScene(model: SystemModel, kit: TakeKit, phases: TakePhases = {}): Render {
  const boards = BOARDS.map(({ view, width, at, turn, tint }) => {
    const b = new Board(view, model, width, tint, kit);
    b.mesh.position.x = at[0];
    b.mesh.position.z = at[1];
    b.mesh.rotation.y = turn;
    kit.add(b.mesh);
    return b;
  });
  const span = (i: number): [number, number] => phases[`s${i + 1}`] ?? [i * 1.8 + 2, (i + 1) * 1.8 + 2];
  let shown: number | undefined = -1;
  let last = 0;
  return (t) => {
    const found = model.trace.findIndex((_, k) => t >= span(k)[0] && t < span(k)[1]);
    const step = found < 0 ? undefined : found;
    if (step !== shown) {
      shown = step;
      for (const b of boards) b.draw({ step });
    }
    const dt = Math.min(0.1, Math.abs(t - last));
    last = t;
    for (const b of boards) b.update(dt);
  };
}
