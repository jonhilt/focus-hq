import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { interactive, type Interaction } from './builder';
import { canvasTexture, makeCanvas } from './canvas';
import { dress } from './deck';
import { type Box2, contains, footprint, footprints } from './layout';
import { flat, occludedToon, toon } from './materials';
import { mergeStatic } from './merge';
import { consoleTexture, LCARS, lcarsFrame, LCARS_FONT } from './starship';

// A transporter room, as on the Enterprise-D: where a goal's lead runs a workflow (one of TRANSPORTER_ROOMS per team
// station, standing far out in the world: layout.ts, transporterRoomAt). Built in Blender (blender/transporter_room.py):
// a platform of three tiers of six pads along its back wall, each with a lit ring and an emitter over it, the transporter
// console in front of it, the pattern buffer's glowing columns in niches either side, a tactical display on the
// starboard wall and a sealed door. Nobody walks in or out: you beam in, and back to the briefing room from the console
// or the door.
// This dresses a copy of the module and hands out its parts, in world coordinates; who stands on the pads, the rings'
// colours, the buffer's glow and what the screens show are up to whoever runs the room.

/** Loads the transporter room module every team station's transporter rooms are copies of. */
export async function loadTransporterRoom(url: string): Promise<THREE.Object3D> {
  const { scene } = await new GLTFLoader().loadAsync(url);
  const room = scene.getObjectByName('transporter_room');
  if (!room) throw new Error('The transporter room GLB needs a transporter_room module');
  return room;
}

/** A transporter pad on the platform, where an agent at work stands. */
export interface TransporterPad {
  /** 0 on the front tier (0.2 m up) to 2 on the back one (0.6 m up). */
  tier: number;
  /** Along its tier, 0 at the door's end (-X) to 5. */
  slot: number;
  /** The middle of the pad's top, where whoever's on it stands (world). */
  at: THREE.Vector3;
  /** The turn about Y (`rotation.y`) that faces a Character, built facing +X, out of the pad into the room (+Z). */
  yaw: number;
  /** Its lit ring, a mesh of its own with a MeshBasicMaterial of its own: set its colour to whoever's on it. */
  ring: THREE.Mesh;
  /** The glow of the emitter in the ceiling over it, its own mesh and MeshBasicMaterial too, to light as someone beams. */
  emitter: THREE.Mesh;
}

/** Somewhere to stand or look from, and what to look at (world). */
export interface Viewpoint {
  at: THREE.Vector3;
  lookAt: THREE.Vector3;
}

/** The turn about Y that faces a Character (built facing +X) along a marker's forward. */
function characterYaw(forward: THREE.Vector3): number {
  return Math.atan2(-forward.z, forward.x);
}

/** A forward (the empty's +Y in Blender, -Z here) turned by an object's world rotation. */
function forwardOf(o: THREE.Object3D): THREE.Vector3 {
  return new THREE.Vector3(0, 0, -1).applyQuaternion(o.getWorldQuaternion(new THREE.Quaternion()));
}

/** The station's colour, shaded by the occlusion baked into the module: one per colour and bake, however many rooms. */
const painted = new Map<string, THREE.Material>();
function paint(accent: string, ao: THREE.Texture | null): THREE.Material {
  const key = `${accent}|${ao?.uuid ?? ''}`;
  let mat = painted.get(key);
  if (!mat) painted.set(key, (mat = ao ? occludedToon(accent, ao) : toon(accent)));
  return mat;
}

/** The console's screen, a metre and a half across its sloping top: its size in metres. */
export const CONSOLE_SCREEN = { w: 1.58, h: 0.638 };

let standbyScreens: { tactical: THREE.Material; buffer: THREE.Material; script: THREE.Material } | null = null;
/**
 * What the screens show until whoever runs the room draws on them, shared by every room: an LCARS frame standing by,
 * and the console's LCARS keys.
 */
function standby(): { tactical: THREE.Material; buffer: THREE.Material; script: THREE.Material } {
  if (standbyScreens) return standbyScreens;
  const draw = (w: number, h: number, title: string, color: string, line: string) => {
    const { canvas, ctx } = makeCanvas(w, h);
    const area = lcarsFrame(ctx, w, h, { title, color, seed: 7101 });
    ctx.fillStyle = LCARS.peach;
    ctx.font = `500 ${Math.round(h * 0.07)}px ${LCARS_FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(line, area.x, area.y + area.h / 2);
    return flat(canvasTexture(canvas));
  };
  return (standbyScreens = {
    tactical: draw(1440, 800, 'Transporter operations', LCARS.orange, 'STANDING BY · NO WORKFLOW RUNNING'),
    buffer: draw(640, 397, 'Pattern buffer', LCARS.lilac, 'BUFFER CLEAR'),
    script: flat(consoleTexture(CONSOLE_SCREEN.w, CONSOLE_SCREEN.h, 71)),
  });
}

export class TransporterRoom {
  /**
   * Its root, standing at the world's origin, so everything in it is in world coordinates. The World puts it in its
   * transporter rooms and draws it only while the camera's in it (World.reveal); to draw it from elsewhere, for a feed,
   * reveal from a point inside it (`world.reveal(room.camera.at)`) before rendering, and from the camera after.
   */
  readonly group = new THREE.Group();
  /** Its 18 pads, tier by tier from the front, each from the door's end. */
  readonly pads: TransporterPad[];
  /** Where you arrive, behind the console, and what you look at: the platform. */
  readonly place: Viewpoint;
  /** The console: pressing E on any of it energises (an `energise` interaction, for this room). */
  readonly console: THREE.Object3D;
  /**
   * The pattern buffer: its two glowing columns (meshes sharing `light`, this room's own MeshBasicMaterial), and its
   * readout on the port wall, a screen to draw on (set its material, as `tactical`).
   */
  readonly buffer: { glow: THREE.Group; light: THREE.MeshBasicMaterial; readout: THREE.Mesh };
  /** The tactical display on the starboard wall, a screen 3.6 × 2 m: set its material to what it shows (UVs the three.js way round). */
  readonly tactical: THREE.Mesh;
  /**
   * The screen across the console's sloping top (CONSOLE_SCREEN), facing whoever stands behind it: LCARS keys until
   * it's set to show the script of the workflow the room's running (as `tactical`), with an energise button of its own
   * then. Pressing E on it energises too, until it's given an interaction of its own.
   */
  readonly script: THREE.Mesh;
  /** Where the camera for the room's feed stands, up in the front corner over the door, what it looks at, and its vertical field of view (degrees) that frames the platform. */
  readonly camera: Viewpoint & { fov: number };
  /** What's in the room but left out of its feed on the briefing room's monitors, like the flow hologram: add it here. */
  readonly offFeed = new THREE.Group();
  /** What the player can't walk into (world): its walls, the platform, the console and the buffer's columns. */
  readonly colliders: Box2[] = [];
  private readonly area: Box2;
  private readonly owned: THREE.Material[] = [];

  constructor(
    kit: THREE.Object3D,
    /** Where the middle of its floor stands (layout.ts: transporterRoomAt). */
    origin: THREE.Vector3,
    /** The holodeck's project, the team station's index in it and this room's among the station's. */
    readonly projectId: string,
    readonly station: number,
    readonly index: number,
    /** The station's colour, for the strips along the platform's risers and the buffer's bands. */
    accent: string,
  ) {
    const module = kit.clone();
    module.position.copy(origin);
    this.group.add(module, this.offFeed);
    this.group.updateMatrixWorld(true);

    const pads = new Map<string, { tier: number; slot: number; at: THREE.Vector3; yaw: number }>();
    // (markers leave the scene once they're read, so where they stand is read as they are)
    let place: { at: THREE.Vector3; forward: THREE.Vector3 } | undefined;
    let camera: { at: THREE.Vector3; forward: THREE.Vector3; fov: number } | undefined;
    let area: THREE.Matrix4 | undefined;
    const { screens, accents, lamps, parts } = dress(module, (o, marker) => {
      switch (marker.kind) {
        case 'collider':
          this.colliders.push(...footprints(o.matrixWorld));
          return;
        case 'pad':
          pads.set(`${marker.tier}-${marker.slot}`, { tier: marker.tier, slot: marker.slot, at: o.getWorldPosition(new THREE.Vector3()), yaw: characterYaw(forwardOf(o)) });
          return;
        case 'place':
          place = { at: o.getWorldPosition(new THREE.Vector3()), forward: forwardOf(o) };
          return;
        case 'camera':
          camera = { at: o.getWorldPosition(new THREE.Vector3()), forward: forwardOf(o), fov: marker.fov };
          return;
        case 'area':
          area = o.matrixWorld.clone();
          return;
        default:
          throw new Error(`The transporter room has a ${marker.kind} marker, which it can't use`);
      }
    });
    if (!place || !camera || !area) throw new Error('The transporter room needs a place, a camera and an area marker');
    if (lamps.length) throw new Error(`The transporter room has a lamp (${lamps[0].name}), which only a team station's door has`);
    this.area = footprint(area);
    for (const mesh of accents) mesh.material = paint(accent, (mesh.material as THREE.MeshToonMaterial).aoMap ?? null);

    // each ring and emitter glow a material of its own, to light in whoever's colour
    const own = (mesh: THREE.Mesh) => {
      const mat = (mesh.material as THREE.MeshBasicMaterial).clone();
      this.owned.push(mat);
      return (mesh.material = mat);
    };
    const find = (kind: 'pad-ring' | 'pad-emitter', tier: number, slot: number) => {
      const found = parts.find(({ part }) => part.kind === kind && part.tier === tier && part.slot === slot);
      if (!found) throw new Error(`The transporter room has no ${kind} for pad ${tier}-${slot}`);
      own(found.mesh);
      return found.mesh;
    };
    this.pads = [...pads.values()]
      .sort((a, b) => a.tier - b.tier || a.slot - b.slot)
      .map((pad) => ({ ...pad, ring: find('pad-ring', pad.tier, pad.slot), emitter: find('pad-emitter', pad.tier, pad.slot) }));

    const tubes = parts.filter(({ part }) => part.kind === 'buffer-glow').map(({ mesh }) => mesh);
    if (!tubes.length) throw new Error('The transporter room has no pattern buffer');
    const light = own(tubes[0]);
    const glow = new THREE.Group();
    glow.name = 'pattern buffer glow';
    module.add(glow);
    for (const tube of tubes) {
      tube.material = light;
      glow.attach(tube);
    }

    const screen = (name: string) => {
      const found = screens.find((s) => s.screen === name);
      if (!found) throw new Error(`The transporter room has no ${name} screen`);
      return found.mesh;
    };
    const drawn = ['transporter-tactical', 'transporter-buffer', 'transporter-script'];
    for (const s of screens) if (!drawn.includes(s.screen)) throw new Error(`The transporter room has a ${s.screen} screen, which it can't draw`);
    this.tactical = screen('transporter-tactical');
    this.tactical.material = standby().tactical;
    const readout = screen('transporter-buffer');
    readout.material = standby().buffer;
    this.buffer = { glow, light, readout };
    this.script = screen('transporter-script');
    this.script.material = standby().script;

    // the console energises, and so does the sealed door
    const energisers: THREE.Object3D[] = [];
    module.traverse((o) => {
      if ((o.userData.interaction as Interaction | undefined)?.kind === 'energise') energisers.push(o);
    });
    const consoles = energisers.filter((o) => o.name.includes('console'));
    if (consoles.length !== 1) throw new Error('The transporter room needs one console to energise from');
    this.console = consoles[0];
    for (const o of energisers) interactive(o, { kind: 'energise', projectId, station, room: index }, o.userData.label as () => string);

    const at = place.at.setY(0);
    this.place = { at, lookAt: at.clone().addScaledVector(place.forward, 4).setY(1.4) };
    const middle = this.pads.reduce((sum, p) => sum.add(p.at), new THREE.Vector3()).divideScalar(this.pads.length);
    this.camera = { at: camera.at, lookAt: camera.at.clone().addScaledVector(camera.forward, camera.at.distanceTo(middle)), fov: camera.fov };

    // hundreds of meshes in a few dozen materials: merged, but for what's lit, drawn on or used
    mergeStatic(module, [...screens.map((s) => s.mesh), ...accents, ...this.pads.flatMap((p) => [p.ring, p.emitter]), glow]);
  }

  /** Whether a world position is in the room. */
  inside(p: THREE.Vector3): boolean {
    return contains(this.area, p);
  }

  dispose(): void {
    for (const mat of this.owned) mat.dispose();
  }
}
