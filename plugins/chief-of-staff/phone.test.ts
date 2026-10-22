import { describe, expect, it } from 'vitest';
import { readyLine, sendsIn } from './phone';

describe('the phone’s Ready to send strip', () => {
  it('says when the chief of staff’s words go by themselves, or that they wait for the captain', () => {
    expect(sendsIn(undefined, 0)).toBe('Waits for you to send');
    expect(sendsIn(120_000, 0)).toBe('Sends itself in 2 min');
    expect(sendsIn(30_000, 0)).toBe('Sends itself within a minute');
  });

  it('heads a judged turn with its line and its words, holdable only while they count down', () => {
    const judged = { route: 1 as const, ask: 'Ship the slice', why: 'it is done', message: 'Go ahead and ship.' };
    expect(readyLine({ at: 0, judged, sendsAt: 60_000 }, 0)).toEqual({ ask: 'Ship the slice', words: 'Go ahead and ship.', holdable: true, when: 'Sends itself within a minute' });
    expect(readyLine({ at: 0, judged }, 0)).toEqual({ ask: 'Ship the slice', words: 'Go ahead and ship.', holdable: false, when: 'Waits for you to send' });
  });

  it('says carry on, with no words, for a turn it has no verdict on', () => {
    expect(readyLine(undefined, 0)).toEqual({ ask: 'Carry on', words: '', holdable: false, when: 'Waits for you to send' });
  });
});
