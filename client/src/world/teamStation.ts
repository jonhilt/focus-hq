import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Builder } from './builder';
import type { Character } from './character';
import { dress, footprint } from './deck';
import { type Crew, HELPER_SEATS, type Marker } from './deckExtras';
import { type Box2, contains, EYE_HEIGHT, ROOM_WIDTH } from './layout';
import { flat, toon } from './materials';
import { type Doorway, Portal } from './portal';
import { BIG_SCREEN, StationScreen } from './screen';
import { lcarsSign } from './starship';

// A team station: where a goal's lead works with the captain. In the holodeck it's a door, with the station's sign
// over it; through it is the goal's briefing room, which stands far off in the world (layout.ts: briefingRoomAt) and
// is far bigger than the holodeck could hold. The two doorways are a Portal, so you see the briefing room through the
// open door and walk straight in. The lead, their helpers (Claude Code's subagents) and the goal's QA reviewer sit
// round its table, the captain's chair at its head, facing the lead's session on the far wall. Both halves are built
// in Blender (blender/team_station.py); who sits where and what the screens show are drawn here.

/** The two modules every team station is a copy of: its door, and the briefing room through it. */
export interface TeamStationKit {
  door: THREE.Object3D;
  room: THREE.Object3D;
}

/** Loads the team station's door and briefing room. */
export async function loadTeamStation(url: string): Promise<TeamStationKit> {
  const { scene } = await new GLTFLoader().loadAsync(url);
  const door = scene.getObjectByName('station_door');
  const room = scene.getObjectByName('briefing_room');
  if (!door || !room) throw new Error('The team station needs a station_door and a briefing_room module');
  return { door, room };
}

/**
 * Where the room's four team stations' doors stand (room frame): two against each side wall, facing into the room
 * just in front of the skin a holodeck's landscape shows through (scenery.ts), clear of the desks by the door and the
 * QA station and New issue stand by the board.
 */
const DOOR_SPOTS: { x: number; side: 1 | -1 }[] = [
  { x: -2.4, side: -1 },
  { x: 2.4, side: -1 },
  { x: -2.4, side: 1 },
  { x: 2.4, side: 1 },
];
/** How far a door's housing stands from its side wall's centre line: clear of its skin (scenery.ts: SKIN_INSET). */
const WALL_GAP = 0.16;

/** Who sits in a seat: the agent (or helper) id, and their Character while they're there. */
export interface StationSeat {
  seat: THREE.Group;
  id?: string;
  character?: Character;
}

/** A seat marker faces along its forward (-Z); a Character faces +X. */
const CHARACTER_TURN = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);

/** What a module's markers say: where you can't walk, where its doorway is, and its seats, place and area. */
interface Read {
  blocks: THREE.Matrix4[];
  seats: Map<Crew, THREE.Group>;
  doorway?: { matrix: THREE.Matrix4; marker: Extract<Marker, { kind: 'portal' }> };
  place?: THREE.Vector3;
  area?: THREE.Matrix4;
}

export class TeamStation {
  /** The door, in the room frame. */
  readonly door = new THREE.Group();
  /** The briefing room, and its doors, in world space. */
  readonly room = new THREE.Group();
  readonly screen: StationScreen;
  readonly lead: StationSeat;
  /** In the order helpers take them (`seatHelpers`). */
  readonly helpers: StationSeat[];
  readonly reviewer: StationSeat;
  /** What "use this station" hangs on: the door, and the briefing room's table and screen. */
  readonly furniture: THREE.Object3D[];
  /** The door and the briefing room's doorway, joined once the room has put the door in place (`connect`). */
  portal!: Portal;
  private readonly doorKit: Read;
  private readonly roomKit: Read;
  /** The briefing room's furniture, standing where it does in the world. */
  private readonly furnished: THREE.Object3D;
  /** Where the captain stands at the head of the table, and the middle of the screen they look at (world). */
  private readonly head: THREE.Vector3;
  private readonly screenCentre: THREE.Vector3;
  private readonly area: Box2;
  private readonly sign = flat(lcarsSign('', { h: 287 }));
  private signText = '';

  constructor(
    readonly index: number,
    private readonly accent: string,
    kit: TeamStationKit,
    /** Where the briefing room's doorway stands in the world (layout.ts: briefingRoomAt). */
    origin: THREE.Vector3,
  ) {
    this.screen = new StationScreen(null, this.freeText(), BIG_SCREEN);

    const spot = DOOR_SPOTS[index];
    const door = kit.door.clone();
    // its back against the side wall: as far behind its doorway as its deepest part
    const back = new THREE.Box3().setFromObject(door).max.z;
    this.door.position.set(spot.x, 0, spot.side * (ROOM_WIDTH / 2 - WALL_GAP - back));
    // facing into the room: its forward (-Z) away from its wall
    this.door.rotation.y = spot.side < 0 ? Math.PI : 0;
    this.door.add(door);
    const doorScreens = this.dress(door, (this.doorKit = blank()));

    const room = (this.furnished = kit.room.clone());
    room.position.copy(origin);
    this.room.add(room);
    const roomScreens = this.dress(room, (this.roomKit = blank()));

    const screen = (screens: { screen: string; mesh: THREE.Mesh }[], name: string, where: string) => {
      const found = screens.find((s) => s.screen === name);
      if (!found) throw new Error(`The team station's ${where} has no ${name} screen`);
      return found.mesh;
    };
    const display = screen(roomScreens, 'team-station', 'briefing room');
    display.material = this.screen.material;
    screen(roomScreens, 'team-station-sign', 'briefing room').material = this.sign;
    screen(doorScreens, 'team-station-sign', 'door').material = this.sign;
    this.setSign(this.freeText());

    const { place, area } = this.roomKit;
    if (!place || !area) throw new Error('The team station’s briefing room has no place or area marker');
    this.head = place.clone().applyMatrix4(room.matrixWorld);
    this.area = footprint(new THREE.Matrix4().multiplyMatrices(room.matrixWorld, area));
    this.screenCentre = new THREE.Box3().setFromObject(display).getCenter(new THREE.Vector3());
    const table = room.getObjectByName('briefing_table');
    if (!table) throw new Error('The team station’s briefing room has no table');
    this.furniture = [door, table, display];

    const seat = (crew: Crew): StationSeat => {
      const found = this.roomKit.seats.get(crew);
      if (!found) throw new Error(`The team station’s briefing room has no seat for ${crew}`);
      room.add(found);
      return { seat: found };
    };
    this.lead = seat('station-lead');
    this.helpers = HELPER_SEATS.map(seat);
    this.reviewer = seat('station-reviewer');
  }

  /** Reads a module's markers into `read`, paints its accents and returns its screens. */
  private dress(module: THREE.Object3D, read: Read): { screen: string; mesh: THREE.Mesh }[] {
    module.updateMatrixWorld(true);
    const { screens, accents } = dress(module, (o, marker) => {
      switch (marker.kind) {
        case 'collider':
          read.blocks.push(o.matrix.clone());
          return;
        case 'portal':
          read.doorway = { matrix: o.matrix.clone(), marker };
          return;
        case 'seat': {
          const seat = new THREE.Group();
          seat.position.copy(o.position);
          seat.quaternion.copy(o.quaternion).multiply(CHARACTER_TURN);
          read.seats.set(marker.crew, seat);
          return;
        }
        case 'place':
          read.place = o.position.clone();
          return;
        case 'area':
          read.area = o.matrix.clone();
          return;
        default:
          throw new Error(`The team station has a ${marker.kind} marker, which a station can't use`);
      }
    });
    for (const mesh of accents) mesh.material = toon(this.accent);
    return screens;
  }

  /**
   * Joins the door, now the room has put it in place, to the briefing room through it, and adds the briefing room,
   * the doors and what blocks the player to the world.
   */
  connect(builder: Builder): void {
    const door = this.door.children[0];
    door.updateWorldMatrix(true, false);
    const doorway = (read: Read, frame: THREE.Matrix4): Doorway => {
      if (!read.doorway) throw new Error('The team station has a module without a doorway');
      const { width, height, depth } = read.doorway.marker;
      return { matrix: new THREE.Matrix4().multiplyMatrices(frame, read.doorway.matrix), width, height, depth };
    };
    const room = this.furnished.matrixWorld;
    this.portal = new Portal(doorway(this.doorKit, door.matrixWorld), doorway(this.roomKit, room));
    builder.add(this.portal.ends[0].group);
    // its doors go with the briefing room, so they're hidden with it
    this.room.add(this.portal.ends[1].group);
    builder.add(this.room);
    for (const [read, frame] of [[this.doorKit, door.matrixWorld], [this.roomKit, room]] as const) {
      for (const m of read.blocks) builder.colliders.push(footprint(new THREE.Matrix4().multiplyMatrices(frame, m)));
    }
  }

  /** Whether a world position is in the briefing room. */
  inside(p: THREE.Vector3): boolean {
    return contains(this.area, p);
  }

  /**
   * Where `camera` is as far as the briefing room's concerned: there, or seen through the door from in front of it
   * (if `inHolodeck`), where it would be beyond the briefing room's doorway; null when it's nowhere near.
   */
  eye(camera: THREE.Vector3, inHolodeck: boolean): THREE.Vector3 | null {
    if (this.inside(camera)) return camera;
    return inHolodeck ? camera.clone().applyMatrix4(this.portal.ends[0].through) : null;
  }

  /**
   * Where the door stands in the holodeck (world, at eye height): what the briefing room sees the holodeck from.
   * Carried through the doorway, the camera would stand behind the door, beyond the holodeck's wall.
   */
  threshold(): THREE.Vector3 {
    return new THREE.Vector3(0, EYE_HEIGHT, 0).applyMatrix4(this.portal.ends[0].doorway.matrix);
  }

  /** How far `eye` is from the head of the table: at it, nobody's bubble hides the screen. */
  fromHead(eye: THREE.Vector3): number {
    return eye.distanceTo(this.head);
  }

  /** How far `eye` is from the screen, to draw it often when you can read it. */
  fromScreen(eye: THREE.Vector3): number {
    return eye.distanceTo(this.screenCentre);
  }

  /** What the station says while it has no goal. */
  freeText(next?: string): string {
    return next ? `Next up: ${next}` : `Team station ${this.index + 1} · start a goal here`;
  }

  /** The sign over the door and beside the screen: the station's number, and its goal (`sub`). */
  setSign(sub: string): void {
    if (sub === this.signText) return;
    this.signText = sub;
    const old = this.sign.map;
    this.sign.map = lcarsSign(`Team station ${this.index + 1}`, { color: this.accent, code: `TS-${this.index + 1}`, sub, h: 287 });
    this.sign.needsUpdate = true;
    old?.dispose();
  }

  /** At the head of the briefing room's table, looking down it at the screen (world). */
  viewpoint(): { position: THREE.Vector3; lookAt: THREE.Vector3 } {
    return { position: this.head.clone().setY(0), lookAt: this.screenCentre.clone() };
  }

  dispose(): void {
    this.screen.dispose();
    this.sign.map?.dispose();
    this.sign.dispose();
    for (const s of [this.lead, ...this.helpers, this.reviewer]) s.character?.dispose();
  }
}

function blank(): Read {
  return { blocks: [], seats: new Map() };
}
