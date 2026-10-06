import * as THREE from 'three';
import type { Character } from './character';
import { box, flat } from './materials';
import { cyl } from './props';
import { BIG_SCREEN, StationScreen } from './screen';
import { HULL, lcarsSign, stationSeat } from './starship';

// A team station: where a goal's lead works with the captain, their helpers (Claude Code's subagents) gather round,
// and the goal's own QA reviewer sits in to review its pull requests. A hexagonal table with a seat at each side and
// the lead's display standing in its middle. Built in the station's own frame (the lead's seat towards +Z), which the
// room turns and places (`STATION_SPOTS`).

/** The room's four team stations, in the room frame: either side of the aisle, the lead's seat on the aisle side. */
export const STATION_SPOTS: { at: THREE.Vector3; rotationY: number }[] = [
  { at: new THREE.Vector3(-2.0, 0, -3.5), rotationY: 0 },
  { at: new THREE.Vector3(1.7, 0, -3.5), rotationY: 0 },
  { at: new THREE.Vector3(-2.0, 0, 3.5), rotationY: Math.PI },
  { at: new THREE.Vector3(1.7, 0, 3.5), rotationY: Math.PI },
];

const TOP = 0.74;
/** The table's corners are this far from its middle; its flat sides face the seats. */
const HEX_R = 0.95;
/** How far each seat is from the middle of the table. */
const SEAT_D = 1.27;
/** The lead's display in the middle of the table, facing the lead. BIG_SCREEN's proportions. */
const DISPLAY = { w: 1.7, h: (1.7 * BIG_SCREEN.h) / BIG_SCREEN.w, bottom: 1.24 };

/** Seat angles round the table from the lead's (0): the reviewer sits opposite, the helpers either side, nearest first. */
const LEAD_ANGLE = 0;
const REVIEWER_ANGLE = Math.PI;
const HELPER_ANGLES = [Math.PI / 3, -Math.PI / 3, (2 * Math.PI) / 3, (-2 * Math.PI) / 3];

/** Who sits in a seat: the agent (or helper) id, and their Character while they're there. */
export interface StationSeat {
  seat: THREE.Group;
  id?: string;
  character?: Character;
}

export class TeamStation {
  /** In the room frame. */
  readonly group = new THREE.Group();
  readonly screen: StationScreen;
  readonly lead: StationSeat;
  /** In the order helpers take them (`seatHelpers`). */
  readonly helpers: StationSeat[];
  readonly reviewer: StationSeat;
  /** The table and the display: what "use this station" hangs on. */
  readonly table = new THREE.Group();
  readonly display = new THREE.Group();
  /** What blocks the player: the table, the display's stand and every chair. */
  readonly colliders: THREE.Object3D[];
  private readonly sign: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private signText = '';

  constructor(
    readonly index: number,
    private readonly accent: string,
  ) {
    const spot = STATION_SPOTS[index];
    this.group.position.copy(spot.at);
    this.group.rotation.y = spot.rotationY;
    this.screen = new StationScreen(null, this.freeText(), BIG_SCREEN);

    // the hexagonal table, a flat side towards each seat, with an LCARS band under its rim
    const top = cyl(HEX_R, HEX_R, 0.06, HULL.bulkhead, 6);
    top.rotation.y = Math.PI / 6;
    top.position.y = TOP;
    const rim = cyl(HEX_R + 0.035, HEX_R + 0.035, 0.03, accent, 6);
    rim.rotation.y = Math.PI / 6;
    rim.position.y = TOP - 0.05;
    const pedestal = cyl(0.14, 0.24, TOP - 0.09, HULL.frame);
    pedestal.position.y = 0.03 + (TOP - 0.09) / 2;
    const foot = cyl(0.5, 0.56, 0.05, HULL.dado, 32);
    foot.position.y = 0.025;
    this.table.add(top, rim, pedestal, foot);
    this.group.add(this.table);

    // the display in the middle of the table, leaning back a touch towards the lead; its back says whose station it is
    // the stand starts a little inside the table top and ends inside the frame, so it shares no face with either
    const stand = box(0.1, DISPLAY.bottom - TOP - 0.025, 0.1, HULL.frame, 0, TOP + 0.025, -0.02);
    this.display.add(stand);
    const panel = new THREE.Group();
    panel.position.y = DISPLAY.bottom + DISPLAY.h / 2;
    panel.rotation.x = -0.08;
    panel.add(box(DISPLAY.w + 0.1, DISPLAY.h + 0.1, 0.06, HULL.frame, 0, -(DISPLAY.h + 0.1) / 2, -0.03));
    // the accent bar sits just clear of the frame's top and sides, so no two faces share a plane
    panel.add(box(DISPLAY.w + 0.12, 0.06, 0.07, accent, 0, DISPLAY.h / 2 + 0.055, -0.03));
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(DISPLAY.w, DISPLAY.h), this.screen.material);
    plane.position.z = 0.004;
    panel.add(plane);
    this.sign = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.42), flat(lcarsSign('', { h: 287 })));
    this.sign.rotation.y = Math.PI;
    this.sign.position.set(0, 0.12, -0.064);
    panel.add(this.sign);
    this.display.add(panel);
    this.group.add(this.display);
    this.setSign(this.freeText());

    const chairAt = (angle: number) => {
      const g = new THREE.Group();
      g.position.set(SEAT_D * Math.sin(angle), 0, SEAT_D * Math.cos(angle));
      // a Character faces +X: turned to face the middle of the table
      g.rotation.y = angle + Math.PI / 2;
      g.add(stationSeat('#5c5470'));
      this.group.add(g);
      return g;
    };
    this.lead = { seat: chairAt(LEAD_ANGLE) };
    this.helpers = HELPER_ANGLES.map((a) => ({ seat: chairAt(a) }));
    this.reviewer = { seat: chairAt(REVIEWER_ANGLE) };
    this.colliders = [top, stand, this.lead.seat, ...this.helpers.map((h) => h.seat), this.reviewer.seat];
  }

  /** What the station says while it has no goal. */
  freeText(next?: string): string {
    return next ? `Next up: ${next}` : `Team station ${this.index + 1} · start a goal here`;
  }

  /** The sign on the back of the display: the station's number, and its goal (`sub`). */
  setSign(sub: string): void {
    if (sub === this.signText) return;
    this.signText = sub;
    const old = this.sign.material.map;
    this.sign.material.map = lcarsSign(`Team station ${this.index + 1}`, { color: this.accent, code: `TS-${this.index + 1}`, sub, h: 287 });
    this.sign.material.needsUpdate = true;
    old?.dispose();
  }

  /** Behind the lead's right shoulder, looking at the display (room frame). */
  viewpoint(): { position: THREE.Vector3; lookAt: THREE.Vector3 } {
    const local = {
      // far enough right and back that the lead's head sits at the screen's edge, not in front of it
      position: new THREE.Vector3(1.4, 0, SEAT_D + 1.45),
      lookAt: new THREE.Vector3(0, DISPLAY.bottom + DISPLAY.h / 2, 0),
    };
    this.group.updateMatrix();
    return { position: local.position.applyMatrix4(this.group.matrix), lookAt: local.lookAt.applyMatrix4(this.group.matrix) };
  }

  dispose(): void {
    this.screen.dispose();
    this.sign.material.map?.dispose();
    this.sign.material.dispose();
    for (const s of [this.lead, ...this.helpers, this.reviewer]) s.character?.dispose();
  }
}
