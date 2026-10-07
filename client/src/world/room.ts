import * as THREE from 'three';
import { helperFor, plannerFor, qaOfficerFor } from '../../../shared/crew';
import { prKey } from '../../../shared/qa';
import type { Agent, Board, Helper, Project } from '../../../shared/types';
import { DESKS_PER_ROOM, TEAM_STATIONS } from '../../../shared/types';
import { state } from '../net/state';
import { sound } from '../sound';
import { KanbanBoard } from './board';
import { type Builder, type Interaction, interactive } from './builder';
import { seatHelpers } from './helperSeats';
import { agentView, Character, type CrewView } from './character';
import { OVER_DOOR, type RoomSlot, ROOM_DEPTH, ROOM_WIDTH, WALL_H } from './layout';
import { box, flat, lighten, toon } from './materials';
import { ceilingLight, chair, cyl, paperStack, plant } from './props';
import { holodeckMaterial, holodeckSkin, type Scenery } from './scenery';
import { StationScreen } from './screen';
import { Beam } from './transporter';
import { HULL, LCARS, lcarsSign, workstation } from './starship';
import { type StationSeat, TeamStation } from './teamStation';

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
const HALF_W = ROOM_WIDTH / 2;
/** The QA officer's seat, at a station beside the pull requests table (room frame). */
const QA_SEAT = new THREE.Vector3(HALF_D - 2.7, 0, -HALF_W + 2.9);
/** Where a developer sits, relative to deskPosition(); the console in front of them is centred on it across the room. */
const DESK_SEAT = new THREE.Vector3(-0.68, 0, -0.22);
/** Things hung on the far wall sit this far in from its centre line, in front of a themed room's wall skin. */
const ON_WALL = HALF_D - 0.16;
/** Door signs hang on the hallway side, just proud of the door frame. */
const DOOR_SIGN_X = -HALF_D - OVER_DOOR;

/** A room's number on the door, the way a starship numbers its doors. */
const doorCode = (slot: RoomSlot) => `04-${String(slot.index + 2).padStart(2, '0')}`;

/** Local (room-frame) position of a desk: the room's two, either side of the aisle by the door, facing the Kanban board. */
export function deskPosition(index: number): THREE.Vector3 {
  return new THREE.Vector3(-HALF_D + 2.4, 0, (index === 0 ? -1 : 1) * 3.8);
}

/** Where to stand to look over an agent's shoulder at their station's display (room frame). */
export function deskViewpoint(index: number): { position: THREE.Vector3; lookAt: THREE.Vector3 } {
  return overShoulder(deskPosition(index).add(DESK_SEAT));
}

/** Behind the right shoulder of whoever sits at `seat`, looking at their workstation's display (room frame). */
function overShoulder(seat: THREE.Vector3): { position: THREE.Vector3; lookAt: THREE.Vector3 } {
  return {
    position: new THREE.Vector3(seat.x - 1.1, 0, seat.z + 1.0),
    lookAt: new THREE.Vector3(seat.x + 0.85, 1.1, seat.z + 0.22),
  };
}

/** A project's room: workstations with agents at them, the Kanban board and a pile of PRs to review. */
export class ProjectRoom {
  readonly group = new THREE.Group();
  readonly desks: DeskSlot[] = [];
  private board = new KanbanBoard();
  /** The operations officer behind the ＋ New issue stand, who drafts issues. */
  private planner!: Character;
  /** The QA officer at their station beside the pull requests table. */
  private qa!: Character;
  private qaScreen = new StationScreen(null, 'QA station · standing by');
  private qaStation!: THREE.Group;
  /** The team stations: one goal each, its lead in the command chair, and their helpers and reviewer at consoles. */
  private stations: TeamStation[] = [];
  private prPile = new THREE.Group();
  private prCount = -1;
  private boardDirty = true;
  /** Crew beaming in or out of their seats right now. */
  private beams: Beam[] = [];
  /** Off until the room is first filled, so whoever's already aboard when the page loads doesn't beam in. */
  private beaming = false;
  /** Whether you're in (or at the door of) this room, so you only hear its transporter. */
  private youreHere = false;

  /**
   * `scenery` is the landscape the room sits in (null for plain office walls). The World owns it, so it can
   * outlive this room when the building is rebuilt for an unrelated change. `teamStation` is the furniture each of
   * its team stations is a copy of (loadTeamStation).
   */
  constructor(
    public project: Project,
    readonly slot: RoomSlot,
    builder: Builder,
    private readonly scenery: Scenery | null,
    teamStation: THREE.Object3D,
  ) {
    this.group.position.copy(slot.center);
    this.group.rotation.y = slot.rotationY;
    builder.add(this.group);

    const carpet = lighten(project.color, 0.6);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_DEPTH - 0.2, ROOM_WIDTH - 0.2), toon(carpet));
    floor.material.userData.outlineParameters = { visible: false };
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.005;
    this.group.add(floor);
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_DEPTH - 2, 1.2), toon(lighten(project.color, 0.35)));
    stripe.material.userData.outlineParameters = { visible: false };
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(0.5, 0.01, 0);
    this.group.add(stripe);

    if (scenery) this.group.add(scenery.group); // a themed room's walls and ceiling show it

    // sign above the door, facing the hallway
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 0.62),
      flat(lcarsSign(project.name, { color: project.color, code: doorCode(slot), sub: project.repos.map((r) => r.split('/')[1]).join(' · ') || 'No repositories yet' })),
    );
    sign.rotation.y = -Math.PI / 2;
    sign.position.set(DOOR_SIGN_X, 2.87, 0);
    this.group.add(sign);
    interactive(sign, { kind: 'board', projectId: project.id }, () => `Open ${project.name}'s board`);

    // the Kanban display on the far wall: as tall as fits between its bottom rail and the ceiling, as wide as its drawing
    const boardBottom = 0.24;
    const boardTop = WALL_H - 0.2; // the top rail sits under the ceiling
    const boardW = (boardTop - boardBottom) * this.board.aspect;
    const post = boardW / 2 + 0.05;
    const boardMesh = new THREE.Mesh(new THREE.PlaneGeometry(boardW, boardTop - boardBottom), this.board.material);
    boardMesh.rotation.y = -Math.PI / 2;
    boardMesh.position.set(ON_WALL, (boardBottom + boardTop) / 2, 0);
    this.group.add(boardMesh);
    const frameColor = HULL.frame;
    this.group.add(box(0.08, 0.1, boardW + 0.2, frameColor, ON_WALL - 0.01, boardBottom - 0.1, 0));
    this.group.add(box(0.08, 0.1, boardW + 0.2, frameColor, ON_WALL - 0.01, boardTop, 0));
    for (const s of [-1, 1]) this.group.add(box(0.08, boardTop - boardBottom + 0.2, 0.1, frameColor, ON_WALL - 0.01, boardBottom - 0.1, s * post));
    // with no real wall behind it, the board stands on its own feet
    if (this.scenery) for (const s of [-1, 1]) this.group.add(box(0.7, 0.14, 0.12, frameColor, ON_WALL - 0.3, 0, s * post));
    interactive(boardMesh, { kind: 'board', projectId: project.id }, () => `Use the ${project.name} board`);

    // desks
    for (let i = 0; i < DESKS_PER_ROOM; i++) this.desks.push(this.buildDesk(i, builder));

    // PR review table
    const table = new THREE.Group();
    table.position.set(HALF_D - 2.0, 0, -HALF_W + 1.6);
    const top = cyl(0.65, 0.65, 0.06, '#ffffff', 24);
    top.position.y = 0.74;
    const leg = cyl(0.07, 0.12, 0.74, '#868e96');
    leg.position.y = 0.37;
    table.add(top, leg);
    this.prPile.position.set(0.28, 0.77, 0.22);
    table.add(this.prPile);
    const tableSign = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.28), flat(lcarsSign('Pull requests', { color: LCARS.lilac, h: 260 })));
    tableSign.position.set(0, 1.45, 0);
    tableSign.rotation.y = -Math.PI / 2;
    table.add(tableSign);
    this.group.add(table);
    interactive(table, { kind: 'board', projectId: project.id, tab: 'prs' }, () => 'Review pull requests');
    builder.collideObject(top);

    // the QA station: the QA officer sits beside the pull requests table facing the board, testing on a station you
    // can look at over their shoulder, the way you do at the developers'
    const qaStation = workstation(this.qaScreen.material, LCARS.lilac);
    qaStation.group.position.copy(QA_SEAT);
    this.qaStation = qaStation.group;
    this.group.add(qaStation.group);
    builder.collideObject(qaStation.group);
    this.qa = new Character(this.qaView());
    qaStation.seat.add(this.qa.group);

    // the team stations either side of the aisle, where each goal's lead works with the captain
    for (let i = 0; i < TEAM_STATIONS; i++) {
      const station = new TeamStation(i, [LCARS.gold, LCARS.periwinkle, LCARS.orange, LCARS.lilac][i], teamStation);
      this.group.add(station.group);
      builder.colliders.push(...station.colliders());
      this.stations.push(station);
    }

    // "new issue" stand with a note pad
    const kiosk = new THREE.Group();
    kiosk.position.set(HALF_D - 2.0, 0, HALF_W - 1.6);
    kiosk.add(box(0.5, 1.0, 0.5, project.color, 0, 0, 0));
    kiosk.add(box(0.6, 0.06, 0.6, '#ffffff', 0, 1.0, 0));
    const pad = box(0.3, 0.08, 0.3, LCARS.peach, 0, 1.06, 0);
    pad.rotation.y = 0.2;
    kiosk.add(pad);
    const pen = cyl(0.015, 0.015, 0.25, '#1971c2', 8);
    pen.rotation.set(Math.PI / 2, 0, 0.4);
    pen.position.set(0.05, 1.16, 0.15);
    kiosk.add(pen);
    const kioskSign = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.28), flat(lcarsSign('New issue', { color: LCARS.orange, h: 287 })));
    kioskSign.position.set(0, 2.55, 0); // above the officer's head and speech bubble
    kioskSign.rotation.y = -Math.PI / 2;
    kiosk.add(kioskSign);
    this.group.add(kiosk);
    interactive(kiosk, { kind: 'new-issue', projectId: project.id }, () => `File a new issue for ${project.name}`);
    builder.collideObject(kiosk.children[0]);

    // the room's operations officer sits behind the stand, facing whoever walks up to it
    const station = new THREE.Group();
    station.position.set(0.8, 0, 0);
    station.rotation.y = Math.PI;
    const stool = chair('#495057');
    station.add(stool);
    this.planner = new Character(this.plannerView());
    station.add(this.planner.group);
    kiosk.add(station);
    interactive(this.planner.group, { kind: 'new-issue', projectId: project.id }, () => `Ask ${plannerFor(project.id).name} to draft an issue`);
    builder.collideObject(stool);

    for (const [x, z] of [[HALF_D - 0.6, -HALF_W + 0.6], [HALF_D - 0.6, HALF_W - 0.6], [-HALF_D + 0.6, -HALF_W + 0.6], [-HALF_D + 0.6, HALF_W - 0.6]]) {
      const p = plant(1.1, ['#e07a5f', '#3d405b', '#81b29a', '#f2cc8f'][Math.abs(x + z) % 4 | 0]);
      p.position.set(x, 0, z);
      this.group.add(p);
      builder.collideObject(p.children[0]);
    }

    // only a plain office has a ceiling to hang lights from
    for (const x of this.scenery ? [] : [-4.5, 0.5, 5.5]) {
      for (const z of [-3, 3]) {
        const light = ceilingLight(1.4, 0.7);
        light.position.set(x, WALL_H - 0.03, z);
        this.group.add(light);
      }
    }

    this.syncAgents();
    this.syncPlanner();
    this.syncQa();
    this.beaming = true;
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
    if (!id || !view) return;
    if (!slot.character) {
      slot.character = new Character(view);
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
      station.setSign(lead ? `${lead.name} · ${lead.lead?.title ?? lead.issue.title}` : next ? `Free · next up: ${next}` : 'Free · start a goal here');
      const use: Interaction = lead ? { kind: 'agent', id: lead.id } : { kind: 'station', projectId: this.project.id, station: station.index };
      const label = () => (lead ? `Talk to ${lead.name}, lead of “${lead.lead?.title ?? 'a goal'}”` : next ? `Team station ${n} is free: start “${next}”` : `Start a goal at team station ${n}`);
      interactive(station.furniture, use, label);
      this.sit(station.lead, lead?.id, lead && agentView(lead), use, label);
      this.syncHelpers(station, lead);
      const reviewer = lead && reviewers.find((r) => r.reviewFor === lead.id);
      this.sit(station.reviewer, reviewer?.id, reviewer && agentView(reviewer), reviewer ? { kind: 'agent', id: reviewer.id } : use,
        () => (reviewer ? `${reviewer.name}, reviewing “${lead?.lead?.title ?? 'the goal'}”: ${reviewer.activity}` : label()));
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
      const view: CrewView = {
        name: crew.name,
        avatar: crew.avatar,
        tag: helper.type && helper.type !== 'general-purpose' ? helper.type : 'Helper',
        status: helper.status === 'working' ? 'working' : helper.status === 'done' ? 'done' : 'error',
        line: helper.status === 'working' ? helper.activity : `${helper.status === 'done' ? '✔' : '✘'} ${helper.activity}`,
      };
      this.sit(slot, helper.id, view, { kind: 'agent', id: lead.id }, () => `${crew.name}, helping ${lead.name}: ${helper.description}`);
    }
  }

  private buildDesk(index: number, builder: Builder): DeskSlot {
    const group = new THREE.Group();
    group.position.copy(deskPosition(index));
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

  private rebuildPrPile(board: Board | undefined): void {
    const count = Math.min(board?.prs.length ?? 0, 12);
    if (count === this.prCount) return;
    this.prCount = count;
    this.prPile.clear();
    this.prPile.add(paperStack(count, Object.values(LCARS)));
  }

  update(t: number, now: number, camera: THREE.Vector3): void {
    this.scenery?.update(t, this.group.worldToLocal(tmp.copy(camera)));
    // within earshot of a beam: in the room, or on its doorstep in the hallway
    this.youreHere = camera.distanceTo(this.slot.center) < HALF_D + 2;
    if (this.beams.length) this.beams = this.beams.filter((b) => !b.update(now));
    if (this.boardDirty) {
      this.boardDirty = false;
      const board = state.boards.get(this.project.id);
      this.board.draw(this.project, board, state.agentsIn(this.project.id));
      this.rebuildPrPile(board);
    }
    const inRoom = camera.distanceTo(this.slot.center) < ROOM_DEPTH;
    if (inRoom) this.planner.update(t, camera.distanceTo(this.planner.group.getWorldPosition(tmp)));
    const qaDist = camera.distanceTo(this.qa.group.getWorldPosition(tmp));
    if (inRoom) this.qa.update(t, qaDist);
    const qaAgent = state.qaAgent(this.project.id);
    this.qaScreen.maybeDraw(now, inRoom && qaDist < 6, qaAgent && state.lines.get(qaAgent.id), qaAgent && state.browser.get(qaAgent.id));
    for (const station of this.stations) {
      // everyone at a station fades their bubble by how near you are to the lead's chair, so from behind it, watching
      // the viewscreen, none of them cross it
      const atLead = camera.distanceTo(station.lead.seat.getWorldPosition(tmp));
      if (inRoom) for (const slot of [station.lead, ...station.helpers, station.reviewer]) slot.character?.update(t, atLead);
      const lead = station.lead.id;
      const near = inRoom && camera.distanceTo(station.group.getWorldPosition(tmp)) < 7;
      station.screen.maybeDraw(now, near, lead ? state.lines.get(lead) : undefined, lead ? state.browser.get(lead) : undefined);
    }
    for (const slot of this.desks) {
      if (!slot.character) {
        slot.screen.maybeDraw(now, false, undefined, undefined);
        continue;
      }
      const dist = camera.distanceTo(slot.character.group.getWorldPosition(tmp));
      if (inRoom) slot.character.update(t, dist);
      const near = inRoom && dist < 6;
      slot.screen.maybeDraw(now, near, state.lines.get(slot.agentId!), state.browser.get(slot.agentId!));
    }
  }

  /** World position and look target for standing behind an agent. */
  viewpoint(agentId: string): { position: THREE.Vector3; lookAt: THREE.Vector3 } | null {
    const slot = this.desks.find((d) => d.agentId === agentId);
    const qa = state.qaAgent(this.project.id)?.id === agentId;
    const station = this.stations.find((st) => st.lead.id === agentId);
    if (!slot && !qa && !station) return null;
    const v = slot
      ? deskViewpoint(slot.index)
      : station
        ? station.viewpoint()
        : overShoulder(QA_SEAT);
    this.group.updateWorldMatrix(true, false);
    return { position: v.position.applyMatrix4(this.group.matrixWorld), lookAt: v.lookAt.applyMatrix4(this.group.matrixWorld) };
  }

  dispose(): void {
    this.board.dispose();
    for (const slot of this.desks) {
      slot.screen.dispose();
      slot.character?.dispose();
    }
    this.planner.dispose();
    this.qa.dispose();
    this.qaScreen.dispose();
    for (const station of this.stations) station.dispose();
    for (const beam of this.beams) beam.finish();
  }
}

const tmp = new THREE.Vector3();

/** An empty room waiting for a project. */
/** An empty holodeck: dark, with the yellow grid. */
function bareHolodeck(slot: RoomSlot, builder: Builder): THREE.Group {
  const group = new THREE.Group();
  group.position.copy(slot.center);
  group.rotation.y = slot.rotationY;
  builder.add(group);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_DEPTH - 0.2, ROOM_WIDTH - 0.2), holodeckMaterial());
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.005;
  group.add(floor, holodeckSkin());
  return group;
}

/**
 * A hidden project's holodeck: its doors stay locked (the World builds them so) under an "in use" sign that doesn't
 * say whose, and nothing of the project is built inside.
 */
export function buildHiddenRoom(slot: RoomSlot, builder: Builder): THREE.Group {
  const group = bareHolodeck(slot, builder);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.62), flat(lcarsSign('Holodeck in use', { color: LCARS.red, code: doorCode(slot), sub: 'Program running · do not disturb' })));
  sign.rotation.y = -Math.PI / 2;
  sign.position.set(DOOR_SIGN_X, 2.87, 0);
  group.add(sign);
  // a plate on the closed doors, clear of the seam and band that stand out from their leaves
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.36), flat(lcarsSign('In use', { color: LCARS.red, h: 284 })));
  plate.rotation.y = -Math.PI / 2;
  plate.position.set(-HALF_D - 0.075, 1.5, 0);
  group.add(plate);
  return group;
}

export function buildVacantRoom(slot: RoomSlot, builder: Builder): THREE.Group {
  // waiting for a project to load a landscape
  const group = bareHolodeck(slot, builder);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.62), flat(lcarsSign('Holodeck vacant', { color: '#9a94a8', code: doorCode(slot), sub: 'Create a project in the ready room' })));
  sign.rotation.y = -Math.PI / 2;
  sign.position.set(DOOR_SIGN_X, 2.87, 0);
  group.add(sign);
  const poster = new THREE.Mesh(
    new THREE.PlaneGeometry(5, 1.4),
    flat(lcarsSign('Holodeck available', { w: 1024, h: 288, color: LCARS.gold, sub: 'Start a project from the ready room' })),
  );
  poster.rotation.y = -Math.PI / 2;
  poster.position.set(ON_WALL, 1.8, 0);
  group.add(poster);
  interactive(poster, { kind: 'manager', tab: 'new-project' }, () => 'Start a new project');
  // moving boxes
  const boxes = new THREE.Group();
  boxes.position.set(1, 0, -2);
  [[0, 0, 0], [0.7, 0, 0.1], [0.3, 0.5, 0.05], [0.1, 0, 0.8]].forEach(([x, y, z], i) => {
    const b = box(0.6, 0.5, 0.6, i % 2 ? '#d4a373' : '#ccd5ae', x, y, z);
    b.rotation.y = i * 0.3;
    boxes.add(b);
  });
  group.add(boxes);
  interactive(boxes, { kind: 'manager', tab: 'new-project' }, () => 'Start a new project');
  builder.collideObject(boxes);
  return group;
}
