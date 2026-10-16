import { describe, expect, it } from 'vitest';
import { SHOWCASE, showcaseRoom } from './showcase';

describe('showcaseRoom', () => {
  it('finds the station a lead plays by the goal its first message starts', () => {
    expect(showcaseRoom(`${SHOWCASE.rooms[1].goal}`)?.role).toBe('workflow');
    expect(showcaseRoom(`  ${SHOWCASE.rooms[3].goal} and more`)?.role).toBe('qa');
  });

  it('plays nothing special for any other goal', () => {
    expect(showcaseRoom('Shoppers can save items for later')).toBeUndefined();
  });

  it('has one room per team station, each a different thing', () => {
    expect(SHOWCASE.rooms.map((r) => r.station)).toEqual([0, 1, 2, 3]);
    expect(new Set(SHOWCASE.rooms.map((r) => r.role)).size).toBe(SHOWCASE.rooms.length);
  });
});
