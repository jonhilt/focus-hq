import { describe, expect, it } from 'vitest';
import { TEAM_STATIONS } from '../../../shared/types';
import { type Box2, BRIEFING, briefingRoomAt, HALL_HALF, ROOM_DEPTH, roomSlot } from './layout';

describe('briefingRoomAt', () => {
  // a dozen holodecks' briefing rooms: the floor each covers, with the alcove behind its door
  const rooms: Box2[] = [];
  for (let i = 0; i < 12; i++) {
    for (let s = 0; s < TEAM_STATIONS; s++) {
      const at = briefingRoomAt(roomSlot(i), s);
      rooms.push({ minX: at.x - BRIEFING.width / 2, maxX: at.x + BRIEFING.width / 2, minZ: at.z - BRIEFING.depth, maxZ: at.z + BRIEFING.alcove });
    }
  }

  it('stands every briefing room out beyond the holodecks', () => {
    for (const r of rooms) expect(Math.min(Math.abs(r.minX), Math.abs(r.maxX))).toBeGreaterThan(HALL_HALF + ROOM_DEPTH);
  });

  it('stands no two briefing rooms where they’d meet', () => {
    const meet = (a: Box2, b: Box2) => a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;
    for (const [i, a] of rooms.entries()) for (const b of rooms.slice(i + 1)) expect(meet(a, b)).toBe(false);
  });
});
