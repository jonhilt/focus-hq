import { describe, expect, it } from 'vitest';
import type { LedgerEvent } from '../../plugin-api/shared';
import { feedbackButtons, feedbackPressed, feedbackPressOf, feedbackStep, isPressed, pressedOf, verdictOn } from './feedbackRules';

// The user's one-tap word on a lead's turn (README.md#didnt-need-me-and-you-should-have-asked-me).

let seq = 0;
const line = (e: Record<string, unknown>): LedgerEvent => ({ projectId: 'p', at: 0, seq: ++seq, ...e }) as LedgerEvent;
const verdict = (turnUuid: string, route: 1 | 2 | 3 | 4, sessionId = 's1') => line({ kind: 'cos-verdict', sessionId, agent: 'Lt. Reyes', turnUuid, route, why: 'w', model: 'haiku', version: 'v9' });
const word = (turnUuid: string, signal: string, undo = false, sessionId = 's1') =>
  line({ kind: 'captain-feedback', signal, agent: 'Lt. Reyes', sessionId, turnUuid, via: 'comms', ...(undo && { undo: true }) });
const lead = { name: 'Lt. Reyes', goal: 'Saved items', sessionId: 's1' };
const press = { agentId: 'lead-1', turnUuid: 't1', signal: 'not-needed' as const, via: 'comms' as const };

describe('a press as the browser sends it', () => {
  it('takes a lead, a turn, a signal and where it was pressed', () => {
    expect(feedbackPressOf({ ...press, extra: 1 })).toEqual(press);
  });

  it('refuses one missing any of them, or with a signal or a place it doesn’t know, saying which', () => {
    expect(() => feedbackPressOf(null)).toThrow(/agentId, turnUuid, signal, via/);
    expect(() => feedbackPressOf({ ...press, agentId: '' })).toThrow(/agentId/);
    expect(() => feedbackPressOf({ ...press, turnUuid: 7 })).toThrow(/turnUuid/);
    expect(() => feedbackPressOf({ ...press, signal: 'great' })).toThrow(/not-needed, should-have-asked/);
    expect(() => feedbackPressOf({ ...press, via: 'email' })).toThrow(/comms, phone, talk/);
  });
});

describe('what’s pressed, read from the ledger', () => {
  it('is each turn’s signals whose latest line isn’t an undo, a turn with none left out', () => {
    const ledger = [word('t1', 'not-needed'), word('t1', 'should-have-asked'), word('t2', 'not-needed'), word('t2', 'not-needed', true), word('t1', 'not-needed', true), word('t1', 'not-needed')];
    expect(feedbackPressed(ledger)).toEqual({ 's1:t1': ['not-needed', 'should-have-asked'] });
  });

  it('keeps the same turn in another session apart', () => {
    expect(feedbackPressed([word('t1', 'not-needed'), word('t1', 'should-have-asked', false, 's2')])).toEqual({ 's1:t1': ['not-needed'], 's2:t1': ['should-have-asked'] });
  });

  it('says a turn’s signal isn’t pressed without a session or a turn to name it by', () => {
    const pressed = { 's1:t1': ['not-needed' as const] };
    expect(isPressed(pressed, 's1', 't1', 'not-needed')).toBe(true);
    expect(isPressed(pressed, 's1', 't1', 'should-have-asked')).toBe(false);
    expect(isPressed(pressed, undefined, 't1', 'not-needed')).toBe(false);
    expect(isPressed(pressed, 's1', undefined, 'not-needed')).toBe(false);
  });

  it('reads the browser’s copy, leaving out what isn’t a known signal', () => {
    expect(pressedOf({ autoSend: {}, feedback: { 's1:t1': ['not-needed', 'meh'], 's1:t2': ['meh'], 's1:t3': 'x' } })).toEqual({ 's1:t1': ['not-needed'] });
    expect(pressedOf(undefined)).toEqual({});
    expect(pressedOf({ feedback: [] })).toEqual({});
  });
});

describe('a turn’s verdict', () => {
  it('is the chief of staff’s line on that turn of that session, the latest if it judged it twice', () => {
    const first = verdict('t1', 2);
    const again = verdict('t1', 3);
    const ledger = [first, verdict('t2', 1), verdict('t1', 4, 's2'), again];
    expect(verdictOn(ledger, 's1', 't1')).toEqual({ seq: again.seq, route: 3 });
    expect(verdictOn(ledger, 's1', 't9')).toBeUndefined();
  });
});

describe('what a press does', () => {
  it('records a press on a judged turn with the verdict’s line and route', () => {
    const v = verdict('t1', 2);
    expect(feedbackStep(press, lead, [v], false)).toEqual({
      kind: 'record',
      line: { kind: 'captain-feedback', signal: 'not-needed', agent: 'Lt. Reyes', goal: 'Saved items', sessionId: 's1', turnUuid: 't1', verdictSeq: v.seq, route: 2, via: 'comms' },
    });
  });

  it('records one on a turn the chief of staff never judged, known from the transcript, without a verdict', () => {
    const step = feedbackStep({ ...press, via: 'talk' }, lead, [], true);
    expect(step).toEqual({ kind: 'record', line: { kind: 'captain-feedback', signal: 'not-needed', agent: 'Lt. Reyes', goal: 'Saved items', sessionId: 's1', turnUuid: 't1', via: 'talk' } });
  });

  it('takes it back when it’s pressed already: the same line with undo, and presses it again after that', () => {
    expect(feedbackStep(press, lead, [verdict('t1', 2), word('t1', 'not-needed')], false)).toMatchObject({ kind: 'record', line: { signal: 'not-needed', undo: true } });
    const step = feedbackStep(press, lead, [verdict('t1', 2), word('t1', 'not-needed'), word('t1', 'not-needed', true)], false);
    expect(step.kind === 'record' && step.line.undo).toBeFalsy();
  });

  it('leaves the other signal as it is: each is pressed and taken back on its own', () => {
    const step = feedbackStep({ ...press, signal: 'should-have-asked' }, lead, [verdict('t1', 2), word('t1', 'not-needed')], false);
    expect(step.kind === 'record' && step.line.undo).toBeFalsy();
  });

  it('refuses a press about nobody aboard, a lead with no conversation, or a turn that isn’t theirs', () => {
    expect(feedbackStep(press, undefined, [], true)).toEqual({ kind: 'refuse', why: 'That goal isn’t aboard' });
    expect(feedbackStep(press, { name: 'Lt. Reyes' }, [], true)).toEqual({ kind: 'refuse', why: 'Lt. Reyes has no conversation yet' });
    expect(feedbackStep(press, lead, [verdict('t1', 2, 's2')], false)).toEqual({ kind: 'refuse', why: 'That isn’t one of Lt. Reyes’s turns' });
  });
});

describe('a turn’s buttons', () => {
  const reyes = { id: 'lead-1', sessionId: 's1' };

  it('are both signals in the user’s words, each marked pressed or not, with what pressing it sends', () => {
    expect(feedbackButtons(reyes, 't1', { 's1:t1': ['should-have-asked'] }, 'comms')).toEqual([
      { signal: 'not-needed', label: 'Didn’t need me', pressed: false, press: { agentId: 'lead-1', turnUuid: 't1', signal: 'not-needed', via: 'comms' } },
      { signal: 'should-have-asked', label: 'You should have asked me', pressed: true, press: { agentId: 'lead-1', turnUuid: 't1', signal: 'should-have-asked', via: 'comms' } },
    ]);
  });

  it('are the signals asked for alone: a lead’s message in Talk has only “You should have asked me”', () => {
    expect(feedbackButtons(reyes, 't1', {}, 'talk', ['should-have-asked']).map((b) => b.label)).toEqual(['You should have asked me']);
  });

  it('are none on a turn that isn’t named', () => {
    expect(feedbackButtons(reyes, undefined, {}, 'phone')).toEqual([]);
  });
});
