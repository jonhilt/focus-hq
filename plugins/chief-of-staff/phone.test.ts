import { describe, expect, it } from 'vitest';
import type { Agent } from '../../plugin-api/shared';
import { phoneFeedback, readyLine, sendsIn } from './phone';
import { CHIEF_OF_STAFF } from './shared';

describe('the phone’s Ready to send strip', () => {
  it('says when the chief of staff’s words go by themselves, or that they wait for the captain', () => {
    expect(sendsIn(undefined, 0)).toBe('Waits for you to send');
    expect(sendsIn(120_000, 0)).toBe('Sends itself in 2 min');
    expect(sendsIn(30_000, 0)).toBe('Sends itself within a minute');
  });

  it('heads a judged turn with its line and its words, holdable only while they count down', () => {
    const judged = { route: 1 as const, asks: [{ ask: 'Ship the slice' }], why: 'it is done', message: 'Go ahead and ship.' };
    expect(readyLine({ at: 0, judged, sendsAt: 60_000 }, 0)).toEqual({ ask: 'Ship the slice', words: 'Go ahead and ship.', holdable: true, when: 'Sends itself within a minute' });
    expect(readyLine({ at: 0, judged }, 0)).toEqual({ ask: 'Ship the slice', words: 'Go ahead and ship.', holdable: false, when: 'Waits for you to send' });
  });

  it('says carry on, with no words, for a turn it has no verdict on', () => {
    expect(readyLine(undefined, 0)).toEqual({ ask: 'Carry on', words: '', holdable: false, when: 'Waits for you to send' });
  });
});

describe('the user’s word on a turn on the phone (README.md#didnt-need-me-and-you-should-have-asked-me)', () => {
  const lead = (marks?: unknown) => ({ id: 'lead-1', sessionId: 's1', lead: { marks: { [CHIEF_OF_STAFF]: marks } } }) as unknown as Agent;
  const judged = { route: 4 as const, asks: [{ ask: 'Test it first' }], why: 'untested', message: 'Test it.' };

  it('puts both on a judged turn, by the turn its read names, the one pressed shown pressed', () => {
    const buttons = phoneFeedback(lead({ at: 1, judged, turnUuid: 't1' }), { 's1:t1': ['not-needed'] });
    expect(buttons.map((b) => [b.label, b.pressed])).toEqual([['Didn’t need me', true], ['You should have asked me', false]]);
    expect(buttons[1]?.press).toEqual({ agentId: 'lead-1', turnUuid: 't1', signal: 'should-have-asked', via: 'phone' });
  });

  it('puts none on a turn not named: one not judged yet, or a read from before reads kept their turn', () => {
    expect(phoneFeedback(lead({ at: 1 }), {})).toEqual([]);
    expect(phoneFeedback(lead({ at: 1, judged }), {})).toEqual([]);
  });
});
