import { describe, expect, it } from 'vitest';
import { endsShowcaseTurn, SHOWCASE, showcaseRoom } from './showcase';

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

describe('endsShowcaseTurn', () => {
  it('ends the shipping station’s turn when its slice lands mid-turn, so its next turn starts on the next slice', () => {
    expect(endsShowcaseTurn('qa', '[Office] Slice 1 has landed: demo/focus#10 merged. Carry on where you are: …')).toBe(true);
  });

  it('lets anything else go into the turn, and leaves the other stations alone', () => {
    expect(endsShowcaseTurn('qa', '[QA officer Ensign Park] QA failed demo/focus#10: …')).toBe(false);
    expect(endsShowcaseTurn('subagents', 'Slice 1 has landed: demo/focus#10 merged.')).toBe(false);
  });
});
