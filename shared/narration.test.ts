import { describe, expect, it } from 'vitest';
import { assemble, beatsFromWords, wordsFromWhisper, type Word } from './narration';

const w = (text: string, start: number, end = start + 0.3): Word => ({ text, start, end });

describe('wordsFromWhisper', () => {
  it('joins tokens into words and skips whisper’s markers', () => {
    const json = {
      transcription: [
        {
          tokens: [
            { text: '[_BEG_]', offsets: { from: 0, to: 0 } },
            { text: ' sub', offsets: { from: 100, to: 300 } },
            { text: '-agents', offsets: { from: 300, to: 600 } },
            { text: ' work', offsets: { from: 700, to: 900 } },
            { text: '.', offsets: { from: 900, to: 950 } },
          ],
        },
      ],
    };
    expect(wordsFromWhisper(json)).toEqual([{ text: 'sub-agents', start: 0.1, end: 0.6 }, { text: 'work.', start: 0.7, end: 0.95 }]);
  });
});

describe('assemble', () => {
  const takes = { a: [w('one', 0), w('two', 0.5), w('um', 1.0), w('three', 1.5), w('four', 5)], b: [w('five', 10), w('six', 10.4)] };

  it('keeps the spans in order, back to back on one clock', () => {
    const { cuts, words } = assemble({ takes: {}, keep: [{ take: 'b', from: 9, to: 11 }, { take: 'a', from: 0, to: 1 }], maxPause: 1 }, takes);
    expect(cuts[0]).toMatchObject({ take: 'b', at: 0 });
    expect(cuts[1].at).toBeCloseTo(cuts[0].to - cuts[0].from);
    expect(words.map((x) => x.text)).toEqual(['five', 'six', 'one', 'two']);
    expect(words[0].start).toBeCloseTo(0.15);
  });

  it('cuts out fillers and shortens long pauses', () => {
    const { cuts, words } = assemble({ takes: {}, keep: [{ take: 'a', from: 0, to: 6 }], maxPause: 0.6 }, takes);
    expect(words.map((x) => x.text)).toEqual(['one', 'two', 'three', 'four']);
    // one run before the filler, one after it, and "four" after a long pause
    expect(cuts).toHaveLength(3);
    const gaps = words.slice(1).map((x, i) => x.start - words[i].end);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(0.6);
  });

  it('names a missing take', () => {
    expect(() => assemble({ takes: {}, keep: [{ take: 'z', from: 0, to: 1 }] }, takes)).toThrow(/no take called z/);
  });
});

describe('beatsFromWords', () => {
  it('breaks at sentence ends and pauses, and lists each beat’s words', () => {
    const beats = beatsFromWords([w('Start', 0), w('here.', 0.4), w('Then', 0.8), w('wait', 1.2), w('now', 3)]);
    expect(beats.map((b) => b.text)).toEqual(['Start here.', 'Then wait', 'now']);
    expect(beats[1]).toMatchObject({ id: 'b2', at: 0.8, words: [['Then', 0.8], ['wait', 1.2]] });
  });
});
