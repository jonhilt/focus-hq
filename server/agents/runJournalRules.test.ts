import { describe, expect, it } from 'vitest';
import { fold, INTERRUPTED_ACTIVITY, RESUMED_NOTE, type RunFact } from './runJournal';
import { recovery, signInMismatch } from './runJournalRules';

const requested = (turn: string, prompt = 'Fix the flaky test', resumes?: string): RunFact => ({ kind: 'turn-requested', turn, turnKind: 'work', prompt, resumes });
const issue = { task: 'issue' };

describe('recovery', () => {
  it('has nothing to do when no turn was in flight', () => {
    expect(recovery(fold([requested('t1'), { kind: 'turn-ended', turn: 't1', outcome: { ok: true } }]), issue, false)).toEqual({ kind: 'none' });
  });

  it('tells a turn Claude Code had that it was cut off, with what was sent into it in case it never arrived', () => {
    const run = fold([requested('t1'), { kind: 'turn-started', turn: 't1', session: 's1' }, { kind: 'sent', turn: 't1', text: 'Also the docs' }]);
    const next = recovery(run, issue, false);
    expect(next).toMatchObject({ kind: 'resume', turn: 't1', session: 's1' });
    expect(next.kind === 'resume' && next.prompt).toBe(`${RESUMED_NOTE}\n\nThese messages were sent to you during that turn, in case they didn't reach you before it was cut off:\n\nAlso the docs`);
    expect(recovery(fold([requested('t1'), { kind: 'turn-started', turn: 't1', session: 's1' }]), issue, false)).toMatchObject({ prompt: RESUMED_NOTE });
  });

  it('asks a turn Claude Code never got again, in the conversation it was going back to', () => {
    expect(recovery(fold([requested('t2', 'Also the docs', 's1')]), { task: 'lead' }, false)).toEqual({ kind: 'resume', turn: 't2', prompt: 'Also the docs', session: 's1' });
  });

  it('waits for the captain on the API key, for a compaction, a sign-in stopped, or no conversation', () => {
    const run = fold([requested('t1'), { kind: 'turn-started', turn: 't1', session: 's1' }]);
    expect(recovery(run, issue, true)).toMatchObject({ kind: 'wait', why: expect.stringContaining('API key') });
    expect(recovery(run, { task: 'review' }, true)).toMatchObject({ kind: 'wait', why: expect.stringContaining('API key') });
    expect(recovery(fold([requested('t1')]), { task: 'issue' }, false)).toMatchObject({ kind: 'wait', why: INTERRUPTED_ACTIVITY });
    expect(recovery(fold([{ kind: 'turn-requested', turn: 'c1', turnKind: 'compact', prompt: '/compact', resumes: 's1' }]), issue, false)).toMatchObject({ kind: 'wait', why: expect.stringContaining('compacting') });
    expect(recovery(fold([requested('t1', 'Go', 's1'), { kind: 'sign-in-mismatch', turn: 't1', observed: 'ANTHROPIC_API_KEY' }]), issue, false)).toMatchObject({ kind: 'wait', why: expect.stringContaining('API key') });
  });

  it('leaves a turn the captain stopped stopped', () => {
    expect(recovery(fold([requested('t1', 'Go', 's1'), { kind: 'stop-requested', turn: 't1' }]), issue, false)).toMatchObject({ kind: 'wait', why: expect.stringContaining('Stopped by the captain') });
  });

  it('never carries a turn that was starting a new conversation on in an old one', () => {
    // the lead's fresh session after Claude Code lost theirs: the agent's saved session id may still be the old one
    expect(recovery(fold([requested('t1', 'You’re carrying on in a new conversation')]), { task: 'lead' }, false)).toMatchObject({ kind: 'wait' });
  });
});

describe('signInMismatch', () => {
  it('is a key that costs when Ops meant your plan, and nothing else', () => {
    expect(signInMismatch(false, 'ANTHROPIC_API_KEY')).toBe(true);
    expect(signInMismatch(false, 'apiKeyHelper')).toBe(true);
    expect(signInMismatch(false, 'none')).toBe(false);
    expect(signInMismatch(false, '/login managed key')).toBe(false);
    expect(signInMismatch(true, 'none')).toBe(false);
    expect(signInMismatch(undefined, 'ANTHROPIC_API_KEY')).toBe(false);
    expect(signInMismatch(false, undefined)).toBe(false);
  });
});

describe('recovery of a run waiting for a slot', () => {
  const waiting = fold([requested('t1'), { kind: 'turn-ended', turn: 't1', outcome: { ok: true } }, { kind: 'waiting' }]);

  it('puts them back in line', () => {
    expect(recovery(waiting, { task: 'issue', sessionId: 's1' }, false)).toEqual({ kind: 'requeue' });
    expect(recovery(fold([{ kind: 'waiting' }]), { task: 'lead' }, true)).toEqual({ kind: 'requeue' });
  });

  it('holds them when going back to their conversation would be on the key', () => {
    expect(recovery(waiting, { task: 'issue', sessionId: 's1' }, true)).toMatchObject({ kind: 'hold', why: expect.stringContaining('API key') });
    expect(recovery(waiting, { task: 'review' }, false)).toEqual({ kind: 'requeue' });
  });
});

describe('recovery of a delivery', () => {
  const ended: RunFact[] = [requested('t1'), { kind: 'turn-ended', turn: 't1', outcome: { ok: true } }, { kind: 'decided', turn: 't1', target: 'deliver' }];
  const delivering: RunFact[] = [...ended, { kind: 'delivering', turn: 't1', summary: 'Dark mode' }];

  it('is finished by Ops after a restart, without Claude: only a developer’s, and only one cut off', () => {
    expect(recovery(fold(delivering), { task: 'issue', sessionId: 's1' }, true)).toEqual({ kind: 'deliver', turn: 't1', summary: 'Dark mode' });
    expect(recovery(fold([...delivering, { kind: 'pushed', turn: 't1' }]), { task: 'fix' }, false)).toMatchObject({ kind: 'deliver' });
    expect(recovery(fold([...delivering, { kind: 'delivered', turn: 't1', outcome: 'no-commits' }]), { task: 'issue' }, false)).toEqual({ kind: 'none' });
    expect(recovery(fold([...delivering, { kind: 'delivery-failed', turn: 't1', error: 'x' }]), { task: 'issue' }, false)).toEqual({ kind: 'none' });
    expect(recovery(fold(delivering), { task: 'lead' }, false)).toEqual({ kind: 'none' });
  });

  it('is delivered from the start after a restart that fell before it was journaled, asking them to commit first', () => {
    const decided: RunFact[] = [requested('t1'), { kind: 'turn-ended', turn: 't1', outcome: { ok: true } }, { kind: 'decided', turn: 't1', target: 'deliver', summary: 'Dark mode' }];
    expect(recovery(fold(decided), { task: 'issue', sessionId: 's1' }, false)).toEqual({ kind: 'deliver', turn: 't1', summary: 'Dark mode', unasked: true });
    // journaled before the summary was: nothing to put in the pull request, so it waits as before
    expect(recovery(fold(ended), { task: 'issue', sessionId: 's1' }, false)).toEqual({ kind: 'none' });
    // a delivery that failed before it was journaled is over
    const failed = fold([...decided, { kind: 'delivery-failed', turn: 't1', error: 'git status failed' }]);
    expect(failed).toMatchObject({ phase: 'failed', delivery: { turn: 't1', summary: 'Dark mode', error: 'git status failed' } });
    expect(recovery(failed, { task: 'issue', sessionId: 's1' }, false)).toEqual({ kind: 'none' });
    expect(recovery(fold(decided), { task: 'lead', sessionId: 's1' }, false)).toEqual({ kind: 'none' });
  });
});

describe('recovery of a held run', () => {
  it('holds them again after a restart, QA too', () => {
    const held = fold([{ kind: 'held', until: 5000 }]);
    expect(recovery(held, { task: 'lead', sessionId: 's1' }, true)).toEqual({ kind: 'hold-again', until: 5000 });
    expect(recovery(held, { task: 'review' }, false)).toEqual({ kind: 'hold-again', until: 5000 });
  });
});
