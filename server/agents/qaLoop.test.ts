import { describe, expect, it } from 'vitest';
import { MAX_FAILED_ROUNDS, qaNextStep } from './qaLoop';

const ours = { openedByOffice: true, autoSendBack: true };

describe('qaNextStep', () => {
  it('sends a failed PR Ops opened back to a developer', () => {
    expect(qaNextStep(ours, { kind: 'verdict', verdict: 'fail', failedRounds: 1 })).toEqual({ kind: 'send-back' });
    expect(qaNextStep(ours, { kind: 'verdict', verdict: 'fail', failedRounds: MAX_FAILED_ROUNDS - 1 })).toEqual({ kind: 'send-back' });
  });

  it('leaves a passed PR alone', () => {
    expect(qaNextStep(ours, { kind: 'verdict', verdict: 'pass', failedRounds: 2 })).toEqual({ kind: 'nothing' });
  });

  it('stops and wants the manager after three failed rounds', () => {
    expect(qaNextStep(ours, { kind: 'verdict', verdict: 'fail', failedRounds: 3 })).toEqual({ kind: 'needs-you', reason: 'it failed QA 3 times' });
    expect(qaNextStep(ours, { kind: 'verdict', verdict: 'fail', failedRounds: 5 }).kind).toBe('needs-you');
  });

  it('never sends a teammate’s PR back', () => {
    expect(qaNextStep({ openedByOffice: false, autoSendBack: true }, { kind: 'verdict', verdict: 'fail', failedRounds: 1 })).toEqual({ kind: 'nothing' });
    expect(qaNextStep({ openedByOffice: false, autoSendBack: true }, { kind: 'verdict', verdict: 'fail', failedRounds: 3 })).toEqual({ kind: 'nothing' });
  });

  it('does nothing when the project switched send-back off', () => {
    expect(qaNextStep({ openedByOffice: true, autoSendBack: false }, { kind: 'verdict', verdict: 'fail', failedRounds: 1 })).toEqual({ kind: 'nothing' });
    expect(qaNextStep({ openedByOffice: true, autoSendBack: false }, { kind: 'fix-ended', by: 'Ada', outcome: 'pushed-nothing' })).toEqual({ kind: 'nothing' });
  });

  it('lets a pushed fix go back to QA by itself', () => {
    expect(qaNextStep(ours, { kind: 'fix-ended', by: 'Ada', outcome: 'pushed' })).toEqual({ kind: 'nothing' });
  });

  it('stops when a fix pushes nothing, fails or is stopped', () => {
    expect(qaNextStep(ours, { kind: 'fix-ended', by: 'Ada', outcome: 'pushed-nothing' })).toEqual({ kind: 'needs-you', reason: 'Ada pushed no fix' });
    expect(qaNextStep(ours, { kind: 'fix-ended', by: 'Ada', outcome: 'failed' })).toEqual({ kind: 'needs-you', reason: 'Ada hit a problem fixing it' });
    expect(qaNextStep(ours, { kind: 'fix-ended', by: 'Ada', outcome: 'stopped' }).kind).toBe('needs-you');
  });
});
