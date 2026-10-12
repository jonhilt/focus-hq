import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Builder } from './builder';
import { dress } from './deck';
import { ENTRANCE_X } from './hallLayout';
import { DOOR_H, footprints } from './layout';
import { flat, lighten, occludedToon, toon } from './materials';
import { mergeStatic } from './merge';
import type { Doorway } from './portal';
import { lcarsSign } from './starship';

// The training hall: a project's holodeck, bigger on the inside, after the hall of training pods the Cerritos crew
// drill in (Lower Decks, "I, Excretus"). The holodeck's door on the deck is a Portal to the
// hall's entrance, so the hall stands out in the world (layout.ts: hallAt), round and tall, whatever the deck's
// slot can hold. Its frame is a room's: +X from the entrance to the far wall, where the board curves round the wall,
// with the team stations' pods round the wall either side of it and the desks in the control ring in the middle.
// Its shell is built in Blender (blender/training_hall.py), a copy per hall; ProjectRoom fills it, from the hall's
// plan, as it fills today's room from its own.

/** Loads the training hall's shell, which every hall is a copy of. */
export async function loadTrainingHall(url: string): Promise<THREE.Object3D> {
  const { scene } = await new GLTFLoader().loadAsync(url);
  const hall = scene.getObjectByName('training_hall');
  if (!hall) throw new Error('The training hall needs a training_hall module');
  return hall;
}

/** Whose hall it is, for its floor's colour and the sign over its entrance: a project's, or nobody's yet. */
export interface HallLook {
  name: string;
  color: string;
  sub: string;
}

/** The name of a hall's shell in its group: the studio sets it aside for a bigger hall of its own (room.ts). */
export const HALL_SHELL = 'hall shell';
/** The name of the sign over a hall's entrance, inside: the studio's says so. */
export const HALL_SIGN = 'hall sign';

/**
 * Puts a copy of the hall's shell (`kit`) into `group` (the hall's frame, standing where hallAt puts it): its floor
 * in `look`'s colour, still shaded where the walls meet it, the walls, ceiling and entrance, and what the player can't
 * walk through, in world space. A `lined` hall's walls and ceiling are hidden behind a skin (scenery.ts: a landscape's,
 * or an empty holodeck's grid), so it has no lights on its ceiling. Returns the entrance's doorway (world), for the
 * door on the deck to lead to.
 */
export function buildHall(group: THREE.Group, kit: THREE.Object3D, look: HallLook, builder: Builder, lined: boolean): Doorway {
  const shell = kit.clone();
  shell.name = HALL_SHELL;
  group.add(shell);
  group.updateWorldMatrix(true, true);
  // (the loader makes Blender's names safe for animation paths: their spaces become underscores)
  if (lined) for (const light of shell.children.filter((o) => o.name.startsWith('hall_ceiling_light'))) light.removeFromParent();

  // how much lighter than the project's colour each part of the floor is, read before dressing swaps its material
  const shades = new Map<THREE.Object3D, number>();
  shell.traverse((o) => {
    const shade = o instanceof THREE.Mesh ? (o.material as THREE.Material).userData.shade : undefined;
    if (typeof shade === 'number') shades.set(o, shade);
  });
  let doorway: Doorway | undefined;
  const { accents } = dress(shell, (o, marker) => {
    const at = new THREE.Matrix4().multiplyMatrices(shell.matrixWorld, o.matrix);
    if (marker.kind === 'collider') builder.colliders.push(...footprints(at));
    else if (marker.kind === 'portal') doorway = { matrix: at, width: marker.width, height: marker.height, depth: marker.depth };
    else throw new Error(`The training hall has a ${marker.kind} marker, which a hall can't use`);
  });
  if (!doorway) throw new Error('The training hall has no doorway');
  for (const mesh of accents) {
    const ao = (mesh.material as THREE.MeshToonMaterial).aoMap ?? null;
    const color = lighten(look.color, shades.get(mesh) ?? 0.6);
    mesh.material = ao ? occludedToon(color, ao) : toon(color);
  }
  mergeStatic(shell, accents);

  // whose it is over the entrance, in front of the holodeck's skin (scenery.ts) and the wall's trims
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.62), flat(lcarsSign(look.name, { color: look.color, sub: look.sub })));
  sign.rotation.y = Math.PI / 2;
  sign.position.set(ENTRANCE_X + 0.11, DOOR_H + 0.6, 0);
  sign.name = HALL_SIGN;
  group.add(sign);
  return doorway;
}
