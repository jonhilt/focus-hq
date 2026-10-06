import * as THREE from 'three';
import { box, flat } from './materials';
import { cyl } from './props';
import { HULL, LCARS, lcarsSign, stationSeat } from './starship';

/** The group desk's table, in the room frame: in the corner on your left as you come in, clear of the desks. */
export const GROUP_TABLE = new THREE.Vector3(-5.2, 0, -4.3);
const TABLE_R = 0.8;
const TABLE_TOP = 0.74;

/** A seat at the table, in the room frame, and which way whoever sits there faces (a Character faces +X). */
interface Seat {
  at: THREE.Vector3;
  rotationY: number;
}

/** The lead sits on the door side of the table, facing the shared display across it (towards -Z). */
export const LEAD_SEAT: Seat = { at: new THREE.Vector3(GROUP_TABLE.x, 0, GROUP_TABLE.z + 1.05), rotationY: Math.PI / 2 };

/** Where the lead's helpers gather: either side of the table, and on the lead's left, all facing its middle. */
export const HELPER_SEATS: Seat[] = [
  { at: new THREE.Vector3(GROUP_TABLE.x - 1.05, 0, GROUP_TABLE.z), rotationY: 0 },
  { at: new THREE.Vector3(GROUP_TABLE.x + 1.05, 0, GROUP_TABLE.z), rotationY: Math.PI },
  { at: new THREE.Vector3(GROUP_TABLE.x - 0.85, 0, GROUP_TABLE.z + 0.75), rotationY: Math.atan2(0.75, 0.85) },
];

/** The shared display, standing on the far side of the table and facing the lead. 800×512, like a StationScreen. */
const DISPLAY = { w: 1.5, h: 0.96, z: GROUP_TABLE.z - 0.55, bottom: 1.1 };

/** Behind the lead's right shoulder, looking at the shared display (room frame). */
export function leadViewpoint(): { position: THREE.Vector3; lookAt: THREE.Vector3 } {
  return {
    // far enough right and back that the lead's head sits at the screen's edge, not in front of it
    position: new THREE.Vector3(LEAD_SEAT.at.x + 0.95, 0, LEAD_SEAT.at.z + 1.35),
    lookAt: new THREE.Vector3(GROUP_TABLE.x, DISPLAY.bottom + DISPLAY.h / 2, DISPLAY.z),
  };
}

export interface GroupDesk {
  group: THREE.Group;
  /** The table and the display: what the room's colliders and the "talk to the lead" hint hang on. */
  table: THREE.Group;
  display: THREE.Group;
  /** The lead's chair group: add their Character to it. */
  leadSeat: THREE.Group;
  /** Empty chair groups for helpers, in HELPER_SEATS order. */
  helperSeats: THREE.Group[];
  /** What blocks the player: the table, the display's stand and every chair. */
  colliders: THREE.Object3D[];
}

/** Builds the group desk in the room frame, the shared display showing `screen`. */
export function buildGroupDesk(screen: THREE.Material, accent: string): GroupDesk {
  const group = new THREE.Group();

  const table = new THREE.Group();
  table.position.copy(GROUP_TABLE);
  const top = cyl(TABLE_R, TABLE_R, 0.06, HULL.bulkhead, 40);
  top.position.y = TABLE_TOP;
  // an LCARS-coloured band under the rim, a little wider than the top so it reads from across the room
  const rim = cyl(TABLE_R + 0.03, TABLE_R + 0.03, 0.03, accent, 40);
  rim.position.y = TABLE_TOP - 0.05;
  const pedestal = cyl(0.12, 0.2, TABLE_TOP - 0.09, HULL.frame);
  pedestal.position.y = 0.03 + (TABLE_TOP - 0.09) / 2;
  const foot = cyl(0.45, 0.5, 0.05, HULL.dado, 32);
  foot.position.y = 0.025;
  table.add(top, rim, pedestal, foot);
  group.add(table);

  // the shared display on a stand at the far side of the table, leaning back a touch, facing the lead
  const display = new THREE.Group();
  display.position.set(GROUP_TABLE.x, 0, DISPLAY.z);
  // the stand starts a little inside the table top and ends inside the frame, so it shares no face with either
  display.add(box(0.08, DISPLAY.bottom - TABLE_TOP - 0.025, 0.08, HULL.frame, 0, TABLE_TOP + 0.025, -0.02));
  const panel = new THREE.Group();
  panel.position.y = DISPLAY.bottom + DISPLAY.h / 2;
  panel.rotation.x = -0.08;
  panel.add(box(DISPLAY.w + 0.1, DISPLAY.h + 0.1, 0.06, HULL.frame, 0, -(DISPLAY.h + 0.1) / 2, -0.03));
  // the accent bar sits just clear of the frame's top and sides, so no two faces share a plane
  panel.add(box(DISPLAY.w + 0.12, 0.06, 0.07, accent, 0, DISPLAY.h / 2 + 0.055, -0.03));
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(DISPLAY.w, DISPLAY.h), screen);
  plane.position.z = 0.004;
  panel.add(plane);
  // the back says whose desk it is, for anyone walking up from the far side
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.28), flat(lcarsSign('Group desk', { color: LCARS.gold, h: 287 })));
  sign.rotation.y = Math.PI;
  sign.position.set(0, 0, -0.064);
  panel.add(sign);
  display.add(panel);
  group.add(display);

  const chairAt = (seat: Seat) => {
    const g = new THREE.Group();
    g.position.copy(seat.at);
    g.rotation.y = seat.rotationY;
    g.add(stationSeat('#5c5470'));
    group.add(g);
    return g;
  };
  const leadSeat = chairAt(LEAD_SEAT);
  const helperSeats = HELPER_SEATS.map(chairAt);

  return { group, table, display, leadSeat, helperSeats, colliders: [top, display.children[0], leadSeat, ...helperSeats] };
}

