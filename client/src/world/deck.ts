import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { interactive } from './builder';
import { type Marker, readInteraction, readMarker, readSurface, type ScreenName, type Surface } from './deckExtras';
import { type Box2, contains } from './layout';
import { flat, noOutline, toon, toonMaterial } from './materials';
import type { Seat } from './numberOne';
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

/** A screen shows the World's canvas textures, which are flipped the three.js way: turn its glTF UVs to match. */
function flipUVs(mesh: THREE.Mesh): THREE.Mesh {
  const uv = mesh.geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  uv.needsUpdate = true;
  return mesh;
}

let keys: THREE.Material | undefined;

function surfaceMaterial(surface: Surface, color: string): THREE.Material {
  switch (surface.kind) {
    case 'toon':
      return surface.outline ? toon(color) : noOutline(toonMaterial({ color }));
    case 'unlit':
      return noOutline(new THREE.MeshBasicMaterial({ color }));
    case 'carpet':
      return noOutline(toon('#ffffff', { map: tiled.carpet(color, 1, 1) }));
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
      return noOutline(new THREE.MeshBasicMaterial({ color: '#000000' }));
  }
}

/** The floor an empty cube's box covers. */
function footprint(o: THREE.Object3D): Box2 {
  const b = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1)).applyMatrix4(o.matrixWorld);
  return { minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z };
}

export class Deck {
  readonly root = new THREE.Group();
  readonly colliders: Box2[] = [];
  readonly doors: SlidingDoors[] = [];
  readonly places: Place[] = [];
  /** The screens the World draws on. */
  readonly screens: { screen: ScreenName; mesh: THREE.Mesh }[] = [];
  private readonly areas: { label: string; box: Box2 }[] = [];
  private seat: Seat | undefined;

  /** Loads a deck's GLB and puts its origin at `origin` in the world. */
  static async load(url: string, origin: THREE.Vector3): Promise<Deck> {
    const gltf = await new GLTFLoader().loadAsync(url);
    return new Deck(gltf.scene, origin);
  }

  private constructor(scene: THREE.Object3D, origin: THREE.Vector3) {
    scene.position.copy(origin);
    this.root.add(scene);
    this.root.updateMatrixWorld(true);
    const markers: THREE.Object3D[] = [];
    const materials = new Map<THREE.Material, THREE.Material>();
    scene.traverse((o) => {
      const marker = readMarker(o.userData);
      if (marker) {
        this.read(o, marker);
        markers.push(o);
        return;
      }
      const use = readInteraction(o.userData);
      if (use) interactive(o, use.interaction, () => use.label);
      if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) {
        const gltf = o.material;
        const surface = readSurface(gltf.userData);
        if (surface.kind === 'screen') this.screens.push({ screen: surface.screen, mesh: flipUVs(o) });
        let mat = materials.get(gltf);
        if (!mat) materials.set(gltf, (mat = surfaceMaterial(surface, `#${gltf.color.getHexString()}`)));
        o.material = mat;
      }
    });
    for (const o of markers) o.removeFromParent();
  }

  /** Where Number One sits on this deck, if they're aboard it. */
  get numberOne(): Seat | undefined {
    return this.seat;
  }

  private read(o: THREE.Object3D, marker: Marker): void {
    const at = o.getWorldPosition(new THREE.Vector3());
    const turn = o.getWorldQuaternion(new THREE.Quaternion());
    switch (marker.kind) {
      case 'collider':
        this.colliders.push(footprint(o));
        break;
      case 'door': {
        const along = new THREE.Vector3(1, 0, 0).applyQuaternion(turn);
        const doors = new SlidingDoors(at, Math.atan2(-along.z, along.x), marker.width, marker.height);
        this.doors.push(doors);
        this.root.add(doors.group);
        break;
      }
      case 'place': {
        const ahead = new THREE.Vector3(0, 0, -1).applyQuaternion(turn);
        this.places.push({ label: marker.label, position: at.clone().setY(0), lookAt: at.clone().addScaledVector(ahead, 4).setY(1.5) });
        break;
      }
      case 'area':
        this.areas.push({ label: marker.label, box: footprint(o) });
        break;
      case 'number-one': {
        const ahead = new THREE.Vector3(0, 0, -1).applyQuaternion(turn);
        this.seat = { at, facing: at.clone().add(ahead) };
        break;
      }
    }
  }

  /** The name of the part of the deck a world position is in, if it's on this deck. */
  areaAt(p: THREE.Vector3): string | undefined {
    return this.areas.find(({ box }) => contains(box, p))?.label;
  }
}
