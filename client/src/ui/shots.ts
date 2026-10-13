import * as THREE from 'three';
import type { Shot } from '../../../shared/studio';
import type { Agent } from '../../../shared/types';
import type { World } from '../world/office';
import type { StationSeat } from '../world/teamStation';

/** Seated, a crew member's head is about this high off the floor. */
const SEATED_HEAD = 1.15;

/** Where the camera's eye goes, and what it looks at. */
export interface Framing {
  position: THREE.Vector3;
  lookAt: THREE.Vector3;
}

/**
 * Where a shot puts the camera (eye) and what it looks at, in the world: the studio's recorder and the director over
 * live play (liveDirector.ts) frame the same shots, of `lead` and its team station; the holodeck's is `projectId`'s, which
 * live play knows before the goal has a lead.
 */
export function frameShot(world: World, name: Shot, lead: Agent | undefined, projectId = lead?.projectId): Framing | null {
  const places = world.places();
  if (name === 'bridge') {
    const place = places.find((p) => /bridge/i.test(p.label)) ?? places[0];
    return place ? { position: place.position.clone().setY(1.6), lookAt: place.lookAt.clone() } : null;
  }
  if (name === 'holodeck') {
    const place = places.find((p) => p.projectId && p.projectId === projectId);
    return place ? { position: place.position.clone().setY(1.6), lookAt: place.lookAt.clone() } : null;
  }
  const station = lead && world.room(lead.projectId)?.stationOf(lead.id);
  if (!station) return null;
  const view = station.viewpoint();
  const captain = view.position.clone().setY(1.6);
  const seat = (s: StationSeat) => s.seat.getWorldPosition(new THREE.Vector3()).setY(SEATED_HEAD);
  // the way someone in a seat faces (a seat turned for its Character, which faces +X): toward the screen
  const facing = (s: StationSeat) => new THREE.Vector3().setFromMatrixColumn(s.seat.matrixWorld, 0).setY(0).normalize();
  const mean = (vs: THREE.Vector3[]) => vs.reduce((sum, v) => sum.add(v), new THREE.Vector3()).divideScalar(vs.length);
  // the helpers' seats that are taken, or the first two while nobody's in them
  const taken = station.helpers.filter((s) => s.id);
  const helpers = taken.length ? taken : station.helpers.slice(0, 2);
  switch (name) {
    case 'station':
      return { position: captain, lookAt: view.lookAt };
    case 'lead': {
      // in front of the lead, a little to the side of it: three-quarters on, from the screen's side
      const ahead = facing(station.lead);
      const side = new THREE.Vector3(-ahead.z, 0, ahead.x);
      return { position: seat(station.lead).addScaledVector(ahead, 1.6).addScaledVector(side, -0.6).setY(1.45), lookAt: seat(station.lead).setY(1.05) };
    }
    case 'helpers': {
      // over the lead's and reviewer's heads from the screen's side, looking down on the helpers at their consoles
      const at = mean(helpers.map(seat));
      return { position: at.clone().addScaledVector(mean(helpers.map(facing)).normalize(), 3.3).setY(2.5), lookAt: at.setY(0.9) };
    }
    case 'crew': {
      // high in a corner by the screen, everyone in it
      const all = mean([station.lead, ...helpers, station.reviewer].map(seat));
      return { position: view.lookAt.clone().lerp(captain, 0.25).setY(2.3), lookAt: all };
    }
  }
}
