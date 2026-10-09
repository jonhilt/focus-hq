import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Agent } from '../../../shared/types';
import type { Builder, Interaction } from './builder';
import type { Character, CrewView } from './character';
import { dress } from './deck';
import { type Crew, HELPER_SEATS, type Marker } from './deckExtras';
import { type GoalRoomTone, goalRoomState, roster } from './goalRoom';
import { ChartScreen, GoalBoard, GoalSign, type StationView, TeamScreen, TONE } from './goalScreens';
import { PaneSwitches } from './paneSwitchPanel';
import { PANE_SWITCHES, switchAt, switchLabel } from './paneSwitches';
import { screenPrefs } from './screenPanes';
import { type Box2, contains, EYE_HEIGHT, footprint, footprints } from './layout';
import { occludedToon, toon } from './materials';
import { mergeStatic } from './merge';
import { type Doorway, Portal } from './portal';
import { BIG_SCREEN, StationScreen } from './screen';
import { HULL } from './starship';
import { HOLO_CYAN, Hologram, hover } from './hologram';
import { OVERLAY_LAYER } from './frame';

// A team station: where a goal's lead works with the captain. In the holodeck it's a door, with the station's sign
// floating over it and lamps either side that show whether its goal room is in session; through it is the goal's
// briefing room, which stands far off in the world (layout.ts: briefingRoomAt) and is far bigger than the holodeck
// could hold. The two doorways are a Portal, so you see the briefing room through the open door and walk straight in.
// It's a mini bridge: the captain stands a few steps in from the door, facing the lead's session on the far wall, the
// lead and the goal's QA reviewer either side and their helpers (Claude Code's subagents) at consoles round behind,
// each with a PADD, with the lead's note on the goal on the board beside them. Both halves are built in Blender (blender/team_station.py); who sits where and what the screens
// show are drawn here. Each station also has a screen hung over its pod (room.ts), so you can see what every team's up
// to from the middle of the holodeck without going in.

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

/** Where a team station's pod stands: its back against the wall at `wall`, facing into the hall, turned `yaw` (its frame). */
export interface PodSpot {
  wall: THREE.Vector3;
  yaw: number;
}

/** How far a pod's back stands in front of the hall's wall: clear of its skin (scenery.ts) and the wall's trims. */
const WALL_GAP = 0.16;
/**
 * The sign floating over the door (the door's frame, -Z out into the room): over the pod's ring and out in front of its
 * bezel, as a holo-pod's hologram floats, as tall as fits under the holodeck's ceiling.
 */
const DOOR_SIGN = { width: 2.6, bottom: 2.79, out: 0.85 };

/**
 * The station's screen over its pod (before the room scales it up to hang there): a hologram (hologram.ts) with a face
 * either side `depth` apart, its outline glowing `rim` out from its drawing all round.
 */
export const TEAM_SCREEN = { width: 2.2, height: (2.2 * TeamScreen.H) / TeamScreen.W, depth: 0.02, rim: 0.05 };

/** Who sits in a seat: the agent (or helper) id, and their Character while they're there. */
export interface StationSeat {
  seat: THREE.Group;
  id?: string;
  character?: Character;
  /** How they show, for the goal board's roster. */
  view?: CrewView;
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
  /** What "use this station" hangs on: the door, and its screen over the pod. */
  readonly furniture: THREE.Object3D[];
  /** The goal board on the briefing room's wall: using it opens the lead's goal, or a crew member's row, theirs. */
  readonly goalBoard: THREE.Mesh;
  /** Who's on the goal board's roster, in its order (`show`). */
  private crew: { who: StationSeat; role: 'Lead' | 'Reviewer' | 'Helper' }[] = [];
  /** The briefing room's viewscreen, which `screen` draws on. */
  readonly display: THREE.Mesh;
  /** The door and the briefing room's doorway, joined once the room has put the door in place (`connect`). */
  portal!: Portal;
  private readonly doorKit: Read;
  private readonly roomKit: Read;
  /** The briefing room's furniture, standing where it does in the world. */
  private readonly furnished: THREE.Object3D;
  /** Where the captain stands, on the command carpet, and the middle of the screen they look at (world). */
  private readonly head: THREE.Vector3;
  private readonly screenCentre: THREE.Vector3;
  private readonly area: Box2;
  private readonly sign = new GoalSign();
  /** The sign's hologram, over the door and under the briefing room's screen, outlined like the team screen. */
  private readonly signHologram = new Hologram(this.sign.texture, GoalSign.W / GoalSign.H);
  /** The sign over the door, which hovers. */
  private readonly doorSign: THREE.Mesh;
  private readonly board = new GoalBoard();
  private readonly chart = new ChartScreen();
  private readonly teamScreen = new TeamScreen();
  /** The team screen's hologram, outlined in the colour of the door's lamps (`update`). */
  private readonly teamHologram = new Hologram(this.teamScreen.texture, (TEAM_SCREEN.width + TEAM_SCREEN.rim * 2) / (TEAM_SCREEN.height + TEAM_SCREEN.rim * 2));
  /**
   * Its screen over the pod (the hall's frame, hung by the room): the same on both faces, front (+Z) and back,
   * hovering where it hangs.
   */
  readonly podScreen = new THREE.Group();
  private readonly faces = new THREE.Group();
  private lastT = 0;
  /** The strip of switches under the screen, for which panes it shows: the viewer's, so the same at every station. */
  private readonly panes = new PaneSwitches();
  /** The lamps either side of the door, lit by how the goal room stands (`update`). */
  private readonly lamp = new THREE.MeshBasicMaterial({ color: HULL.dado });
  private tone: GoalRoomTone = 'free';

  constructor(
    readonly index: number,
    private readonly accent: string,
    kit: TeamStationKit,
    /** Where the briefing room's doorway stands in the world (layout.ts: briefingRoomAt). */
    origin: THREE.Vector3,
    /** Where its pod stands in the holodeck. */
    spot: PodSpot,
  ) {
    this.screen = new StationScreen(null, this.freeText(), BIG_SCREEN);

    const door = kit.door.clone();
    // its back against the wall: as far in front of it as its deepest part is behind its doorway, facing into the room
    const back = new THREE.Box3().setFromObject(door).max.z;
    const forward = new THREE.Vector3(-Math.sin(spot.yaw), 0, -Math.cos(spot.yaw));
    this.door.position.copy(spot.wall).addScaledVector(forward, WALL_GAP + back);
    this.door.rotation.y = spot.yaw;
    this.door.add(door);
    this.dress(door, (this.doorKit = blank()));
    const sign = (this.doorSign = new THREE.Mesh(new THREE.PlaneGeometry(DOOR_SIGN.width, (DOOR_SIGN.width * GoalSign.H) / GoalSign.W), this.signHologram.material));
    sign.position.set(0, DOOR_SIGN.bottom + (DOOR_SIGN.width * GoalSign.H) / GoalSign.W / 2, -DOOR_SIGN.out);
    sign.rotation.y = Math.PI;
    sign.layers.set(OVERLAY_LAYER);
    door.add(sign);

    const room = (this.furnished = kit.room.clone());
    room.position.copy(origin);
    this.room.add(room);
    const roomScreens = this.dress(room, (this.roomKit = blank()));

    const screen = (screens: { screen: string; mesh: THREE.Mesh }[], name: string, where: string) => {
      const found = screens.find((s) => s.screen === name);
      if (!found) throw new Error(`The team station's ${where} has no ${name} screen`);
      return found.mesh;
    };
    const display = (this.display = screen(roomScreens, 'team-station', 'briefing room'));
    display.material = this.screen.material;
    const roomSign = screen(roomScreens, 'team-station-sign', 'briefing room');
    roomSign.material = this.signHologram.material;
    roomSign.layers.set(OVERLAY_LAYER);
    this.goalBoard = screen(roomScreens, 'team-station-note', 'briefing room');
    this.goalBoard.material = this.board.material;
    screen(roomScreens, 'team-station-chart', 'briefing room').material = this.chart.material;
    const panes = screen(roomScreens, 'team-station-panes', 'briefing room');
    panes.material = this.panes.material;
    panes.userData.interactionAt = (uv: THREE.Vector2) => this.switchAt(uv);

    const { place, area } = this.roomKit;
    if (!place || !area) throw new Error('The team station’s briefing room has no place or area marker');
    this.head = place.clone().applyMatrix4(room.matrixWorld);
    this.area = footprint(new THREE.Matrix4().multiplyMatrices(room.matrixWorld, area));
    this.screenCentre = new THREE.Box3().setFromObject(display).getCenter(new THREE.Vector3());
    const { width, height, depth, rim } = TEAM_SCREEN;
    const faces = [0, Math.PI].map((turn) => {
      const face = new THREE.Mesh(new THREE.PlaneGeometry(width + rim * 2, height + rim * 2), this.teamHologram.material);
      face.rotation.y = turn;
      face.position.z = (Math.cos(turn) * depth) / 2;
      // drawn over the outlines (frame.ts), so the lines of what's behind it are behind its glass too
      face.layers.set(OVERLAY_LAYER);
      // solid while you aim at it, so it's easy to read
      face.userData.aim = (on: boolean) => (this.teamHologram.aimed = on);
      return face;
    });
    this.faces.add(...faces);
    this.podScreen.add(this.faces);
    this.furniture = [door, ...faces];

    const seat = (crew: Crew): StationSeat => {
      const found = this.roomKit.seats.get(crew);
      if (!found) throw new Error(`The team station’s briefing room has no seat for ${crew}`);
      room.add(found);
      return { seat: found };
    };
    this.lead = seat('station-lead');
    this.helpers = HELPER_SEATS.map(seat);
    this.reviewer = seat('station-reviewer');
    this.show(undefined);
    this.goalBoard.userData.interactionAt = (uv: THREE.Vector2) => this.rowAt(uv);
  }

  /** Using a crew member’s row on the goal board: their panel, as using them in their seat does. */
  private rowAt(uv: THREE.Vector2): { interaction: Interaction; label: () => string } | null {
    const i = this.board.rowAt(uv);
    const row = i === undefined ? undefined : this.crew[i];
    const id = row?.who.id;
    const name = row?.who.view?.name;
    if (!row || !id || !name) return null;
    if (row.role === 'Helper' && this.lead.id) return { interaction: { kind: 'helper', leadId: this.lead.id, id }, label: () => `Look at ${name}’s transcript` };
    return { interaction: { kind: 'agent', id }, label: () => `Look at ${name}’s screen` };
  }

  /** Using a switch on the strip under the screen: show or hide its pane. */
  private switchAt(uv: THREE.Vector2): { interaction: Interaction; label: () => string } | null {
    const i = switchAt(uv);
    const s = i === undefined ? undefined : PANE_SWITCHES[i];
    if (!s) return null;
    return { interaction: { kind: 'pane', pane: s.pane }, label: () => switchLabel(s, screenPrefs.current) };
  }

  /**
   * Reads a module's markers into `read`, paints its accents and lamps, merges the rest of it (merge.ts) and returns
   * its screens.
   */
  private dress(module: THREE.Object3D, read: Read): { screen: string; mesh: THREE.Mesh }[] {
    module.updateMatrixWorld(true);
    const { screens, accents, lamps } = dress(module, (o, marker) => {
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
    // in the station's colour, still shaded by the occlusion baked into the module
    const painted = new Map<THREE.Texture | null, THREE.Material>();
    for (const mesh of accents) {
      const ao = (mesh.material as THREE.MeshToonMaterial).aoMap ?? null;
      let mat = painted.get(ao);
      if (!mat) painted.set(ao, (mat = ao ? occludedToon(this.accent, ao) : toon(this.accent)));
      mesh.material = mat;
    }
    for (const mesh of lamps) mesh.material = this.lamp;
    mergeStatic(module, [...screens.map((s) => s.mesh), ...accents, ...lamps]);
    return screens;
  }

  /**
   * Joins the door, now the room has put it in place, to the briefing room through it, and adds the briefing room,
   * the doors and what blocks the player to the world: the door's end of the doorway to `here`, the part of the ship
   * it stands in (regions.ts).
   */
  connect(builder: Builder, here: THREE.Object3D = builder.group): void {
    const door = this.door.children[0];
    door.updateWorldMatrix(true, false);
    const doorway = (read: Read, frame: THREE.Matrix4): Doorway => {
      if (!read.doorway) throw new Error('The team station has a module without a doorway');
      const { width, height, depth } = read.doorway.marker;
      return { matrix: new THREE.Matrix4().multiplyMatrices(frame, read.doorway.matrix), width, height, depth };
    };
    const room = this.furnished.matrixWorld;
    this.portal = new Portal(doorway(this.doorKit, door.matrixWorld), doorway(this.roomKit, room));
    here.add(this.portal.ends[0].group);
    // its doors go with the briefing room, so they're hidden with it
    this.room.add(this.portal.ends[1].group);
    builder.add(this.room);
    for (const [read, frame] of [[this.doorKit, door.matrixWorld], [this.roomKit, room]] as const) {
      for (const m of read.blocks) builder.colliders.push(...footprints(new THREE.Matrix4().multiplyMatrices(frame, m)));
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

  /** How far `eye` is from where the captain stands: there, nobody's bubble hides the screen. */
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

  /**
   * Shows the station's goal on its sign (over the door and under the screen), its lamps, its goal board and its
   * screen over its pod (with how the slice's pull requests `prs` stand): its lead, or what's `next` in line for it
   * while it's free.
   */
  show(lead: Agent | undefined, next?: string, prs?: StationView['prs']): void {
    const seated = (s: StationSeat) => (s.view ? s : undefined);
    this.crew = roster(seated(this.lead), seated(this.reviewer), this.helpers.map(seated));
    const crew = this.crew.map(({ who, role }) => ({ who: who.view!, role: role === 'Helper' ? (who.view!.tag ?? role) : role }));
    const view = { index: this.index, accent: this.accent, lead, crew, next, prs };
    this.sign.show(view);
    this.board.show(view);
    this.chart.show(view);
    this.teamScreen.show(view);
    this.tone = goalRoomState(lead).tone;
  }

  /**
   * Lights the lamps either side of the door: off while the station's free, breathing in its tone while the lead's at
   * work, pulsing while they need you, steady while it's your turn.
   */
  update(t: number): void {
    this.panes.update();
    const glow = { free: 0, 'in-session': 0.8 + 0.2 * Math.sin(t * 2), 'needs-you': 0.6 + 0.4 * Math.sin(t * 7), 'your-turn': 1, queued: 0.55, stopped: 1 }[this.tone];
    this.lamp.color.set(HULL.dado).lerp(LIT.set(TONE[this.tone]), glow);
    // the team screen's outline glows as the lamps do, but from dim rather than the bulkhead's colour; a free one's in
    // the holograms' own cyan
    this.teamHologram.tint.set(this.tone === 'free' ? HOLO_CYAN : TONE[this.tone]).multiplyScalar(0.35 + 0.65 * glow);
    this.signHologram.tint.copy(this.teamHologram.tint);
    hover(this.faces, 0, t, this.index * 1.7);
    hover(this.doorSign, DOOR_SIGN.bottom + (DOOR_SIGN.width * GoalSign.H) / GoalSign.W / 2, t, this.index * 1.7 + 2);
    this.teamHologram.update(Math.min(0.1, t - this.lastT));
    this.lastT = t;
  }

  /** Where the captain stands in the briefing room, looking at the screen (world). */
  viewpoint(): { position: THREE.Vector3; lookAt: THREE.Vector3 } {
    return { position: this.head.clone().setY(0), lookAt: this.screenCentre.clone() };
  }

  dispose(): void {
    this.screen.dispose();
    this.sign.dispose();
    this.board.dispose();
    this.chart.dispose();
    this.teamScreen.dispose();
    this.teamHologram.dispose();
    this.signHologram.dispose();
    this.panes.dispose();
    this.lamp.dispose();
    for (const s of [this.lead, ...this.helpers, this.reviewer]) s.character?.dispose();
  }
}

const LIT = new THREE.Color();

function blank(): Read {
  return { blocks: [], seats: new Map() };
}
