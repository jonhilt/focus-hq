import * as THREE from 'three';
import { openQuestion } from '../../../shared/artifacts';
import { helperFor, plannerFor, qaOfficerFor } from '../../../shared/crew';
import { prKey } from '../../../shared/qa';
import type { Agent, Board, Helper, Project } from '../../../shared/types';
import { DESKS_PER_ROOM, TEAM_STATIONS } from '../../../shared/types';
import { state } from '../net/state';
import { sound } from '../sound';
import { KanbanBoard } from './board';
import { type Builder, type Interaction, interactive, REACH } from './builder';
import { seatHelpers } from './helperSeats';
import { agentView, Character, type CrewView } from './character';
import { buildHall } from './hall';
import { around, curvedPanel, deckEntrance, ENTRANCE_X, facingIn, hallPodSpots, inHall } from './hallLayout';
import { briefingRoomAt, footprints, HALL, hallAt, OVER_DOOR, type RoomSlot, ROOM_DEPTH, TRANSPORTER_ROOMS, transporterRoomAt } from './layout';
import { ContactShadows } from './contactShadow';
import { prGlance } from './goalRoom';
import { mergeStatic } from './merge';
import { box, flat, toon } from './materials';
import { padd, plant } from './props';
import { paddPiles, RACK_PILES } from './paddRack';
import { PR_LOOK } from './goalScreens';
import { holodeckMaterial, holodeckSkin, type Scenery } from './scenery';
import { StationScreen } from './screen';
import { DISPLAY_EVERY, redrawDue, type ScreenView, screenTest, takeDraw } from './screenRedraw';
import { paneUse } from './screenPanes';
import { Beam } from './transporter';
import { HULL, LCARS, lcarsSign, workstation } from './starship';
import { FloorGlow, hover } from './hologram';
import { OVERLAY_LAYER } from './frame';
import { AHEAD, Portal } from './portal';
import { type StationSeat, TEAM_SCREEN, TeamStation, type TeamStationKit } from './teamStation';
import type { TransporterRoom } from './transporterRoom';

interface DeskSlot {
  index: number;
  group: THREE.Group;
  station: THREE.Group;
  screen: StationScreen;
  seat: THREE.Group;
  character?: Character;
  agentId?: string;
}

const HALF_D = ROOM_DEPTH / 2;
/** Where a developer sits, relative to their desk's spot; the console in front of them is centred on it across the room. */
const DESK_SEAT = new THREE.Vector3(-0.68, 0, -0.22);
/** The holodeck's door sign hangs on the hallway side, just proud of the door frame (in the slot's frame, on the deck). */
const DOOR_SIGN_X = -HALF_D - OVER_DOOR;

/** A holodeck's number on its door, the way a starship numbers its doors. */
const doorCode = (slot: RoomSlot) => `04-${String(slot.index + 2).padStart(2, '0')}`;

/**
 * Where the hall's furniture stands (its frame): in the control ring in the middle, everyone facing the board, the
 * developers' desks nearest the entrance, then the QA officer's and the operations officer's stations either side of
 * the way up to the board; the PADD rack against the wall to the left as you come in, under a readout, and the pods
 * round the wall (hallLayout.ts).
 */
/** The PADD rack: a low console as long as eight piles of PADDs, its top at a hand's height, dark as the consoles' are. */
const PADD_RACK = { width: 2.8, height: 0.95, depth: 0.55, top: '#2b2735' };
/** A PADD lying flat (props.ts: 0.03 thick, its cap 0.036): how high its middle is on the rack, and over the one below. */
const PADD_LIE = 0.013;
const PADD_STEP = 0.029;

const PLAN = {
  desks: Array.from({ length: DESKS_PER_ROOM }, (_, i) => new THREE.Vector3(-2.4, 0, (i === 0 ? -1 : 1) * 2.0)),
  qa: new THREE.Vector3(1.0, 0, -2.0),
  ops: new THREE.Vector3(1.0, 0, 2.0),
  /** How far round the wall the PADD rack stands, from straight ahead. */
  paddRack: THREE.MathUtils.degToRad(-135),
  plants: [[ENTRANCE_X + 2.4, -4.2], [ENTRANCE_X + 2.4, 4.2], [-3.8, -9.4], [-3.8, 9.4]] as const,
  arrival: { position: new THREE.Vector3(ENTRANCE_X + 1.4, 0, 0), lookAt: new THREE.Vector3(HALL.radius, 1.8, 0) },
};

/** Behind the right shoulder of whoever sits at `seat`, looking at their workstation's display (room frame). */
function overShoulder(seat: THREE.Vector3): { position: THREE.Vector3; lookAt: THREE.Vector3 } {
  return {
    position: new THREE.Vector3(seat.x - 1.1, 0, seat.z + 1.0),
    lookAt: new THREE.Vector3(seat.x + 0.85, 1.1, seat.z + 0.22),
  };
}

/**
 * A project's holodeck: through its door on the deck, a training hall (hall.ts) with workstations with agents at them,
 * the Kanban board, the PADD rack with the pull requests to review, and the team stations' pods round the wall.
 */
export class ProjectRoom {
  readonly group = new THREE.Group();
  readonly desks: DeskSlot[] = [];
  private board = new KanbanBoard();
  /** The board's hologram, which hovers (hologram.ts). */
  private boardMesh!: THREE.Mesh;
  private boardY = 0;
  private boardGlow!: FloorGlow;
  private lastT = 0;
  /** The operations officer at the Ops station, who drafts issues and looks into stuck pull requests. */
  private planner!: Character;
  private opsScreen = new StationScreen(null, 'Operations · press N to draft an issue');
  /** The QA officer at their station in the control ring. */
  private qa!: Character;
  private qaScreen = new StationScreen(null, 'QA station · standing by');
  private qaStation!: THREE.Group;
  /** The team stations: one goal each, a door in the room to a briefing room where its lead, helpers and reviewer sit. */
  private stations: TeamStation[] = [];
  /** The PADDs on the rack, a pile per pull request waiting (paddRack.ts). */
  private padds = new THREE.Group();
  /** What the PADDs on the rack show, to rebuild them only when it changes. */
  private paddKey = '';
  private boardDirty = true;
  private boardDrawn = -Infinity;
  /** Crew beaming in or out of their seats right now. */
  private beams: Beam[] = [];
  /** The doorway from the holodeck's door on the deck to the hall's entrance. */
  private readonly entrance: Portal;
  /** Off until the room is first filled, so whoever's already aboard when the page loads doesn't beam in. */
  private beaming = false;
  /** Whether you're in (or at the door of) this room, so you only hear its transporter. */
  private youreHere = false;

  /**
   * `scenery` is the landscape the hall sits in (null for plain walls). The World owns it, so it can outlive this room
   * when the building is rebuilt for an unrelated change. `teamStation` is the door and briefing room each of its team
   * stations is a copy of (loadTeamStation), and `hallKit` the shell every hall is a copy of (loadTrainingHall).
   */
  constructor(
    public project: Project,
    readonly slot: RoomSlot,
    builder: Builder,
    private readonly scenery: Scenery | null,
    teamStation: TeamStationKit,
    hallKit: THREE.Object3D,
  ) {
    this.group.position.copy(hallAt(slot));
    this.group.rotation.y = slot.rotationY;
    // the hall is a region of its own (regions.ts), but the sign over its door is on the deck
    const deck = new THREE.Group();
    deck.position.copy(slot.center);
    deck.rotation.y = slot.rotationY;
    builder.add(deck);
    builder.halls.add(this.group);
    const entrance = buildHall(this.group, hallKit, { name: project.name, color: project.color, sub: 'Training hall' }, builder, !!scenery);
    this.entrance = new Portal(deckEntrance(slot, entrance), entrance);
    builder.add(this.entrance.ends[0].group);
    builder.halls.add(this.entrance.ends[1].group);

    if (scenery) this.group.add(scenery.group); // a themed hall's walls and ceiling show it

    // sign above the door, facing the hallway
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 0.62),
      flat(lcarsSign(project.name, { color: project.color, code: doorCode(slot), sub: project.repos.map((r) => r.split('/')[1]).join(' · ') || 'No repositories yet' })),
    );
    sign.rotation.y = -Math.PI / 2;
    sign.position.set(DOOR_SIGN_X, 2.87, 0);
    deck.add(sign);
    interactive(sign, { kind: 'board', projectId: project.id }, () => `Open ${project.name}'s board`);

    const boardMesh = (this.boardMesh = this.curvedBoard());
    this.boardY = boardMesh.position.y;
    // drawn over the outlines (frame.ts), so the lines of what's behind it are behind its glass too
    boardMesh.layers.set(OVERLAY_LAYER);
    // what stands on the floor shades it round where it stands (contactShadow.ts): one mesh for the room's furniture
    const shadows = new ContactShadows(this.group);
    interactive(boardMesh, { kind: 'board', projectId: project.id }, () => `Use the ${project.name} board`);
    // solid while you aim at it, so it's easy to read
    boardMesh.userData.aim = (on: boolean) => (this.board.hologram.aimed = on);

    // desks
    for (let i = 0; i < DESKS_PER_ROOM; i++) this.desks.push(this.buildDesk(i, builder));
    for (const desk of this.desks) shadows.add(desk.station);

    // the PADD rack: the pull requests waiting, each a pile of PADDs, as the crew hand each other a PADD rather than share a file
    const rack = this.paddRack(builder, shadows);
    interactive(rack, { kind: 'board', projectId: project.id, tab: 'prs' }, () => 'Review pull requests');

    // the QA station: the QA officer sits in the control ring facing the board, testing on a station you
    // can look at over their shoulder, the way you do at the developers'
    const qaStation = workstation(this.qaScreen.material, LCARS.lilac);
    qaStation.group.position.copy(PLAN.qa);
    this.qaStation = qaStation.group;
    this.group.add(qaStation.group);
    builder.collideObject(qaStation.group);
    shadows.add(qaStation.group);
    this.qa = new Character(this.qaView());
    qaStation.seat.add(this.qa.group);

    // the team stations' pods round the wall, each to the briefing room where a goal's lead works with the captain,
    // with its screen hung over it
    const pods = hallPodSpots();
    for (let i = 0; i < TEAM_STATIONS; i++) {
      const transporters = Array.from({ length: TRANSPORTER_ROOMS }, (_, k) => transporterRoomAt(slot, i, k));
      const station = new TeamStation(i, [LCARS.gold, LCARS.periwinkle, LCARS.orange, LCARS.lilac][i], teamStation, briefingRoomAt(slot, i), pods[i], project.id, transporters);
      this.group.add(station.door);
      shadows.add(station.door);
      overPod(station);
      this.group.add(station.podScreen);
      station.connect(builder, builder.halls);
      this.stations.push(station);
    }

    // the Ops station: the operations officer sits across from QA, facing the board,
    // drafting issues (N anywhere in the hall, or E on them) and looking into pull requests that are stuck
    const ops = workstation(this.opsScreen.material, LCARS.orange);
    ops.group.position.copy(PLAN.ops);
    this.group.add(ops.group);
    builder.collideObject(ops.group);
    shadows.add(ops.group);
    this.planner = new Character(this.plannerView());
    ops.seat.add(this.planner.group);
    interactive(ops.group, { kind: 'new-issue', projectId: project.id }, () => `File a new issue for ${project.name}`);
    interactive(this.planner.group, { kind: 'new-issue', projectId: project.id }, () => `Ask ${plannerFor(project.id).name} to draft an issue`);

    for (const [x, z] of PLAN.plants) {
      const p = plant(1.1, ['#e07a5f', '#3d405b', '#81b29a', '#f2cc8f'][Math.abs(x + z) % 4 | 0]);
      p.position.set(x, 0, z);
      this.group.add(p);
      shadows.add(p, 'round');
      builder.collideObject(p.children[0]);
    }

    const shaded = shadows.build();
    if (shaded) this.group.add(shaded);

    // the furniture is hundreds of meshes in a few dozen materials, a draw call each until they're merged (merge.ts):
    // the room's, then what's used (merged within itself, so it's still what's picked), keeping what moves or changes
    const keep = [
      ...(scenery ? [scenery.group] : []),
      ...this.stations.flatMap((s) => [s.door, s.podScreen]),
      ...this.desks.map((d) => d.seat),
      qaStation.seat,
      ops.seat,
      this.padds,
    ];
    for (const root of [this.group, ...this.desks.map((d) => d.station), qaStation.group, ops.group, rack]) mergeStatic(root, keep);

    this.syncAgents();
    this.syncPlanner();
    this.syncQa();
    this.beaming = true;
  }

  /**
   * The board: curved round the far wall, in front of it, between the pods either side, big enough to read from the
   * entrance and high enough to read over the desks: a hologram hovering in front of the wall.
   */
  private curvedBoard(): THREE.Mesh {
    const r = HALL.radius - 0.7;
    const bottom = 1.3;
    const top = 5.6;
    const half = ((top - bottom) * this.board.aspect) / 2 / r;
    const boardMesh = new THREE.Mesh(curvedPanel(r, -half, half, bottom, top, 40), this.board.material);
    this.group.add(boardMesh);
    // its light on the floor under it, spilling out into the hall
    const spill = 0.4 / r;
    this.boardGlow = FloorGlow.arc(r - 3.2, r + 0.3, -half - spill, half + spill, this.board.hologram.tint);
    this.group.add(this.boardGlow.mesh);
    return boardMesh;
  }

  /** Puts `character` in `seat`, beaming them in once the room is up and running. */
  private arrive(seat: THREE.Group, character: Character): void {
    seat.add(character.group);
    if (!this.beaming) return;
    this.beams.push(new Beam(character.group, 'in', performance.now()));
    if (this.youreHere) sound.beam();
  }

  /** Takes `character` out of `seat`, beaming them out first once the room is up and running. */
  private leave(seat: THREE.Group, character: Character): void {
    const gone = () => {
      seat.remove(character.group);
      character.dispose();
    };
    if (!this.beaming) return gone();
    this.beams.push(new Beam(character.group, 'out', performance.now(), gone));
    if (this.youreHere) sound.beam();
  }

  /**
   * Seats `id` (with `view`) in `slot`, beaming out whoever sat there before; nobody when `id` is undefined. Using them
   * does `use`.
   */
  private sit(slot: StationSeat, id: string | undefined, view: CrewView | undefined, use: Interaction, label: () => string): void {
    if (slot.id !== id && slot.character) {
      this.leave(slot.seat, slot.character);
      slot.character = undefined;
    }
    slot.id = id;
    slot.view = id ? view : undefined;
    if (!id || !view) return;
    if (!slot.character) {
      // in the briefing room, with a PADD each
      slot.character = new Character(view, 'padd');
      this.arrive(slot.seat, slot.character);
    }
    slot.character.set(view);
    interactive(slot.character.group, use, label);
  }

  /** Each team station's goal: its lead, their helpers, and the goal's QA reviewer; a free one says what's next. */
  syncStations(): void {
    const leads = state.leadsIn(this.project.id);
    const reviewers = state.reviewersIn(this.project.id);
    const next = this.project.goalQueue?.[0]?.text.split('\n')[0];
    for (const station of this.stations) {
      const lead = leads.find((a) => (a.lead?.station ?? 0) === station.index);
      const n = station.index + 1;
      station.screen.setAgent(lead ?? null);
      station.screen.setIdle(station.freeText(next));
      const use: Interaction = lead ? { kind: 'agent', id: lead.id } : { kind: 'station', projectId: this.project.id, station: station.index };
      const label = () => (lead ? `Talk to ${lead.name}, lead of “${lead.lead?.title ?? 'a goal'}”` : next ? `Team station ${n} is free: start “${next}”` : `Start a goal at team station ${n}`);
      for (const thing of station.furniture) interactive(thing, use, label);
      if (lead) interactive(station.goalBoard, { kind: 'agent', id: lead.id, view: 'goal' }, () => `Look at ${lead.name}’s goal and to-dos`);
      else interactive(station.goalBoard, use, label);
      if (lead) interactive(station.chartScreen, { kind: 'chart', id: lead.id }, () => `Open the star chart of “${lead.lead?.title ?? 'the goal'}”`);
      else interactive(station.chartScreen, use, label);
      // each of the lead's panes up close (what they've shown or asked, their browser…), from where the captain stands;
      // anywhere else on it, and while it's free, the screen is the station's, as its door is
      station.display.userData.interactionAt = lead ? (uv: THREE.Vector2) => {
        const pane = station.screen.paneAt(uv);
        return pane ? paneUse(pane, lead) : null;
      } : undefined;
      if (lead && (lead.lead?.artifacts?.length || lead.lead?.questions?.length)) {
        interactive(station.display, { kind: 'screen', id: lead.id }, () => (openQuestion(lead) ? `Answer ${lead.name}’s question` : `Look at what ${lead.name} has shown up close`), 10);
      } else interactive(station.display, use, label, lead ? 10 : REACH);
      this.sit(station.lead, lead?.id, lead && agentView(lead), use, label);
      this.syncHelpers(station, lead);
      const reviewer = lead && reviewers.find((r) => r.reviewFor === lead.id);
      this.sit(station.reviewer, reviewer?.id, reviewer && agentView(reviewer), reviewer ? { kind: 'agent', id: reviewer.id } : use,
        () => (reviewer ? `${reviewer.name}, reviewing “${lead?.lead?.title ?? 'the goal'}”: ${reviewer.activity}` : label()));
      // once everyone's seated: the sign, the lamps and the goal board, with its roster of who's in the room, and
      // the station's screen over its pod, with how the slice's pull requests stand
      const prs = lead?.lead?.prs.map((pr) => ({ label: `${pr.repo.split('/')[1]} #${pr.number}`, state: prGlance(pr, state.reviews.get(prKey(pr.repo, pr.number))?.status) }));
      station.show(lead, next, prs);
      station.showWorkflows(lead, performance.now());
      station.showBackground(lead);
    }
  }

  /** Seats the lead's helpers at their station's consoles, and sends the ones who've gone on their way. */
  private syncHelpers(station: TeamStation, lead: Agent | undefined): void {
    const helpers: Helper[] = lead?.helpers ?? [];
    const seats = seatHelpers(station.helpers.map((s) => s.id), helpers.map((h) => h.id));
    for (const [i, slot] of station.helpers.entries()) {
      const helper = helpers.find((h) => h.id === seats[i]);
      if (!helper || !lead) {
        this.sit(slot, undefined, undefined, { kind: 'station', projectId: this.project.id, station: station.index }, () => '');
        continue;
      }
      const crew = helperFor(helper.id);
      // a helper's own helper says whose it is
      const boss = helper.parent ? helperFor(helper.parent).name : undefined;
      const view: CrewView = {
        name: crew.name,
        avatar: crew.avatar,
        tag: boss ? `for ${boss}` : helper.type && helper.type !== 'general-purpose' ? helper.type : 'Helper',
        status: helper.status === 'working' ? 'working' : helper.status === 'done' ? 'done' : 'error',
        line: helper.status === 'working' ? helper.activity : `${helper.status === 'done' ? '✔' : '✘'} ${helper.activity}`,
      };
      this.sit(slot, helper.id, view, { kind: 'helper', leadId: lead.id, id: helper.id }, () => `${crew.name}, helping ${boss ?? lead.name}: ${helper.description}`);
    }
  }

  private buildDesk(index: number, builder: Builder): DeskSlot {
    const group = new THREE.Group();
    group.position.copy(PLAN.desks[index]);
    this.group.add(group);
    const screen = new StationScreen(null);
    const station = workstation(screen.material, [LCARS.orange, LCARS.periwinkle, LCARS.gold][index % 3]);
    station.group.position.copy(DESK_SEAT);
    group.add(station.group);
    builder.collideObject(station.group);

    const slot: DeskSlot = { index, group, station: station.group, screen, seat: station.seat };
    interactive(station.group, { kind: 'desk', projectId: this.project.id }, () => this.deskLabel(slot));
    return slot;
  }

  private deskLabel(slot: DeskSlot): string {
    const agent = slot.agentId ? state.agents.get(slot.agentId) : undefined;
    return agent ? `Look at ${agent.name}'s station (#${agent.issue.number})` : 'Empty station – assign an issue from the board';
  }

  /** Seats, updates and removes characters to match the agents in this project. */
  syncAgents(): void {
    const agents = state.agentsIn(this.project.id);
    for (const slot of this.desks) {
      const agent = agents.find((a) => a.desk === slot.index);
      if (!agent) {
        if (slot.character) {
          this.leave(slot.seat, slot.character);
          slot.character = undefined;
        }
        if (slot.agentId) {
          slot.agentId = undefined;
          slot.screen.setAgent(null);
          interactive(slot.station, { kind: 'desk', projectId: this.project.id }, () => this.deskLabel(slot));
        }
        continue;
      }
      if (slot.agentId !== agent.id) {
        if (slot.character) this.leave(slot.seat, slot.character);
        slot.character = new Character(agentView(agent));
        this.arrive(slot.seat, slot.character);
        slot.agentId = agent.id;
        interactive(slot.character.group, { kind: 'agent', id: agent.id }, () => `Talk to ${agent.name} (#${agent.issue.number})`);
        interactive(slot.station, { kind: 'agent', id: agent.id }, () => this.deskLabel(slot));
      }
      slot.character!.set(agentView(agent));
      slot.screen.setAgent(agent);
    }
    this.syncStations();
    this.boardDirty = true;
  }

  /** What the planner is up to: looking into a stuck PR, else the project's issue draft. */
  private plannerView(): CrewView {
    const crew = plannerFor(this.project.id);
    const draft = state.drafts.get(this.project.id);
    const base = { name: crew.name, avatar: crew.avatar, tag: 'Ops' };
    const stuck = state.reviewsIn(this.project.id).find((r) => r.followUp?.kind === 'triaging');
    if (stuck?.followUp?.kind === 'triaging') {
      const { activity } = stuck.followUp;
      return { ...base, status: 'working', icon: '🧭', line: `Why is PR #${stuck.number} stuck? ${activity}`, thinking: activity === 'Thinking…' };
    }
    switch (draft?.status) {
      case 'drafting':
        return { ...base, status: 'working', icon: '📝', line: draft.activity, thinking: draft.activity === 'Thinking…' };
      case 'ready':
        return { ...base, status: 'done', icon: '📋', line: 'Draft ready – come and see' };
      case 'failed':
        return { ...base, status: 'error', line: 'Couldn’t finish the draft' };
      default:
        return { ...base, status: 'queued', icon: '🖖', line: 'Got an idea? I’ll write it up' };
    }
  }

  syncPlanner(): void {
    this.planner.set(this.plannerView());
  }

  /** The QA officer's look, from their latest review. */
  private qaView(): CrewView {
    const agent = state.qaAgent(this.project.id);
    if (!agent) {
      const crew = qaOfficerFor(this.project.id);
      const queued = state.reviewsIn(this.project.id).some((r) => r.status === 'queued');
      return { name: crew.name, avatar: crew.avatar, tag: 'QA', icon: '🔍', status: 'queued', line: queued ? 'PRs queued for testing' : 'Standing by for pull requests' };
    }
    const view = agentView(agent);
    // a verdict is "done" either way; a fail shouldn't look like a celebration
    if (agent.status === 'done' && state.reviews.get(prKey(agent.repo, agent.issue.number))?.status === 'failed') view.status = 'error';
    return view;
  }

  syncQa(): void {
    const agent = state.qaAgent(this.project.id);
    this.qa.set(this.qaView());
    this.qaScreen.setAgent(agent ?? null);
    const name = qaOfficerFor(this.project.id).name;
    const use = agent
      ? ({ kind: 'agent', id: agent.id } as const)
      : ({ kind: 'qa', projectId: this.project.id } as const);
    const label = () => (agent ? `Look at ${name}'s station (testing PR #${agent.issue.number})` : `${name}'s QA station`);
    interactive(this.qa.group, use, label);
    interactive(this.qaStation, use, label);
  }

  markScreen(agentId: string): void {
    this.desks.find((d) => d.agentId === agentId)?.screen.markDirty();
    if (state.qaAgent(this.project.id)?.id === agentId) this.qaScreen.markDirty();
    for (const station of this.stations) if (station.lead.id === agentId) station.screen.markDirty();
  }

  markBoard(): void {
    this.boardDirty = true;
  }

  /**
   * The PADD rack against the wall: a low console under the readout there, with the PADDs (`padds`) lying on its top
   * and its sign standing at the back. Returns it, to use.
   */
  private paddRack(builder: Builder, shadows: ContactShadows): THREE.Group {
    const { width, height, depth } = PADD_RACK;
    const rack = new THREE.Group();
    // standing clear of the round wall, its back's ends too (where the wall curves in towards them), and of its trims
    rack.position.copy(around(HALL.radius - 0.26 - depth / 2, PLAN.paddRack));
    rack.rotation.y = facingIn(PLAN.paddRack);
    const body = box(width, height - 0.05, depth, HULL.bulkhead);
    rack.add(body);
    rack.add(box(width + 0.04, 0.05, depth + 0.04, PADD_RACK.top, 0, height - 0.05, 0));
    // a kick in the dado's colour and the LCARS stripe along its front, each a little proud of it
    rack.add(box(width - 0.02, 0.12, 0.02, HULL.dado, 0, 0, -depth / 2 - 0.005));
    rack.add(box(width - 0.02, 0.05, 0.02, LCARS.lilac, 0, height - 0.2, -depth / 2 - 0.005));
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.28), flat(lcarsSign('Pull requests', { color: LCARS.lilac, h: 260 })));
    // standing at the back of its top, facing out of it (-Z)
    sign.rotation.y = Math.PI;
    sign.position.set(0, height + 0.16, depth / 2 - 0.06);
    rack.add(sign);
    rack.add(box(1.14, 0.02, 0.04, HULL.frame, 0, height, depth / 2 - 0.04));
    this.padds.position.y = height;
    rack.add(this.padds);
    this.group.add(rack);
    shadows.add(body);
    rack.updateWorldMatrix(true, true);
    // turned with the wall, so as a chain of small boxes rather than one round its turned bounds (layout.ts)
    builder.colliders.push(...footprints(new THREE.Matrix4().multiplyMatrices(body.matrixWorld, new THREE.Matrix4().makeScale(width / 2 + 0.05, 1, depth / 2 + 0.05))));
    return rack;
  }

  /** Lays the pull requests waiting on the rack: a pile of PADDs each, the top one's cap lit in how QA has it. */
  private rebuildPadds(board: Board | undefined): void {
    const prs = (board?.prs ?? []).map((pr) => ({ number: pr.number, glance: prGlance({}, state.reviews.get(prKey(pr.repo, pr.number))?.status) }));
    const key = prs.map((p) => `${p.number}:${p.glance}`).join(',');
    if (key === this.paddKey) return;
    this.paddKey = key;
    // each PADD's geometries are its own (props.ts); their materials are shared
    this.padds.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.padds.clear();
    const piles = paddPiles(prs, (pr) => pr.number);
    const step = (PADD_RACK.width - 0.3) / RACK_PILES;
    piles.forEach((pile, i) => {
      pile.forEach((pr, level) => {
        const p = padd();
        // lying on its back, screen up, a little askew on the one below and a little sunk into it (and the bottom one
        // into the rack's top), so none of their faces lie on another's or hover just off it
        // (its length front to back, so the piles keep apart however askew)
        p.rotation.set(0, Math.PI / 2 + (((pr.number * 7 + level * 13) % 9) - 4) * 0.025, -Math.PI / 2, 'YXZ');
        p.position.set((i - (RACK_PILES - 1) / 2) * step, PADD_LIE + level * PADD_STEP, -0.05);
        // the cap of each lit in how its pull request stands
        const cap = p.children[1] as THREE.Mesh;
        cap.material = toon(PR_LOOK[pr.glance].color);
        this.padds.add(p);
      });
    });
  }

  /** The doorways between the holodeck and its team stations' briefing rooms. */
  portals(): Portal[] {
    return [this.entrance, ...this.stations.map((s) => s.portal)];
  }

  /** Whether a world position is in this holodeck's hall. */
  holds(p: THREE.Vector3): boolean {
    return inHall(this.group.position, p);
  }

  /** Where you arrive when you teleport here, and what you look at (world). */
  arrival(): { position: THREE.Vector3; lookAt: THREE.Vector3 } {
    this.group.updateWorldMatrix(true, false);
    const { position, lookAt } = PLAN.arrival;
    return { position: position.clone().applyMatrix4(this.group.matrixWorld), lookAt: lookAt.clone().applyMatrix4(this.group.matrixWorld) };
  }

  /** Its team stations' briefing rooms. */
  briefingRooms(): THREE.Object3D[] {
    return this.stations.map((s) => s.room);
  }

  /** Its team stations' transporter rooms, station by station. */
  transporterRooms(): TransporterRoom[] {
    return this.stations.flatMap((s) => s.transporterRooms);
  }

  /** Its team stations. */
  teamStations(): readonly TeamStation[] {
    return this.stations;
  }

  /**
   * What's about to come into view through a door `camera`'s nearing: the hall, from the hallway or one of its briefing
   * rooms; a briefing room, from the hall.
   */
  ahead(camera: THREE.Vector3): THREE.Object3D[] {
    const briefing = this.stations.find((s) => s.inside(camera));
    if (briefing) return briefing.portal.near(camera, AHEAD) ? [this.group] : [];
    if (!this.holds(camera)) return this.entrance.near(camera, AHEAD) ? [this.group] : [];
    return this.stations.filter((s) => s.portal.near(camera, AHEAD)).map((s) => s.room);
  }

  /** The team station whose briefing room a world position is in, if it's in one of this room's. */
  briefingRoomOf(p: THREE.Vector3): number | undefined {
    return this.stations.find((s) => s.inside(p))?.index;
  }

  update(t: number, now: number, camera: THREE.Vector3): void {
    // from a briefing room, the holodeck is what you see through its door
    const briefing = this.stations.find((s) => s.inside(camera));
    const eye = briefing ? briefing.threshold() : camera;
    // and from the hallway, the hall is what you see through its door on the deck: as if beyond its entrance
    const looking = !briefing && !this.holds(camera) ? tmp.copy(camera).applyMatrix4(this.entrance.ends[0].through) : tmp.copy(eye);
    this.scenery?.update(t, this.group.worldToLocal(looking));
    // within earshot of a beam: in the hall, or at its door in the hallway, or in one of its briefing rooms
    this.youreHere = this.holds(eye) || eye.distanceTo(this.slot.center) < HALF_D + 2;
    if (this.beams.length) this.beams = this.beams.filter((b) => !b.update(now));
    hover(this.boardMesh, this.boardY, t);
    this.boardGlow.update(t);
    this.board.hologram.update(Math.min(0.1, t - this.lastT));
    this.lastT = t;
    const inRoom = this.holds(eye);
    // the hall's screens are seen from in it, or through a door to it (the hallway's or a briefing room's) as you near it
    const hallSeen = briefing ? briefing.portal.near(camera, AHEAD) : this.holds(camera) || this.entrance.near(camera, AHEAD);
    const hallView = (near: boolean): ScreenView => (!hallSeen ? 'unseen' : near ? 'near' : 'far');
    // out of sight it's still drawn now and then, so there's little to draw as you come into view (only to send)
    const boardDue = this.boardDirty && !(screenTest.still && this.boardDrawn > -Infinity) && redrawDue({ changed: true, blinking: false, at: this.boardDrawn, cursor: false }, inRoom ? 'near' : 'far', now, DISPLAY_EVERY);
    if (boardDue && takeDraw()) {
      this.boardDirty = false;
      this.boardDrawn = now;
      const board = state.boards.get(this.project.id);
      this.board.draw(this.project, board, state.agentsIn(this.project.id));
      this.rebuildPadds(board);
    }
    if (inRoom) this.planner.update(t, eye.distanceTo(this.planner.group.getWorldPosition(tmp)));
    this.opsScreen.maybeDraw(now, hallView(false), undefined, undefined);
    const qaDist = eye.distanceTo(this.qa.group.getWorldPosition(tmp));
    if (inRoom) this.qa.update(t, qaDist);
    const qaAgent = state.qaAgent(this.project.id);
    this.qaScreen.maybeDraw(now, hallView(inRoom && qaDist < 6), qaAgent && state.lines.get(qaAgent.id), qaAgent && state.browser.get(qaAgent.id));
    for (const station of this.stations) {
      station.update(t);
      station.updateTransporters(t, now, camera, station === briefing);
      if (station === briefing) station.animateChart(now);
      // only drawn while you're in it, or might see into it through its open door
      station.room.visible = station === briefing || station.portal.ajar;
      // in the briefing room, or seeing into it through the door
      const seen = station.eye(camera, inRoom && !briefing);
      // everyone seated fades their bubble by how near you are to where the captain stands, so from there, watching the
      // screen, none of them cross it
      const atHead = seen ? station.fromHead(seen) : 0;
      if (seen) for (const slot of [station.lead, ...station.helpers, station.reviewer]) slot.character?.update(t, atHead);
      const lead = station.lead.id;
      const view: ScreenView = !station.room.visible && !station.portal.near(camera, AHEAD) ? 'unseen' : seen && station.fromScreen(seen) < 13 ? 'near' : 'far';
      station.screen.maybeDraw(now, view, lead ? state.lines.get(lead) : undefined, lead ? state.browser.get(lead) : undefined);
      // its sign and the screen over its pod are in the hall, its goal board and chart in the briefing room; out of sight
      // they're still drawn now and then, so there's little to draw as they come into view (only to send)
      station.updateDisplays(now, view === 'near' ? 'near' : 'far');
    }
    for (const slot of this.desks) {
      if (!slot.character) {
        slot.screen.maybeDraw(now, hallView(false), undefined, undefined);
        continue;
      }
      const dist = eye.distanceTo(slot.character.group.getWorldPosition(tmp));
      if (inRoom) slot.character.update(t, dist);
      slot.screen.maybeDraw(now, hallView(inRoom && dist < 6), state.lines.get(slot.agentId!), state.browser.get(slot.agentId!));
    }
  }

  /** The team station a goal's lead works at (the studio frames its shots from it). */
  stationOf(leadId: string): TeamStation | undefined {
    return this.stations.find((st) => st.lead.id === leadId);
  }

  /** World position and look target for standing behind an agent. */
  viewpoint(agentId: string): { position: THREE.Vector3; lookAt: THREE.Vector3 } | null {
    const slot = this.desks.find((d) => d.agentId === agentId);
    const qa = state.qaAgent(this.project.id)?.id === agentId;
    const station = this.stations.find((st) => st.lead.id === agentId);
    if (!slot && !qa && !station) return null;
    // the briefing room is in the world already
    if (station) return station.viewpoint();
    const v = overShoulder(slot ? PLAN.desks[slot.index].clone().add(DESK_SEAT) : PLAN.qa);
    this.group.updateWorldMatrix(true, false);
    return { position: v.position.applyMatrix4(this.group.matrixWorld), lookAt: v.lookAt.applyMatrix4(this.group.matrixWorld) };
  }

  dispose(): void {
    this.board.dispose();
    this.boardGlow.dispose();
    for (const slot of this.desks) {
      slot.screen.dispose();
      slot.character?.dispose();
    }
    this.planner.dispose();
    this.opsScreen.dispose();
    this.qa.dispose();
    this.qaScreen.dispose();
    for (const station of this.stations) station.dispose();
    for (const beam of this.beams) beam.finish();
  }
}

const tmp = new THREE.Vector3();

/**
 * A team station's screen hangs over its pod, over the sign floating there, tipped down to the middle of the hall: you
 * can see what every team's up to from the control ring without going in.
 */
const POD_SCREEN = { scale: 1.4, bottom: 3.3, out: 0.6, tilt: 0.15 };

function overPod(station: TeamStation): void {
  const { scale, bottom, out, tilt } = POD_SCREEN;
  const yaw = station.door.rotation.y;
  const half = ((TEAM_SCREEN.height + TEAM_SCREEN.rim * 2) * scale) / 2;
  station.podScreen.position.copy(station.door.position).add(new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)).multiplyScalar(out)).setY(bottom + half);
  // its front (+Z) out of the pod, towards the middle
  station.podScreen.rotation.set(tilt, yaw + Math.PI, 0, 'YXZ');
  station.podScreen.scale.setScalar(scale);
}

/**
 * A hidden project's holodeck: its doors stay locked (the World builds them so) under an "in use" sign that doesn't
 * say whose, and there's nothing behind them.
 */
export function buildHiddenRoom(slot: RoomSlot, builder: Builder): void {
  const group = new THREE.Group();
  group.position.copy(slot.center);
  group.rotation.y = slot.rotationY;
  builder.add(group);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.62), flat(lcarsSign('Holodeck in use', { color: LCARS.red, code: doorCode(slot), sub: 'Program running · do not disturb' })));
  sign.rotation.y = -Math.PI / 2;
  sign.position.set(DOOR_SIGN_X, 2.87, 0);
  group.add(sign);
  // a plate on the closed doors, clear of the seam and band that stand out from their leaves
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.36), flat(lcarsSign('In use', { color: LCARS.red, h: 284 })));
  plate.rotation.y = -Math.PI / 2;
  plate.position.set(-HALF_D - 0.075, 1.5, 0);
  group.add(plate);
}

/**
 * A vacant holodeck, waiting for a project: through its door on the deck, a training hall with nothing running, dark
 * with the yellow grid, a poster on its far wall and a few moving boxes, each of which starts a project.
 */
export class VacantHall {
  readonly group = new THREE.Group();
  /** What stands in it: the poster and the moving boxes, which the studio's stage clears away (ui/holoStage.ts). */
  readonly props: THREE.Object3D[] = [];
  /** The doorway from its door on the deck to the hall's entrance. */
  readonly portal: Portal;

  constructor(slot: RoomSlot, builder: Builder, hallKit: THREE.Object3D) {
    this.group.position.copy(hallAt(slot));
    this.group.rotation.y = slot.rotationY;
    builder.halls.add(this.group);
    const entrance = buildHall(this.group, hallKit, { name: 'Holodeck vacant', color: '#9a94a8', sub: 'Start a project from the ready room' }, builder, true);
    this.portal = new Portal(deckEntrance(slot, entrance), entrance);
    builder.add(this.portal.ends[0].group);
    builder.halls.add(this.portal.ends[1].group);

    const deck = new THREE.Group();
    deck.position.copy(slot.center);
    deck.rotation.y = slot.rotationY;
    builder.add(deck);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.62), flat(lcarsSign('Holodeck vacant', { color: '#9a94a8', code: doorCode(slot), sub: 'Create a project in the ready room' })));
    sign.rotation.y = -Math.PI / 2;
    sign.position.set(DOOR_SIGN_X, 2.87, 0);
    deck.add(sign);

    // the grid over the hall's walls, ceiling and floor (the grid's drawn in its mesh's own frame, so the floor's laid
    // flat in its geometry, not by turning it)
    const floor = new THREE.Mesh(new THREE.CircleGeometry(HALL.radius, 96).rotateX(-Math.PI / 2), holodeckMaterial());
    floor.position.y = 0.004;
    this.group.add(floor, holodeckSkin());
    const poster = new THREE.Mesh(
      new THREE.PlaneGeometry(5, 1.4),
      flat(lcarsSign('Holodeck available', { w: 1024, h: 288, color: LCARS.gold, sub: 'Start one in the ready room' })),
    );
    poster.rotation.y = -Math.PI / 2;
    // flat in front of the round wall's grid: far enough in that its ends, 2.5 m either side, stay in front of it too
    poster.position.set(HALL.radius - 0.5, 1.8, 0);
    this.group.add(poster);
    this.props.push(poster);
    interactive(poster, { kind: 'manager', tab: 'new-project' }, () => 'Start a new project');
    // moving boxes
    const boxes = new THREE.Group();
    boxes.position.set(1, 0, -2);
    [[0, 0, 0], [0.7, 0, 0.1], [0.3, 0.5, 0.05], [0.1, 0, 0.8]].forEach(([x, y, z], i) => {
      const b = box(0.6, 0.5, 0.6, i % 2 ? '#d4a373' : '#ccd5ae', x, y, z);
      b.rotation.y = i * 0.3;
      boxes.add(b);
    });
    this.group.add(boxes);
    this.props.push(boxes);
    interactive(boxes, { kind: 'manager', tab: 'new-project' }, () => 'Start a new project');
    builder.collideObject(boxes);
  }

  /** Whether a world position is in the hall. */
  holds(p: THREE.Vector3): boolean {
    return inHall(this.group.position, p);
  }
}
