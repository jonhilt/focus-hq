import { describe, expect, it } from 'vitest';
import { afterTriage, MAX_TRIAGES, triageLabel, whenStuck } from './triageRules';

const officer = 'Lt. Varga';
const pr = { closes: [7] };

describe('whenStuck', () => {
  it('has the operations officer look at a PR the first and second time it gets stuck', () => {
    expect(whenStuck({}, officer, 'it failed QA 3 times')).toEqual({ kind: 'triage' });
    expect(whenStuck({ triages: MAX_TRIAGES - 1 }, officer, 'Ada pushed no fix')).toEqual({ kind: 'triage' });
  });

  it('sends a PR stuck a third time straight to the manager', () => {
    expect(whenStuck({ triages: 2 }, officer, 'it failed QA 4 times')).toEqual({
      kind: 'needs-you',
      reason: 'it failed QA 4 times, and Lt. Varga already looked at it twice',
    });
    expect(whenStuck({ triages: 5 }, officer, 'x').kind).toBe('needs-you');
  });
});

describe('afterTriage', () => {
  it('does what the officer decided', () => {
    for (const action of ['retry-qa', 'send-back', 'rerun-checks', 'close'] as const) {
      expect(afterTriage(officer, { decision: { action, note: 'why' } }, pr)).toEqual({ kind: action, note: 'why' });
    }
  });

  it('puts an escalation in front of the manager with the diagnosis', () => {
    expect(afterTriage(officer, { decision: { action: 'escalate', note: 'needs a Stripe key' } }, pr)).toEqual({ kind: 'needs-you', reason: 'Lt. Varga: needs a Stripe key' });
  });

  it('wants the manager when the officer ends without a decision', () => {
    expect(afterTriage(officer, { error: 'Gave up after 8 minutes' }, pr)).toEqual({ kind: 'needs-you', reason: 'Lt. Varga couldn’t work out what to do (Gave up after 8 minutes)' });
  });

  it('won’t close a PR that closes no issue, since nothing would build it again', () => {
    expect(afterTriage(officer, { decision: { action: 'close', note: 'wrong approach' } }, { closes: [] })).toEqual({
      kind: 'needs-you',
      reason: 'Lt. Varga would close it, but it closes no issue to build again: wrong approach',
    });
  });
});

describe('triageLabel', () => {
  it('says what the officer did', () => {
    expect(triageLabel({ officer, action: 'retry-qa' })).toBe('Lt. Varga sent it back to QA');
    expect(triageLabel({ officer, action: 'escalate' })).toBe('Lt. Varga handed it to you');
  });
});
