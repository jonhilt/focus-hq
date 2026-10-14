import * as THREE from 'three';
import { edgeFor, layoutModel, MODEL_LAYOUT } from '../../../shared/systemModel';
import { p, type TakePhases } from '../../../shared/takeScript';
import type { ModelCite, ModelEdgeKind, ModelKind, SystemModel } from '../../../shared/types';
import { canvasTexture, makeCanvas, UI_FONT, wrap } from './canvas';
import { OVERLAY_LAYER } from './frame';
import { toonMaterial } from './materials';
import { LCARS, LCARS_FONT } from './starship';
import { SCENE_STAGE } from './studio';
import { type KitLabel, KIT_COLOURS, type TakeKit } from './takeKit';

// A system model drawn the one fixed way (docs/studio.md), so every model reads the same: each part a shape for its
// kind, coloured by its layer, standing where layoutModel puts it; each connection a bar coloured by its kind, with an
// arrowhead towards the part it reaches; and the scenario as a gold token moving along the connections in order,
// carrying its payload. What the office couldn't find in the code is red. A legend floats over it all, facing you
// wherever you stand, with the question it answers, what was simplified, and questions to check yourself with.

type Render = (t: number) => void;
/** How high the lowest part in a stack stands (shared/systemModel.ts: MODEL_LAYOUT). */
const HEIGHT = MODEL_LAYOUT.base;
const RED = '#ff5c5c';
/** Layers take these colours, in the order they first appear. */
const LAYER_COLOURS = [LCARS.sky, LCARS.peach, LCARS.lilac, '#99cc66', LCARS.gold, LCARS.periwinkle, LCARS.orange, '#e8fbff'];
/** What each kind of connection is drawn in. */
export const EDGE_COLOURS: Record<ModelEdgeKind, string> = { calls: LCARS.sky, reads: '#99cc66', writes: LCARS.orange, emits: LCARS.lilac, renders: LCARS.periwinkle };
/** Each kind of part's shape, and what the legend calls it. */
const SHAPES: Record<ModelKind, { name: string; make: () => THREE.BufferGeometry }> = {
  ui: { name: 'panel', make: () => new THREE.BoxGeometry(1.1, 0.75, 0.08) },
  route: { name: 'hexagon', make: () => new THREE.CylinderGeometry(0.42, 0.42, 0.3, 6) },
  handler: { name: 'cube', make: () => new THREE.BoxGeometry(0.6, 0.6, 0.6) },
  service: { name: 'slab', make: () => new THREE.BoxGeometry(0.95, 0.5, 0.7) },
  store: { name: 'drum', make: () => new THREE.CylinderGeometry(0.42, 0.42, 0.7, 24) },
  queue: { name: 'pipe', make: () => new THREE.CapsuleGeometry(0.2, 0.8, 6, 12).rotateZ(Math.PI / 2) },
  external: { name: 'globe', make: () => new THREE.IcosahedronGeometry(0.42, 1) },
  job: { name: 'cone', make: () => new THREE.ConeGeometry(0.38, 0.7, 20) },
  type: { name: 'gem', make: () => new THREE.OctahedronGeometry(0.34) },
};

const fileLine = (c?: ModelCite) => (c ? `${c.file.split(/[\\/]/).pop() ?? c.file}:${c.line}` : 'no cite');

/** Builds `model` with `kit`, and hands back its render(t): the scenario's steps timed by `phases` (s1, s2…). */
export function modelScene(model: SystemModel, kit: TakeKit, phases: TakePhases = {}): Render {
  const at = layoutModel(model, SCENE_STAGE.radius - 1);
  const layers = [...new Set(model.nodes.map((n) => n.layer))];
  const layerColour = (layer: string) => LAYER_COLOURS[layers.indexOf(layer) % LAYER_COLOURS.length];
  const pos = (id: string) => {
    const p = at.get(id) ?? { x: 0, y: HEIGHT, z: 0 };
    return new THREE.Vector3(p.x, p.y, p.z);
  };

  const columnOf = (v: THREE.Vector3) => `${v.x.toFixed(2)}|${v.z.toFixed(2)}`;
  const lowest = new Map<string, string>();
  for (const n of model.nodes) {
    const key = columnOf(pos(n.id));
    const held = lowest.get(key);
    if (!held || pos(n.id).y < pos(held).y) lowest.set(key, n.id);
  }

  // the parts: a shape on a stem, its label over it and where it is in the code under that
  for (const n of model.nodes) {
    const where = pos(n.id);
    const shape = new THREE.Mesh(kit.keep(SHAPES[n.kind].make()), kit.keep(toonMaterial({ color: layerColour(n.layer) })));
    shape.position.copy(where);
    kit.add(shape);
    // a stem down to the floor for the lowest in its column, so the column stands rather than floats
    if (lowest.get(columnOf(where)) === n.id) {
      const stem = new THREE.Mesh(kit.keep(new THREE.CylinderGeometry(0.03, 0.03, where.y - 0.3, 8).translate(0, (where.y - 0.3) / 2, 0)), kit.keep(new THREE.MeshBasicMaterial({ color: layerColour(n.layer), transparent: true, opacity: 0.5 })));
      stem.position.set(where.x, 0, where.z);
      kit.add(stem);
    }
    if (n.found === false) {
      const ring = new THREE.Mesh(kit.keep(new THREE.TorusGeometry(0.62, 0.035, 8, 40)), kit.keep(new THREE.MeshBasicMaterial({ color: RED, toneMapped: false })));
      ring.position.copy(where);
      kit.add(ring);
    }
    kit.label(n.label, { at: [where.x, where.y + 0.78, where.z], size: 0.36, colour: layerColour(n.layer) });
    kit.label(fileLine(n.cite), { at: [where.x, where.y + 0.48, where.z], size: 0.24, colour: n.found === false ? RED : KIT_COLOURS.muted });
  }

  // the connections: a bar in their kind's colour, and an arrowhead two thirds along, towards the part reached
  const bars = new Map<string, THREE.Mesh>();
  for (const e of model.edges) {
    const a = pos(e.from);
    const b = pos(e.to);
    const colour = e.backed === false ? RED : EDGE_COLOURS[e.kind];
    const bar = kit.line([a.x, a.y, a.z], [b.x, b.y, b.z], { colour, width: e.backed === false ? 0.03 : 0.05 });
    bars.set(`${e.from}>${e.to}`, bar);
    const head = new THREE.Mesh(kit.keep(new THREE.ConeGeometry(0.1, 0.26, 12)), kit.keep(new THREE.MeshBasicMaterial({ color: colour, toneMapped: false })));
    head.position.lerpVectors(a, b, 0.66);
    head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    kit.add(head);
  }

  // the scenario: a token along each step's connection in turn, carrying its payload, and a caption over it all
  const token = kit.ball({ r: 0.16, colour: 'gold', glow: true });
  const payload = kit.label('', { size: 0.3, colour: 'gold' });
  const caption = kit.label(model.question, { at: [0, 4.8, 0], size: 0.45, colour: 'text' });
  legend(model, layers, layerColour, kit);
  const span = (i: number): [number, number] => phases[`s${i + 1}`] ?? [i * 1.8 + 2, (i + 1) * 1.8 + 2];

  return (t) => {
    const i = model.trace.findIndex((_, k) => t >= span(k)[0] && t < span(k)[1]);
    for (const bar of bars.values()) bar.scale.set(1, 1, 1);
    const step = model.trace[i] as (typeof model.trace)[number] | undefined;
    token.visible = !!step;
    payload.visible = !!step?.payload;
    if (!step) {
      setText(caption, t < span(0)[0] ? model.question : `${model.trace.length} steps · ${model.question}`);
      return;
    }
    const [from, to] = span(i);
    const k = p(t, from + 0.15, to - 0.25);
    const a = pos(step.from);
    const b = pos(step.to);
    token.position.lerpVectors(a, b, k);
    token.position.y += Math.sin(k * Math.PI) * 0.35;
    payload.position.copy(token.position).setY(token.position.y + 0.45);
    setText(payload, step.payload ?? '');
    const edge = edgeFor(model.edges, step.from, step.to);
    const bar = edge && bars.get(`${edge.from}>${edge.to}`);
    if (bar) bar.scale.set(1, 2.4, 2.4);
    setText(caption, `Step ${i + 1} of ${model.trace.length} · ${step.label}`);
  };
}

const setText = (l: KitLabel, text: string) => {
  if (l.text !== text) l.text = text;
};

/** The legend, floating over the model and turning to face you: what the shapes, colours and lines mean, and the model's caveats. */
function legend(model: SystemModel, layers: string[], layerColour: (l: string) => string, kit: TakeKit): void {
  const W = 1400;
  const { canvas, ctx } = makeCanvas(W, 900);
  ctx.fillStyle = 'rgba(2, 8, 20, 0.86)';
  ctx.beginPath();
  ctx.roundRect(0, 0, W, 900, 36);
  ctx.fill();
  let y = 70;
  const head = (text: string) => {
    ctx.font = `600 44px ${LCARS_FONT}`;
    ctx.fillStyle = LCARS.gold;
    ctx.fillText(text, 50, y);
    y += 50;
  };
  const chips = (items: [string, string][]) => {
    ctx.font = `500 34px ${UI_FONT}`;
    let x = 50;
    for (const [text, colour] of items) {
      const w = ctx.measureText(text).width + 70;
      if (x + w > W - 40) {
        x = 50;
        y += 52;
      }
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.arc(x + 16, y - 11, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e8fbff';
      ctx.fillText(text, x + 40, y);
      x += w;
    }
    y += 66;
  };
  head('SHAPE = KIND OF PART');
  chips((Object.keys(SHAPES) as ModelKind[]).filter((k) => model.nodes.some((n) => n.kind === k)).map((k) => [`${k} (${SHAPES[k].name})`, '#8fa3b8']));
  head('COLOUR = LAYER');
  chips(layers.map((l) => [l, layerColour(l)]));
  head('LINE = CONNECTION · GOLD TOKEN = THE SCENARIO\'S DATA');
  chips([...(Object.keys(EDGE_COLOURS) as ModelEdgeKind[]).filter((k) => model.edges.some((e) => e.kind === k)).map((k): [string, string] => [k, EDGE_COLOURS[k]]), ['not found in the code', RED]]);
  const notes: [string, string[]][] = [['SIMPLIFIED', model.simplified], ['CHECK YOURSELF', (model.checks ?? []).map((c) => c.q)]];
  for (const [title, list] of notes) {
    if (!list.length || y > 820) continue;
    head(title);
    ctx.font = `500 30px ${UI_FONT}`;
    ctx.fillStyle = '#b9cadb';
    for (const item of list) {
      for (const line of wrap(ctx, `· ${item}`, W - 100, 2)) {
        if (y > 870) break;
        ctx.fillText(line, 50, y);
        y += 38;
      }
    }
    y += 22;
  }
  const tex = kit.keep(canvasTexture(canvas));
  const sprite = new THREE.Sprite(kit.keep(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true, toneMapped: false })));
  sprite.scale.set(4.2, 2.7, 1);
  sprite.position.set(0, 7, 0);
  sprite.layers.set(OVERLAY_LAYER);
  kit.add(sprite);
}
