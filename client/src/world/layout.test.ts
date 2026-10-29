import { describe, expect, it } from 'vitest';
import { type Box2, BRIEFING, briefingRoomAt, ENGINEERING_DECK, HALL, HALL_HALF, hallAt, ROOM_DEPTH, roomSlot, SPACE, spaceAt, TRANSPORTER, TRANSPORTER_ROOMS, transporterRoomAt } from './layout';

const meet = (a: Box2, b: Box2) => a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;

// a dozen holodecks' briefing rooms: the floor each covers, with the alcove behind its door
const rooms: Box2[] = [];
for (let i = 0; i < 12; i++) {
  const at = briefingRoomAt(roomSlot(i));
  rooms.push({ minX: at.x - BRIEFING.width / 2, maxX: at.x + BRIEFING.width / 2, minZ: at.z - BRIEFING.depth, maxZ: at.z + BRIEFING.alcove });
}

describe('briefingRoomAt', () => {
  it('stands every briefing room out beyond the holodecks', () => {
    for (const r of rooms) expect(Math.min(Math.abs(r.minX), Math.abs(r.maxX))).toBeGreaterThan(HALL_HALF + ROOM_DEPTH);
  });

  it('stands no two briefing rooms where they’d meet', () => {
    for (const [i, a] of rooms.entries()) for (const b of rooms.slice(i + 1)) expect(meet(a, b)).toBe(false);
  });
});

// the same dozen holodecks' training halls: the floor each covers, with the alcove behind its entrance
const halls: Box2[] = [];
for (let i = 0; i < 12; i++) {
  const at = hallAt(roomSlot(i));
  const r = HALL.radius + HALL.alcove + 0.5;
  halls.push({ minX: at.x - r, maxX: at.x + r, minZ: at.z - r, maxZ: at.z + r });
}

describe('hallAt', () => {
  it('stands every training hall out beyond the briefing rooms', () => {
    const furthest = Math.max(...rooms.map((r) => Math.max(Math.abs(r.minX), Math.abs(r.maxX))));
    for (const h of halls) expect(Math.min(Math.abs(h.minX), Math.abs(h.maxX))).toBeGreaterThan(furthest);
  });

  it('stands no two training halls where they’d meet', () => {
    for (const [i, a] of halls.entries()) for (const b of halls.slice(i + 1)) expect(meet(a, b)).toBe(false);
  });
});

describe('transporterRoomAt', () => {
  // the same dozen holodecks' goal viewing stations' transporter rooms: the floor each covers, walls and all
  const transporters: Box2[] = [];
  for (let i = 0; i < 12; i++) {
    for (let k = 0; k < TRANSPORTER_ROOMS; k++) {
      const at = transporterRoomAt(roomSlot(i), k);
      transporters.push({ minX: at.x - TRANSPORTER.width / 2, maxX: at.x + TRANSPORTER.width / 2, minZ: at.z - TRANSPORTER.depth / 2, maxZ: at.z + TRANSPORTER.depth / 2 });
    }
  }

  it('stands no two transporter rooms where they’d meet', () => {
    for (const [i, a] of transporters.entries()) for (const b of transporters.slice(i + 1)) expect(meet(a, b)).toBe(false);
  });

  it('stands them clear of the briefing rooms and training halls', () => {
    for (const t of transporters) for (const other of [...rooms, ...halls]) expect(meet(t, other)).toBe(false);
  });

  it('stands them far beyond main engineering and the halls’ landscapes, where nothing else stands', () => {
    // main engineering is under 40 m long; a training hall's landscape reaches up to 210 m from its middle
    for (const t of transporters) expect(t.minZ).toBeGreaterThan(Math.max(ENGINEERING_DECK.z + 40, hallAt(roomSlot(0)).z + 210));
  });
});

describe('spaceAt', () => {
  it('stands each space clear of the next, and of the furthest holodeck, hall and briefing room', () => {
    expect(spaceAt(0).distanceTo(spaceAt(1))).toBeGreaterThan(SPACE.radius * 2);
    const far = roomSlot(2 * 30 - 1);
    for (const p of [far.center, hallAt(far), briefingRoomAt(far)]) expect(spaceAt(0).distanceTo(p)).toBeGreaterThan(SPACE.radius * 2);
  });
});
