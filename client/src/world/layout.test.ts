import { describe, expect, it } from 'vitest';
import { TEAM_STATIONS } from '../../../shared/types';
import { type Box2, BRIEFING, briefingRoomAt, HALL, HALL_HALF, hallAt, ROOM_DEPTH, roomSlot } from './layout';

const meet = (a: Box2, b: Box2) => a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;

// a dozen holodecks' briefing rooms: the floor each covers, with the alcove behind its door
const rooms: Box2[] = [];
for (let i = 0; i < 12; i++) {
  for (let s = 0; s < TEAM_STATIONS; s++) {
    const at = briefingRoomAt(roomSlot(i), s);
    rooms.push({ minX: at.x - BRIEFING.width / 2, maxX: at.x + BRIEFING.width / 2, minZ: at.z - BRIEFING.depth, maxZ: at.z + BRIEFING.alcove });
  }
}

describe('briefingRoomAt', () => {
  it('stands every briefing room out beyond the holodecks', () => {
    for (const r of rooms) expect(Math.min(Math.abs(r.minX), Math.abs(r.maxX))).toBeGreaterThan(HALL_HALF + ROOM_DEPTH);
  });

  it('stands no two briefing rooms where they’d meet', () => {
    for (const [i, a] of rooms.entries()) for (const b of rooms.slice(i + 1)) expect(meet(a, b)).toBe(false);
  });
});

describe('hallAt', () => {
  // the same dozen holodecks' training halls: the floor each covers, with the alcove behind its entrance
  const halls: Box2[] = [];
  for (let i = 0; i < 12; i++) {
    const at = hallAt(roomSlot(i));
    const r = HALL.radius + HALL.alcove + 0.5;
    halls.push({ minX: at.x - r, maxX: at.x + r, minZ: at.z - r, maxZ: at.z + r });
  }

  it('stands every training hall out beyond the briefing rooms', () => {
    const furthest = Math.max(...rooms.map((r) => Math.max(Math.abs(r.minX), Math.abs(r.maxX))));
    for (const h of halls) expect(Math.min(Math.abs(h.minX), Math.abs(h.maxX))).toBeGreaterThan(furthest);
  });

  it('stands no two training halls where they’d meet', () => {
    for (const [i, a] of halls.entries()) for (const b of halls.slice(i + 1)) expect(meet(a, b)).toBe(false);
  });
});
