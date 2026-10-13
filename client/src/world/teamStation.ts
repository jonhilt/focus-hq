import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Agent, Workflow } from '../../../shared/types';
import { type Builder, interactive, type Interaction } from './builder';
import type { Character, CrewView } from './character';
import { dress } from './deck';
import { type Crew, HELPER_SEATS, type Marker } from './deckExtras';
import { type GoalRoomTone, goalRoomState, roster } from './goalRoom';
import { ChartScreen, GoalBoard, GoalSign, type StationView, TeamScreen, TONE } from './goalScreens';
import { PaneSwitches } from './paneSwitchPanel';
import { PANE_SWITCHES, switchAt, switchLabel } from './paneSwitches';
import { screenPrefs } from './screenPanes';
import { type Box2, contains, EYE_HEIGHT, footprint, footprints } from './layout';
import { flat, occludedToon, toon } from './materials';
import { mergeStatic } from './merge';
import { type Doorway, Portal } from './portal';
import { BIG_SCREEN, StationScreen } from './screen';
import type { ScreenView } from './screenRedraw';
import { HULL, LCARS, LCARS_FONT, LCARS_STATUS } from './starship';
import { HOLO_CYAN, Hologram, hover } from './hologram';
import { OVERLAY_LAYER } from './frame';
import { loadTransporterRoom, TransporterRoom } from './transporterRoom';
import { TransporterOperation } from './transporterOps';
import { assignRooms, feedCaption, waitingLine } from './workflowRooms';
import { canvasTexture, fitText, makeCanvas } from './canvas';
import { FEED_SIZE } from './transporterFeeds';
import { BackgroundProbes } from './probes';
import { api } from '../net/api';

// A team station: where a goal's lead works with the captain. In the holodeck it's a door, with the station's sign
// floating over it and lamps either side that show whether its goal room is in session; through it is the goal's
// briefing room, which stands far off in the world (layout.ts: briefingRoomAt) and is far bigger than the holodeck
// could hold. The two doorways are a Portal, so you see the briefing room through the open door and walk straight in.
// It's a mini bridge: the captain stands a few steps in from the door, facing the lead's session on the far wall, the
// lead and the goal's QA reviewer either side and their helpers (Claude Code's subagents) at consoles round behind,
// each with a PADD, with the lead's note on the goal on the board beside them. Both halves are built in Blender (blender/team_station.py); who sits where and what the screens
// show are drawn here. Each station also has a screen hung over its pod (room.ts), so you can see what every team's up
// to from the middle of the holodeck without going in.

/**
 * The modules every team station is a copy of: its door, the briefing room through it, and its transporter rooms
 * (transporterRoom.ts), where its lead's workflows run.
 */
export interface TeamStationKit {
  door: THREE.Object3D;
  room: THREE.Object3D;
  transporter: THREE.Object3D;
}

/** Loads the team station's door and briefing room (`url`) and its transporter room (`transporterUrl`). */
export async function loadTeamStation(url: string, transporterUrl: string): Promise<TeamStationKit> {
  const [{ scene }, transporter] = await Promise.all([new GLTFLoader().loadAsync(url), loadTransporterRoom(transporterUrl)]);
  const door = scene.getObjectByName('station_door');
  const room = scene.getObjectByName('briefing_room');
  if (!door || !room) throw new Error('The team station needs a station_door and a briefing_room module');
  return { door, room, transporter };
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
  /** Its transporter rooms, out in the world, one for each workflow its lead runs at once. */
  readonly transporterRooms: TransporterRoom[];
  /** The workflow running in each of them. */
  private readonly operations: TransporterOperation[];
  /** Which of the lead's workflows is in which room (`assignRooms`). */
  private held: (string | undefined)[] = [];
  /** The station's lead while it has one, whose workflows' scripts the transporter consoles read. */
  private leadId: string | undefined;
  /** The monitors down the port wall, one per transporter room: its live picture and its caption. */
  private readonly feeds: { picture: THREE.Mesh; caption: THREE.Mesh; canvas: ReturnType<typeof makeCanvas>; texture: THREE.CanvasTexture; key: string }[];
  /** The strip over them, saying how many workflows wait for a room. */
  private readonly feedsStrip: { canvas: ReturnType<typeof makeCanvas>; texture: THREE.CanvasTexture; key: string };
  /** What the monitors show of the rooms with a workflow in them, once the feeds have pictures for them (TransporterFeeds). */
  private live: THREE.MeshBasicMaterial[] | null = null;
  /** The goal board on the briefing room's wall: using it opens the lead's goal, or a crew member's row, theirs. */
  readonly goalBoard: THREE.Mesh;
  /** The goal's star chart, to starboard of the viewscreen. */
  readonly chartScreen: THREE.Mesh;
  /** Who's on the goal board's roster, in its order (`show`). */
  private crew: { who: StationSeat; role: 'Lead' | 'Reviewer' | 'Helper' }[] = [];
  /** The briefing room's viewscreen, which `screen` draws on. */
  readonly display: THREE.Mesh;
  /** The door and the briefing room's doorway, joined once the room has put the door in place (`connect`). */
  portal!: Portal;
  private readonly projectId: string;
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
  /** What the lead has running in the background, floating beside their chair (probes.ts). */
  private readonly probes: BackgroundProbes;
  /** Whose probes they are, for their labels. */
  private leadName = '';

  constructor(
    readonly index: number,
    private readonly accent: string,
    kit: TeamStationKit,
    /** Where the briefing room's doorway stands in the world (layout.ts: briefingRoomAt). */
    origin: THREE.Vector3,
    /** Where its pod stands in the holodeck. */
    spot: PodSpot,
    /** The project whose holodeck it's in, and where each of its transporter rooms stands (layout.ts: transporterRoomAt). */
    projectId: string,
    transporters: THREE.Vector3[],
  ) {
    this.screen = new StationScreen(null, this.freeText(), BIG_SCREEN);
    this.projectId = projectId;

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

    const screen = (screens: { screen: string; feed?: number; mesh: THREE.Mesh }[], name: string, where: string, feed?: number) => {
      const found = screens.find((s) => s.screen === name && s.feed === feed);
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
    this.chartScreen = screen(roomScreens, 'team-station-chart', 'briefing room');
    this.chartScreen.material = this.chart.material;
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
    this.probes = new BackgroundProbes(
      (taskId) => ({ kind: 'background', projectId, station: index, taskId }),
      (task) => `Look at ${this.leadName}’s ${task.kind === 'monitor' ? 'monitor' : 'background command'} ${task.description} (${task.status})`,
    );
    this.lead.seat.add(this.probes.group);
    this.probes.awayFrom(this.head);
    this.show(undefined);
    this.goalBoard.userData.interactionAt = (uv: THREE.Vector2) => this.rowAt(uv);
    this.transporterRooms = transporters.map((at, i) => new TransporterRoom(kit.transporter, at, projectId, index, i, accent));
    this.operations = this.transporterRooms.map((room) => new TransporterOperation(room, (workflowId) => (this.leadId ? api.workflowScript(this.leadId, workflowId) : Promise.resolve(undefined))));
    this.feeds = this.transporterRooms.map((_, i) => {
      const canvas = makeCanvas(1024, 100);
      const texture = canvasTexture(canvas.canvas);
      const caption = screen(roomScreens, 'team-station-feed-caption', 'briefing room', i);
      caption.material = flat(texture);
      const picture = screen(roomScreens, 'team-station-feed', 'briefing room', i);
      picture.material = idleFeed(i);
      return { picture, caption, canvas, texture, key: '' };
    });
    const strip = makeCanvas(2400, 100);
    this.feedsStrip = { canvas: strip, texture: canvasTexture(strip.canvas), key: '' };
    screen(roomScreens, 'team-station-feeds', 'briefing room').material = flat(this.feedsStrip.texture);
    this.showWorkflows(undefined, 0);
  }

  /**
   * The lead's workflows in the station's transporter rooms (a fourth waits for one), on their monitors in the briefing
   * room, each captioned with how it stands: E on one beams you there.
   */
  showWorkflows(lead: Agent | undefined, now: number): void {
    this.leadId = lead?.id;
    const workflows = lead?.workflows ?? [];
    const { rooms, waiting } = assignRooms(this.held.length ? this.held : this.transporterRooms.map(() => undefined), workflows);
    this.held = rooms;
    rooms.forEach((id, i) => {
      const wf = workflows.find((w) => w.id === id);
      this.operations[i].show(wf, now);
      const feed = this.feeds[i];
      feed.picture.material = wf && this.live ? this.live[i] : idleFeed(i);
      drawCaption(feed, i, wf);
      const use: Interaction = { kind: 'beam-to', projectId: this.projectId, station: this.index, room: i };
      const label = () => (wf ? `Beam into transporter room ${i + 1} to watch ${wf.name}` : `Beam into transporter room ${i + 1}`);
      for (const mesh of [feed.picture, feed.caption]) interactive(mesh, use, label, FEED_REACH);
    });
    drawStrip(this.feedsStrip, waiting.length, this.accent);
  }

  /** Which of the station's transporter rooms workflow `id` runs in, while it has one. */
  roomOf(id: string): number | undefined {
    const i = this.held.indexOf(id);
    return i < 0 ? undefined : i;
  }

  /** The lead's background commands and monitors, as probes beside their chair. */
  showBackground(lead: Agent | undefined): void {
    this.leadName = lead?.name ?? '';
    this.probes.show(lead?.background ?? []);
  }

  /** Whether transporter room `i`'s feed is worth drawing: there's a workflow in it. */
  feedLive(i: number): boolean {
    return !!this.operations[i]?.current;
  }

  /** Transporter room `i`'s monitor in the briefing room, to tell whether it's in view. */
  feedScreen(i: number): THREE.Mesh | undefined {
    return this.feeds[i]?.picture;
  }

  /** The pictures the feeds draw each room into (TransporterFeeds), for the monitors of the rooms in use to show. */
  showFeeds(pictures: THREE.Texture[]): void {
    for (const mat of this.live ?? []) mat.dispose();
    this.live = pictures.map((map) => new THREE.MeshBasicMaterial({ map }));
    this.feeds.forEach((feed, i) => {
      if (this.feedLive(i)) feed.picture.material = this.live![i];
    });
  }

  /**
   * Moves the transporter rooms on: each watched from its feed while the captain's in the briefing room (`briefing`),
   * or by the captain in it.
   */
  updateTransporters(t: number, now: number, camera: THREE.Vector3, briefing: boolean): void {
    for (const op of this.operations) {
      const inside = op.room.inside(camera);
      op.update(t, now, inside ? camera : briefing && op.current ? op.room.camera.at : null, inside);
    }
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
  private dress(module: THREE.Object3D, read: Read): { screen: string; feed?: number; mesh: THREE.Mesh }[] {
    module.updateMatrixWorld(true);
    const { screens, accents, lamps, parts } = dress(module, (o, marker) => {
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
    if (parts.length) throw new Error(`The team station has a ${parts[0].part.kind} part, which only a transporter room has`);
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
    for (const transporter of this.transporterRooms) builder.colliders.push(...transporter.colliders);
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

  /** Keeps the probes on its star chart moving, while you're in its briefing room to see them. */
  animateChart(now: number): void {
    this.chart.animate(now);
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

  /** Draws its sign, goal board, chart and the screen over its pod, if they've changed and it's time (Display.update). */
  updateDisplays(now: number, view: ScreenView): void {
    for (const display of [this.sign, this.board, this.chart, this.teamScreen]) display.update(now, view);
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
    this.probes.update(t);
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
    this.probes.dispose();
    for (const room of this.transporterRooms) room.dispose();
    for (const op of this.operations) op.dispose();
    for (const feed of this.feeds) feed.texture.dispose();
    this.feedsStrip.texture.dispose();
    for (const mat of this.live ?? []) mat.dispose();
    for (const s of [this.lead, ...this.helpers, this.reviewer]) s.character?.dispose();
  }
}

const LIT = new THREE.Color();

function blank(): Read {
  return { blocks: [], seats: new Map() };
}

/** How far off you can beam into a transporter room from its feed: from the command carpet, across the room. */
const FEED_REACH = 7;

const FEED_TONE: Record<Workflow['status'], string> = { running: LCARS.sky, done: LCARS_STATUS.done, failed: LCARS.red };

/** A feed's caption: the room, and the workflow in it and how it stands. Redrawn only when that changes. */
function drawCaption(feed: { canvas: ReturnType<typeof makeCanvas>; texture: THREE.CanvasTexture; key: string }, i: number, wf: Workflow | undefined): void {
  const { title, line } = feedCaption(i, wf);
  const tone = wf ? FEED_TONE[wf.status] : '#8d86a0';
  const key = `${title}|${line}|${tone}`;
  if (key === feed.key) return;
  feed.key = key;
  const { canvas, ctx } = feed.canvas;
  const { width: w, height: h } = canvas;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = tone;
  ctx.beginPath();
  ctx.roundRect(8, 14, 70, h - 28, [(h - 28) / 2, 0, 0, (h - 28) / 2]);
  ctx.fill();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = LCARS.orange;
  ctx.font = `600 40px ${LCARS_FONT}`;
  const head = title.toUpperCase();
  ctx.fillText(head, 96, h / 2);
  const x = 96 + ctx.measureText(head).width + 24;
  ctx.fillStyle = wf ? LCARS.peach : '#8d86a0';
  ctx.font = `500 33px ${LCARS_FONT}`;
  ctx.fillText(fitText(ctx, line.toUpperCase(), w - x - 16), x, h / 2);
  feed.texture.needsUpdate = true;
}

/** The strip over the feeds: how many workflows wait for a room, or how to beam into one. */
function drawStrip(strip: { canvas: ReturnType<typeof makeCanvas>; texture: THREE.CanvasTexture; key: string }, waiting: number, accent: string): void {
  const key = String(waiting);
  if (key === strip.key) return;
  strip.key = key;
  const { canvas, ctx } = strip.canvas;
  const { width: w, height: h } = canvas;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.roundRect(6, 10, 560, h - 20, [(h - 20) / 2, 0, 0, (h - 20) / 2]);
  ctx.fill();
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  ctx.font = `600 56px ${LCARS_FONT}`;
  ctx.fillText('TRANSPORTER ROOMS', 548, h / 2 + 2);
  ctx.fillStyle = accent;
  ctx.fillRect(w - 46, 10, 40, h - 20);
  ctx.textAlign = 'left';
  ctx.fillStyle = waiting ? LCARS.gold : '#8d86a0';
  ctx.font = `500 50px ${LCARS_FONT}`;
  ctx.fillText((waiting ? waitingLine(waiting) : 'Live feeds · press E on one to beam in').toUpperCase(), 600, h / 2 + 2);
  strip.texture.needsUpdate = true;
}

const idleFeeds: THREE.Material[] = [];
/** A monitor with no workflow in its room: standing by. Shared by every station. */
function idleFeed(i: number): THREE.Material {
  if (idleFeeds[i]) return idleFeeds[i];
  const { canvas, ctx } = makeCanvas(FEED_SIZE.x, FEED_SIZE.y);
  const { width: w, height: h } = canvas;
  ctx.fillStyle = '#05060c';
  ctx.fillRect(0, 0, w, h);
  // faint scan lines, a dead channel
  ctx.fillStyle = '#0e1220';
  for (let y = 0; y < h; y += 6) ctx.fillRect(0, y, w, 2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = LCARS.lilac;
  ctx.font = `500 26px ${LCARS_FONT}`;
  ctx.fillText(`TRANSPORTER ROOM ${i + 1}`, w / 2, h / 2 - 30);
  ctx.fillStyle = LCARS.peach;
  ctx.font = `600 44px ${LCARS_FONT}`;
  ctx.fillText('STANDING BY', w / 2, h / 2 + 16);
  return (idleFeeds[i] = flat(canvasTexture(canvas)));
}
