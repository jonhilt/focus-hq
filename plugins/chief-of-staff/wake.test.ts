import { describe, expect, it } from 'vitest';
import type { LeadNews } from '../../plugin-api/server';
import { LEAD_FIX_ROUNDS, wakeFor } from './wake';

const fail = (o: Partial<Extract<LeadNews, { kind: 'qa-verdict' }>> = {}): LeadNews => ({ kind: 'qa-verdict', repo: 'acme/api', number: 7, verdict: 'fail', advisory: false, failedRounds: 1, behind: false, ...o });
const idle = (about: LeadNews) => ({ about, inTurn: false });

describe('wakeFor', () => {
  it('sends a QA fail back to the lead a couple of rounds, then leaves it to the captain', () => {
    expect(wakeFor(idle(fail()), { autoSendBack: true })).toBe("Fix acme/api#7 and ship again (QA's verdict is just above), or tell the captain why not.");
    expect(wakeFor(idle(fail({ failedRounds: LEAD_FIX_ROUNDS })), { autoSendBack: true })).toBeDefined();
    expect(wakeFor(idle(fail({ failedRounds: LEAD_FIX_ROUNDS + 1 })), { autoSendBack: true })).toBeUndefined();
  });

  it('wakes nobody for a pass, a verdict they’ve shipped past, or a fail in a project that doesn’t send fails back', () => {
    expect(wakeFor(idle(fail({ verdict: 'pass' })), { autoSendBack: true })).toBeUndefined();
    expect(wakeFor(idle(fail({ behind: true })), { autoSendBack: true })).toBeUndefined();
    expect(wakeFor(idle(fail()), { autoSendBack: false })).toBeUndefined();
    // a project from before the switch sends fails back
    expect(wakeFor(idle(fail()), {})).toBeDefined();
  });

  it('carries a lead on once their slice has landed, where they are if they’re in a turn', () => {
    expect(wakeFor(idle({ kind: 'slice-landed', slice: 2 }), {})).toBe("Slice 2 has landed: carry on with what's next, unless it's the captain's call.");
    expect(wakeFor({ about: { kind: 'slice-landed', slice: 2 }, inTurn: true }, {})).toMatch(/^Slice 2 has landed: carry on where you are\. Your repos move to fresh code at the start of your next turn/);
  });

  it('leaves any other note for the captain', () => {
    expect(wakeFor(idle({ kind: 'other' }), { autoSendBack: true })).toBeUndefined();
  });
});
