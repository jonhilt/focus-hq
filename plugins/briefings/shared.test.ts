import { describe, expect, it } from 'vitest';
import { briefingQuestion, briefingSpot, firstChangedBeat } from './shared';

describe('briefingQuestion', () => {
  const briefing = { id: 'ledger-crash', title: 'When the ledger crashes' };

  it('names the briefing and the beat the captain was on, counted from 1', () => {
    const message = briefingQuestion(briefing, { beat: 2, title: 'The retry' }, '  Why twice? ');
    expect(message.split('\n\n')[0]).toBe('A question about your briefing “When the ledger crashes” (`ledger-crash`, at beat 3, “The retry”): Why twice?');
  });

  it('leaves the beat out when the player never said which one it was on', () => {
    expect(briefingQuestion(briefing, undefined, 'Why?')).toMatch(/^A question about your briefing “When the ledger crashes” \(`ledger-crash`\): Why\?/);
  });

  it('asks for an answer that reads well aloud', () => {
    expect(briefingQuestion(briefing, undefined, 'Why?')).toContain('read out to me in your voice');
  });
});

describe('firstChangedBeat', () => {
  const v1 = { lines: ['Save.', 'Pass it on.', 'It waits.'], titles: ['Save', 'Pass', 'Outage'] };

  it('finds the first beat whose line changed', () => {
    expect(firstChangedBeat(v1, { ...v1, lines: ['Save.', 'Pass it on.', 'It retries three times, then says so.'] })).toBe(2);
  });

  it('counts a changed title, or a beat added on the end', () => {
    expect(firstChangedBeat(v1, { ...v1, titles: ['Save', 'Hand over', 'Outage'] })).toBe(1);
    expect(firstChangedBeat(v1, { lines: [...v1.lines, 'And then?'], titles: [...v1.titles, 'After'] })).toBe(3);
  });

  it('has none when every beat reads the same, or there was no earlier version', () => {
    expect(firstChangedBeat(v1, { ...v1 })).toBe(-1);
    expect(firstChangedBeat(undefined, v1)).toBe(-1);
  });
});

describe('briefingSpot', () => {
  it('takes a whole beat from 0 and its title, cut to 200 characters', () => {
    expect(briefingSpot({ beat: 0, title: 'Start' })).toEqual({ beat: 0, title: 'Start' });
    expect(briefingSpot({ beat: 2, title: 'x'.repeat(300) })?.title).toHaveLength(200);
    expect(briefingSpot({ beat: 2 })).toEqual({ beat: 2, title: '' });
  });

  it('is none without a whole beat from 0', () => {
    for (const spot of [undefined, null, 'beat', {}, { beat: -1 }, { beat: 1.5 }, { beat: '1' }]) expect(briefingSpot(spot)).toBeUndefined();
  });
});
