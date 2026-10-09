import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { interactive } from './builder';
import { type Crew, type DeckScreen, type Marker, readInteraction, readMarker, readSurface, type ScreenName, type Surface } from './deckExtras';
import { type Box2, contains, footprint, type Seat } from './layout';
import { flat, occludedToon, toon } from './materials';
import { mergeStatic } from './merge';
import type { Place } from './office';
import { lcarsSign, readoutTexture, SlidingDoors, starChartTexture, touchPanelTexture } from './starship';
import { viewportGlass } from './starfield';
import { tiled } from './textures';

// A deck of the ship built in Blender (blender/, `npm run ship`). Its architecture comes from a GLB; markers in it
// say where the player can't walk, where doors slide, where to teleport to and what each part is called, and its
// materials say which surfaces the browser draws (LCARS, space). Decks sit side by side in world space rather than
// stacked: you never see from one into another, and the player only walks on the flat.

/** A canvas texture for a GLB's UVs, which run top to bottom. */
function gltfTexture(tex: THREE.Texture): THREE.Texture {
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

/** Geometry whose UVs are already flipped: a module's copies share it. */
const flipped = new WeakSet<THREE.BufferGeometry>();

/** A screen shows the World's canvas textures, which are flipped the three.js way: turn its glTF UVs to match. */
function flipUVs(mesh: THREE.Mesh): THREE.Mesh {
  if (flipped.has(mesh.geometry)) return mesh;
  flipped.add(mesh.geometry);
  const uv = mesh.geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  uv.needsUpdate = true;
  return mesh;
}

/** What each glTF material is drawn with, made once however many copies of a module use it. */
const surfaces = new WeakMap<THREE.Material, THREE.Material>();

let keys: THREE.Material | undefined;

/** `ao`: the occlusion baked into the deck (blender/bake.py), on the meshes' second UVs, if it's shaded by one. */
function surfaceMaterial(surface: Surface, color: string, ao: THREE.Texture | null): THREE.Material {
  switch (surface.kind) {
    case 'toon':
      return ao ? occludedToon(color, ao) : toon(color);
    case 'unlit':
      return new THREE.MeshBasicMaterial({ color });
    case 'carpet':
      return ao ? occludedToon('#ffffff', ao, tiled.carpet(color, 1, 1)) : toon('#ffffff', { map: tiled.carpet(color, 1, 1) });
    case 'space':
      return viewportGlass;
    case 'keys':
      return (keys ??= flat(gltfTexture(touchPanelTexture().clone())));
    case 'readout':
      return flat(gltfTexture(readoutTexture(surface.w, surface.h, surface.seed)));
    case 'sign':
      return flat(gltfTexture(lcarsSign(surface.text, { color: surface.color, sub: surface.sub, code: surface.code })));
    case 'star-chart':
      return flat(gltfTexture(starChartTexture()));
    case 'screen':
      // blank until the World puts what it draws there
      return new THREE.MeshBasicMaterial({ color: '#000000' });
    case 'accent':
      // its own colour until whatever it's part of paints it (keeping its occlusion)
      return ao ? occludedToon(color, ao) : toon(color);
    case 'lamp':
      return toon(color);
  }
}

/** Somewhere to stand at `at`, looking along the forward of a marker turned `turn`. */
function placeAt(label: string, at: THREE.Vector3, turn: THREE.Quaternion): Place {
  const ahead = new THREE.Vector3(0, 0, -1).applyQuaternion(turn);
  return { label, position: at.clone().setY(0), lookAt: at.clone().addScaledVector(ahead, 4).setY(1.5) };
}

/**
 * Makes a scene from a GLB ready to draw: each material becomes what its surface says, and each object something
 * to use if it says so. Hands each marker to `read` (with its world matrix still up to date), then takes it out of
 * the scene. Returns the screens the browser keeps drawing on, and the meshes to paint in an accent or light up.
 */
export function dress(
  scene: THREE.Object3D,
  read: (o: THREE.Object3D, marker: Marker) => void,
): { screens: { screen: ScreenName; mesh: THREE.Mesh }[]; accents: THREE.Mesh[]; lamps: THREE.Mesh[] } {
  const screens: { screen: ScreenName; mesh: THREE.Mesh }[] = [];
  const accents: THREE.Mesh[] = [];
  const lamps: THREE.Mesh[] = [];
  const markers: THREE.Object3D[] = [];
  scene.traverse((o) => {
    const marker = readMarker(o.userData);
    if (marker) {
      read(o, marker);
      markers.push(o);
      return;
    }
    const use = readInteraction(o.userData);
    if (use) interactive(o, use.interaction, () => use.label);
    if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) {
      const gltf = o.material;
      const surface = readSurface(gltf.userData);
      if (surface.kind === 'screen') screens.push({ screen: surface.screen, mesh: flipUVs(o) });
      if (surface.kind === 'accent') accents.push(o);
      if (surface.kind === 'lamp') lamps.push(o);
      let mat = surfaces.get(gltf);
      if (!mat) surfaces.set(gltf, (mat = surfaceMaterial(surface, `#${gltf.color.getHexString()}`, gltf.aoMap)));
      o.material = mat;
    }
  });
  for (const o of markers) o.removeFromParent();
  return { screens, accents, lamps };
}

export class Deck {
  readonly root = new THREE.Group();
  readonly colliders: Box2[] = [];
  readonly doors: SlidingDoors[] = [];
  readonly places: Place[] = [];
  /** Where the turbolift stops on this deck. */
  readonly stops: Place[] = [];
  /** The screens the World draws on. */
  readonly screens: { screen: DeckScreen; mesh: THREE.Mesh }[] = [];
  private readonly areas: { label: string; box: Box2 }[] = [];
  private readonly seats = new Map<Crew, Seat>();

  /** Loads a deck's GLB and puts its origin at `origin` in the world. */
  static async load(url: string, origin: THREE.Vector3): Promise<Deck> {
    const gltf = await new GLTFLoader().loadAsync(url);
    return new Deck(gltf.scene, origin);
  }

  /** A deck of one module of a GLB (blender/kit.py: module), a copy of which it puts at `origin` in the world. */
  static from(module: THREE.Object3D, origin: THREE.Vector3): Deck {
    return new Deck(module.clone(), origin);
  }

  private constructor(scene: THREE.Object3D, origin: THREE.Vector3) {
    scene.position.copy(origin);
    this.root.add(scene);
    this.root.updateMatrixWorld(true);
    const { screens, accents, lamps } = dress(scene, (o, marker) => this.read(o, marker));
    for (const { screen, mesh } of screens) {
      if (screen !== 'mission-control') throw new Error(`Deck extras: a deck has a ${screen} screen, which only a team station draws`);
      this.screens.push({ screen, mesh });
    }
    if (accents.length) throw new Error(`Deck extras: a deck has an accent (${accents[0].name}), which only a team station paints`);
    if (lamps.length) throw new Error(`Deck extras: a deck has a lamp (${lamps[0].name}), which only a team station lights`);
    // hundreds of meshes in a few dozen materials: a draw call each, until they're merged (the World draws on screens)
    mergeStatic(scene, screens.map((s) => s.mesh));
  }

  /** Where `crew` sits on this deck: asking a deck that hasn't a seat for them is a bug, so it fails loudly. */
  seat(crew: Crew): Seat {
    const seat = this.seats.get(crew);
    if (!seat) throw new Error(`Deck extras: no seat marker for crew ${crew}`);
    return seat;
  }

  private read(o: THREE.Object3D, marker: Marker): void {
    const at = o.getWorldPosition(new THREE.Vector3());
    const turn = o.getWorldQuaternion(new THREE.Quaternion());
    switch (marker.kind) {
      case 'collider':
        this.colliders.push(footprint(o.matrixWorld));
        break;
      case 'door': {
        const along = new THREE.Vector3(1, 0, 0).applyQuaternion(turn);
        const doors = new SlidingDoors(at, Math.atan2(-along.z, along.x), marker.width, marker.height);
        this.doors.push(doors);
        this.root.add(doors.group);
        break;
      }
      case 'place':
        this.places.push(placeAt(marker.label, at, turn));
        break;
      case 'turbolift':
        this.stops.push(placeAt(marker.label, at, turn));
        break;
      case 'area':
        this.areas.push({ label: marker.label, box: footprint(o.matrixWorld) });
        break;
      case 'seat': {
        const ahead = new THREE.Vector3(0, 0, -1).applyQuaternion(turn);
        this.seats.set(marker.crew, { at, facing: at.clone().add(ahead) });
        break;
      }
      case 'portal':
        throw new Error('Deck extras: a deck has a portal, which only a team station has');
    }
  }

  /** The name of the part of the deck a world position is in, if it's on this deck. */
  areaAt(p: THREE.Vector3): string | undefined {
    return this.areas.find(({ box }) => contains(box, p))?.label;
  }
}
