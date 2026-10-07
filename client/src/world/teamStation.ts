import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Character } from './character';
import { dress, footprint } from './deck';
import { type Crew, HELPER_SEATS } from './deckExtras';
import type { Box2 } from './layout';
import { flat, toon } from './materials';
import { BIG_SCREEN, StationScreen } from './screen';
import { lcarsSign } from './starship';

// A team station: where a goal's lead works with the captain, a small bridge in a holodeck. The lead sits in a
// command chair facing a viewscreen, with their helpers (Claude Code's subagents) and the goal's QA reviewer at the
// consoles between them and it. Its furniture is built in Blender (blender/team_station.py); who sits where and what
// its screens show are drawn here. Built in the station's own frame (the screen towards -Z, the lead towards +Z),
// which the room turns and places (`STATION_SPOTS`).

/**
 * The room's four team stations, in the room frame: two along each side wall, their screens on it, just in front of
 * the skin a holodeck's landscape shows through (scenery.ts).
 */
export const STATION_SPOTS: { at: THREE.Vector3; rotationY: number }[] = [
  { at: new THREE.Vector3(-2.1, 0, -2.62), rotationY: 0 },
  { at: new THREE.Vector3(1.8, 0, -2.62), rotationY: 0 },
  { at: new THREE.Vector3(-2.1, 0, 2.62), rotationY: Math.PI },
  { at: new THREE.Vector3(1.8, 0, 2.62), rotationY: Math.PI },
];

/** Loads the team station's furniture: the module every station is a copy of. */
export async function loadTeamStation(url: string): Promise<THREE.Object3D> {
  const { scene } = await new GLTFLoader().loadAsync(url);
  const station = scene.getObjectByName('team_station');
  if (!station) throw new Error('The team station has no team_station module');
  return station;
}

/** Who sits in a seat: the agent (or helper) id, and their Character while they're there. */
export interface StationSeat {
  seat: THREE.Group;
  id?: string;
  character?: Character;
}

/** A seat marker faces along its forward (-Z); a Character faces +X. */
const CHARACTER_TURN = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);

export class TeamStation {
  /** In the room frame. */
  readonly group = new THREE.Group();
  readonly screen: StationScreen;
  readonly lead: StationSeat;
  /** In the order helpers take them (`seatHelpers`). */
  readonly helpers: StationSeat[];
  readonly reviewer: StationSeat;
  /** The chairs, consoles and viewscreen: what "use this station" hangs on. */
  readonly furniture: THREE.Object3D;
  /** In the station's frame: where the lead's screen is, to look at. */
  private readonly screenCentre: THREE.Vector3;
  /** The empty cubes the player can't walk into, in the station's frame. */
  private readonly blocks: THREE.Matrix4[] = [];
  private readonly sign = flat(lcarsSign('', { h: 287 }));
  private signText = '';

  constructor(
    readonly index: number,
    private readonly accent: string,
    kit: THREE.Object3D,
  ) {
    const spot = STATION_SPOTS[index];
    this.group.position.copy(spot.at);
    this.group.rotation.y = spot.rotationY;
    this.screen = new StationScreen(null, this.freeText(), BIG_SCREEN);

    this.furniture = kit.clone();
    this.furniture.updateMatrixWorld(true);
    const seats = new Map<Crew, THREE.Group>();
    const { screens, accents } = dress(this.furniture, (o, marker) => {
      switch (marker.kind) {
        case 'collider':
          this.blocks.push(o.matrix.clone());
          return;
        case 'seat': {
          const seat = new THREE.Group();
          seat.position.copy(o.position);
          seat.quaternion.copy(o.quaternion).multiply(CHARACTER_TURN);
          seats.set(marker.crew, seat);
          return;
        }
        default:
          throw new Error(`The team station has a ${marker.kind} marker, which a station can't use`);
      }
    });
    const screenMesh = (name: 'team-station' | 'team-station-sign') => {
      const found = screens.find((s) => s.screen === name);
      if (!found) throw new Error(`The team station has no ${name} screen`);
      return found.mesh;
    };
    const display = screenMesh('team-station');
    display.material = this.screen.material;
    this.screenCentre = new THREE.Box3().setFromObject(display).getCenter(new THREE.Vector3());
    screenMesh('team-station-sign').material = this.sign;
    for (const mesh of accents) mesh.material = toon(accent);
    this.setSign(this.freeText());
    this.group.add(this.furniture);

    const seat = (crew: Crew): StationSeat => {
      const found = seats.get(crew);
      if (!found) throw new Error(`The team station has no seat for ${crew}`);
      this.furniture.add(found);
      return { seat: found };
    };
    this.lead = seat('station-lead');
    this.helpers = HELPER_SEATS.map(seat);
    this.reviewer = seat('station-reviewer');
  }

  /** What blocks the player, in world coordinates: ask once the room has put the station in place. */
  colliders(): Box2[] {
    this.group.updateWorldMatrix(true, false);
    return this.blocks.map((m) => footprint(new THREE.Matrix4().multiplyMatrices(this.group.matrixWorld, m)));
  }

  /** What the station says while it has no goal. */
  freeText(next?: string): string {
    return next ? `Next up: ${next}` : `Team station ${this.index + 1} · start a goal here`;
  }

  /** The sign under the viewscreen: the station's number, and its goal (`sub`). */
  setSign(sub: string): void {
    if (sub === this.signText) return;
    this.signText = sub;
    const old = this.sign.map;
    this.sign.map = lcarsSign(`Team station ${this.index + 1}`, { color: this.accent, code: `TS-${this.index + 1}`, sub, h: 287 });
    this.sign.needsUpdate = true;
    old?.dispose();
  }

  /** Behind the lead's chair, looking at the viewscreen over their head (room frame). */
  viewpoint(): { position: THREE.Vector3; lookAt: THREE.Vector3 } {
    const local = {
      // a little right, so the lead's head is off the screen's bottom and the sign under its starboard corner, and the
      // helpers either side are out of the way
      position: this.lead.seat.position.clone().add(new THREE.Vector3(0.45, 0, 1.7)).setY(0),
      lookAt: this.screenCentre.clone(),
    };
    this.group.updateMatrix();
    return { position: local.position.applyMatrix4(this.group.matrix), lookAt: local.lookAt.applyMatrix4(this.group.matrix) };
  }

  dispose(): void {
    this.screen.dispose();
    this.sign.map?.dispose();
    this.sign.dispose();
    for (const s of [this.lead, ...this.helpers, this.reviewer]) s.character?.dispose();
  }
}
