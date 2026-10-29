import { describe, expect, it } from 'vitest';
import { answerAsk, answerTo, headlineOf, together } from './askRules';

const asks = [{ ask: 'Next slice: shared link or emails?' }, { ask: 'Keep the old endpoint for a release?' }, { ask: 'Rename the setting?' }];

describe('a turn’s headline', () => {
  it('is its one ask, or its first and how many more', () => {
    expect(headlineOf([{ ask: 'Close the goal?' }])).toBe('Close the goal?');
    expect(headlineOf(asks)).toBe('Next slice: shared link or emails? (+2 more)');
    expect(headlineOf([])).toBe('');
  });
});

describe('answering a turn’s asks', () => {
  it('holds an answer while any ask is unanswered: nothing goes to the lead', () => {
    expect(answerAsk(asks, [], { ask: 1, text: ' Keep it for a release. ' })).toEqual({ kind: 'hold', answers: [{ ask: 1, text: 'Keep it for a release.' }] });
    expect(answerAsk(asks, [{ ask: 1, text: 'Keep it.' }], { ask: 0, text: 'Emails first.' })).toEqual({ kind: 'hold', answers: [{ ask: 0, text: 'Emails first.' }, { ask: 1, text: 'Keep it.' }] });
  });

  it('changes a held answer, rather than counting it twice', () => {
    const held = [{ ask: 0, text: 'Emails first.' }, { ask: 1, text: 'Keep it.' }];
    expect(answerAsk(asks, held, { ask: 0, text: 'Shared link first.' })).toEqual({ kind: 'hold', answers: [{ ask: 0, text: 'Shared link first.' }, { ask: 1, text: 'Keep it.' }] });
  });

  it('sends every answer together once the last ask is answered, each under its ask’s headline', () => {
    const held = [{ ask: 0, text: 'Shared link first.' }, { ask: 2, text: 'Yes, “Saved lists”.' }];
    expect(answerAsk(asks, held, { ask: 1, text: 'Keep it for a release.' })).toEqual({
      kind: 'send',
      answers: [{ ask: 0, text: 'Shared link first.' }, { ask: 1, text: 'Keep it for a release.' }, { ask: 2, text: 'Yes, “Saved lists”.' }],
      text: '**Next slice: shared link or emails?**\nShared link first.\n\n**Keep the old endpoint for a release?**\nKeep it for a release.\n\n**Rename the setting?**\nYes, “Saved lists”.',
    });
  });

  it('sends a turn of one ask at once, its answer as it is', () => {
    expect(answerAsk([{ ask: 'Close the goal?' }], [], { ask: 0, text: 'Close it.' })).toEqual({ kind: 'send', answers: [{ ask: 0, text: 'Close it.' }], text: 'Close it.' });
  });

  it('refuses an ask the turn doesn’t have, or no words, and drops answers to asks it no longer has', () => {
    expect(answerAsk(asks, [], { ask: 3, text: 'x' })).toMatchObject({ kind: 'refuse' });
    expect(answerAsk(asks, [], { ask: -1, text: 'x' })).toMatchObject({ kind: 'refuse' });
    expect(answerAsk(asks, [], { ask: 0.5, text: 'x' })).toMatchObject({ kind: 'refuse' });
    expect(answerAsk(asks, [], { ask: 0, text: '  ' })).toMatchObject({ kind: 'refuse', why: expect.stringMatching(/text/) });
    expect(answerAsk(asks.slice(0, 2), [{ ask: 2, text: 'stale' }], { ask: 0, text: 'x' })).toEqual({ kind: 'hold', answers: [{ ask: 0, text: 'x' }] });
  });

  it('reads the answer held to an ask, and puts them together in the asks’ order', () => {
    expect(answerTo([{ ask: 1, text: 'b' }], 1)).toBe('b');
    expect(answerTo([{ ask: 1, text: 'b' }], 0)).toBeUndefined();
    expect(together(asks.slice(0, 2), [{ ask: 1, text: 'b' }, { ask: 0, text: 'a' }])).toBe('**Next slice: shared link or emails?**\na\n\n**Keep the old endpoint for a release?**\nb');
  });
});
